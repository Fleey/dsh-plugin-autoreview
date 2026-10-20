/**
 * Host half of dsh-plugin-autoreview.
 *
 * Publishes the current-session "Auto" permission preset (no sandbox, `ask`
 * approval policy) and gates every tool call made under it. Low- and
 * medium-risk calls run immediately; high-risk calls, calls that touch
 * secrets, and calls the reviewer cannot judge are routed to the user's
 * approval prompt. The reviewer model and its reasoning effort come from this
 * plugin's volatile Config, which the Client settings page edits.
 *
 * @module dsh-plugin-autoreview
 */

import z from '@deepseek-ai/schemastery'
import {
  AUTO_PRESET,
  REVIEW_POLICY,
  RISK_LABELS,
  RUN_CODE_NAME,
  buildCorrectionInput,
  buildReviewInput,
  describeSignals,
  needsConfirmation,
  parseDecisionJson,
  parseDecisionLoose,
  routeCall,
  snippet,
} from './policy.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-autoreview'

/** Host services required before the Auto preset may be advertised. */
export const inject = ['approval', 'llm', 'permissionPresets', 'sessions', 'tools']

/** Structured error name persisted when a confirmation cannot be shown. */
const UNAVAILABLE_ERROR_NAME = 'AutoReviewConfirmationUnavailable'
/** Structured error code persisted when a confirmation cannot be shown. */
const UNAVAILABLE_CODE = 'AUTO_REVIEW_CONFIRMATION_UNAVAILABLE'

/** Reviewer settings; every field is volatile so the Plugins page edits it live. */
export const Config = z.object({
  provider: z.string().default('').volatile()
    .description('Reviewer provider route. Empty follows the reviewed session.'),
  model: z.string().default('').volatile()
    .description('Reviewer model id. Empty follows the reviewed session.'),
  reasoningEffort: z.string().default('').volatile()
    .description('Reviewer reasoning effort id. Empty uses the model default.'),
  threshold: z.union(['high', 'medium']).default('high').volatile()
    .description('Lowest risk that asks the user. Sensitive data always asks.'),
  scope: z.union(['balanced', 'all']).default('balanced').volatile()
    .description('balanced skips read-only tools and project-local edits without local signals; all reviews every call.'),
  onError: z.union(['ask', 'deny']).default('ask').volatile()
    .description('What happens when the reviewer fails or times out.'),
  timeoutSeconds: z.natural().min(5).max(600).default(90).volatile()
    .description('Upper bound for one review request, in seconds.'),
  trustedTools: z.array(z.string()).default([]).volatile()
    .description('Tool names that never need review.'),
  customRules: z.string().default('').volatile()
    .description('Extra review rules in natural language, appended to the reviewer input.'),
})

/** Small TTL cache of reviewer verdicts keyed by the exact call and settings. */
class VerdictCache {
  constructor(limit, ttlMs) {
    this.limit = limit
    this.ttlMs = ttlMs
    this.entries = new Map()
  }

  get(key) {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expires < Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key, value) {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs })
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
  }

  clear() {
    this.entries.clear()
  }
}

/** Snapshot the volatile settings once per call so one review sees one generation. */
function readSettings(config) {
  return {
    provider: config.provider.get().trim(),
    model: config.model.get().trim(),
    reasoningEffort: config.reasoningEffort.get().trim(),
    threshold: config.threshold.get(),
    scope: config.scope.get(),
    onError: config.onError.get(),
    timeoutSeconds: config.timeoutSeconds.get(),
    trustedTools: config.trustedTools.get().map(item => item.trim()).filter(item => item !== ''),
    customRules: config.customRules.get(),
  }
}

/** Render a thrown value as one line. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Read the session working directory when the optional service is composed. */
async function resolveCwd(ctx, agent, signal) {
  const workingDirectory = ctx.get('workingDirectory')
  if (workingDirectory === undefined) return undefined
  try {
    return await workingDirectory.ensure(agent, signal)
  } catch {
    return undefined
  }
}

/**
 * Collect the final text of one reviewer stream; reasoning blocks are ignored.
 * @param {AsyncIterable<any>} stream - the LLM stream.
 * @returns {Promise<string>}
 */
async function readFinalText(stream) {
  const texts = new Map()
  let finish
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      texts.set(chunk.index, chunk.block.text)
    } else if (chunk.type === 'finish') {
      finish = chunk.reason
    }
  }
  if (finish === undefined) throw new Error('reviewer stream ended without a finish')
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const failure = finish.failure ?? {}
    throw new Error(`reviewer ${finish.kind}: ${failure.code ?? 'unknown'} ${failure.message ?? ''}`.trim())
  }
  const text = [...texts.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]).join('\n')
  // An empty answer (all output spent on reasoning) is retried like any unusable reply.
  return text.trim() === '' ? `[empty reply, finish: ${finish.kind}]` : text
}

/** Install the Auto preset and its prepended per-call review gate. */
export function apply(ctx, config) {
  // This plugin renders its own page; opt out of schema-generated forms.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // Retain the injected service while this context drains on disposal.
  const permissionPresets = ctx.permissionPresets
  const verdicts = new VerdictCache(256, 15 * 60_000)
  const efforts = new Map()
  const warned = new Set()
  const active = new Set()
  const lifecycle = new AbortController()
  let accepting = true

  /** Log one warning per distinct message. */
  function warnOnce(message) {
    if (warned.has(message)) return
    warned.add(message)
    ctx.logger.warn(message)
  }

  /** Accepted effort ids of one route, or undefined when the adapter exposes none. */
  function effortsOf(provider, model, signal) {
    const key = `${provider}\0${model}`
    let pending = efforts.get(key)
    if (pending === undefined) {
      pending = ctx.llm.resolveModelInfo(provider, model, signal).then(
        info => info.reasoning?.efforts?.map(effort => effort.id),
        (error) => {
          efforts.delete(key)
          throw error
        },
      )
      efforts.set(key, pending)
    }
    return pending
  }

  /** Resolve the reviewer route: configured model, else the session's own. */
  async function reviewerRoute(agent, settings, signal) {
    let provider = settings.provider
    let model = settings.model
    if (provider === '' || model === '') {
      const header = agent.session.requestHeader()
      provider = header?.config?.provider ?? ''
      model = header?.config?.model ?? ''
      if (provider === '' || model === '') throw new Error('the session has no model route yet')
    }
    let reasoningEffort = settings.reasoningEffort === '' ? undefined : settings.reasoningEffort
    if (reasoningEffort !== undefined) {
      const accepted = await effortsOf(provider, model, signal).catch(() => undefined)
      if (accepted === undefined || !accepted.includes(reasoningEffort)) {
        warnOnce(`autoreview: ${provider}/${model} does not accept reasoning effort "${reasoningEffort}"; using the model default`)
        reasoningEffort = undefined
      }
    }
    return { provider, model, reasoningEffort }
  }

  /** Ask the reviewer model about one call. */
  async function review(agent, exec, settings, route, cwd, signal) {
    const target = await reviewerRoute(agent, settings, signal)
    const input = buildReviewInput({
      name: exec.name,
      args: exec.arguments,
      cwd,
      platform: process.platform,
      signals: route.signals,
      customRules: settings.customRules,
      mode: exec.parent === undefined ? 'native' : 'ptc-inner',
    })
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new Error(`reviewer timed out after ${settings.timeoutSeconds}s`))
    }, settings.timeoutSeconds * 1000)
    // The review prompt goes only through ctx.llm.stream and never enters a Session log.
    const request = text => readFinalText(ctx.llm.stream({
      provider: target.provider,
      model: target.model,
      ...target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort },
      system: REVIEW_POLICY,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      temperature: 0,
      signal: AbortSignal.any([signal, deadline.signal]),
    }))
    try {
      const reply = await request(input)
      const decision = parseDecisionJson(reply)
      if (decision !== undefined) return { decision, target }
      ctx.logger.warn(`autoreview: reviewer reply for "${exec.name}" was not JSON, asking again: ${snippet(reply)}`)
      const retry = await request(buildCorrectionInput(input, reply))
      const corrected = parseDecisionJson(retry) ?? parseDecisionLoose(retry) ?? parseDecisionLoose(reply)
      if (corrected === undefined) throw new Error(`reviewer reply had no risk decision: "${snippet(retry)}"`)
      return { decision: corrected, target }
    } catch (error) {
      if (deadline.signal.aborted && !signal.aborted) throw deadline.signal.reason
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** The approval prompt shown when a call needs the user's decision. */
  function askUser(exec, verdict) {
    // A sensitive low/medium call is labelled by its sensitivity alone.
    const label = verdict.risk === undefined || (verdict.sensitive && verdict.risk !== 'high')
      ? undefined
      : RISK_LABELS[verdict.risk]
    const zhTag = [label?.zh, verdict.sensitive ? '涉及敏感信息' : undefined].filter(Boolean).join('，')
    const enTag = [label?.en, verdict.sensitive ? 'touches sensitive data' : undefined].filter(Boolean).join(', ')
    const zhHead = verdict.source === 'error' ? '自动审查未能完成' : `自动审查认为此调用需要确认${zhTag === '' ? '' : `（${zhTag}）`}`
    const enHead = verdict.source === 'error' ? 'Auto review could not finish' : `Auto review asks for confirmation${enTag === '' ? '' : ` (${enTag})`}`
    return {
      kind: 'ask',
      reason: `Auto review requires confirmation for tool "${exec.name}"${verdict.reason === '' ? '' : `: ${verdict.reason}`}`,
      displayReason: {
        en: verdict.reason === '' ? `${enHead}.` : `${enHead}: ${verdict.reason}`,
        zh: verdict.reason === '' ? `${zhHead}。` : `${zhHead}：${verdict.reason}`,
      },
    }
  }

  /** Review one call and decide between running it and asking the user. */
  async function gate(exec, next) {
    const agent = exec.agent
    const settings = readSettings(config)
    const signal = AbortSignal.any([exec.signal, lifecycle.signal])
    const cwd = await resolveCwd(ctx, agent, signal)
    const route = routeCall(exec.name, exec.arguments, {
      cwd,
      scope: settings.scope,
      trustedTools: settings.trustedTools,
    })
    if (route.action === 'skip') return next()

    let verdict
    if (route.action === 'ask') {
      const sensitive = route.signals.some(item => item.kind !== 'danger')
      verdict = { confirm: true, risk: sensitive ? undefined : 'high', sensitive, reason: `命中本地规则：${describeSignals(route.signals)}`, source: 'rule' }
    } else {
      const key = JSON.stringify([
        exec.name, exec.arguments, cwd, settings.provider, settings.model,
        settings.reasoningEffort, settings.threshold, settings.customRules,
      ])
      verdict = verdicts.get(key)
      if (verdict === undefined) {
        try {
          const { decision, target } = await review(agent, exec, settings, route, cwd, signal)
          verdict = {
            confirm: needsConfirmation(decision, settings.threshold, route.signals),
            risk: decision.risk,
            sensitive: decision.sensitive,
            reason: decision.reason,
            source: 'model',
          }
          verdicts.set(key, verdict)
          ctx.logger.debug(`autoreview: ${exec.name} → ${decision.risk}${decision.sensitive ? '+sensitive' : ''} via ${target.provider}/${target.model}: ${decision.reason}`)
        } catch (error) {
          if (lifecycle.signal.aborted || exec.signal.aborted) return { kind: 'cancel' }
          const message = messageOf(error)
          ctx.logger.warn(`autoreview: review of "${exec.name}" failed: ${message}`)
          if (settings.onError === 'deny') {
            return {
              kind: 'deny',
              reason: `Auto review of tool "${exec.name}" failed; its body was not executed: ${message}`,
            }
          }
          verdict = { confirm: true, risk: undefined, sensitive: false, reason: message, source: 'error' }
        }
      }
    }
    if (lifecycle.signal.aborted) return { kind: 'cancel' }
    if (!verdict.confirm) return next()

    // The permission owner pins an approval policy into every published Session;
    // a delegated child pins `never`, so its confirmations cannot reach the user.
    if (ctx.approval.overrideOf(agent.session) === 'never') {
      return {
        kind: 'deny',
        reason: `Auto review requires user confirmation for tool "${exec.name}", but approval prompts are disabled in this session; its body was not executed`,
        info: { name: UNAVAILABLE_ERROR_NAME, code: UNAVAILABLE_CODE, reason: verdict.reason },
      }
    }
    // Later listeners keep their own denials, cancellations and asks.
    const downstream = await next()
    if (lifecycle.signal.aborted) return { kind: 'cancel' }
    if (downstream.kind !== 'allow') return downstream
    return askUser(exec, verdict)
  }

  ctx.on('llm/adapters-updated', () => {
    efforts.clear()
  })

  ctx.effect(function* () {
    const stopListener = ctx.on('tools/pre-execute', async (exec, next) => {
      const agent = exec.agent
      if (agent === undefined || (exec.parent === undefined && exec.name === RUN_CODE_NAME)) return next()
      if (permissionPresets.current(agent.session) !== AUTO_PRESET) return next()
      if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }
      const settled = Promise.withResolvers()
      active.add(settled.promise)
      try {
        return await gate(exec, next)
      } finally {
        active.delete(settled.promise)
        settled.resolve()
      }
    }, { prepend: true })
    yield stopListener

    let stopContribution
    try {
      stopContribution = permissionPresets.registerAuto(() => {
        if (!accepting) throw new Error('autoreview: integration is closing')
      })
    } catch (error) {
      throw new Error(`autoreview: the "auto" permission preset is already provided by another plugin (for example the official experimental Auto review); disable it first. ${messageOf(error)}`)
    }
    yield stopContribution

    yield async () => {
      accepting = false
      try {
        // A stored Auto identity cannot be restored without its integration.
        const fallback = permissionPresets.names.includes('danger-full-access')
          ? 'danger-full-access'
          : permissionPresets.names.find(item => item !== AUTO_PRESET)
        if (fallback !== undefined) {
          for (const session of ctx.sessions.list()) {
            if (permissionPresets.current(session) !== AUTO_PRESET) continue
            permissionPresets.set(session, fallback)
          }
        }
      } finally {
        lifecycle.abort(new Error('autoreview integration disposed'))
        await Promise.allSettled([...active])
        verdicts.clear()
      }
    }
  }, 'autoreview lifecycle')
}
