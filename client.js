/**
 * Browser half of dsh-plugin-autoreview: the settings page rendered on this
 * bundle's page in the sidebar Plugins view. It edits the Host row's volatile
 * Config through ctx.configForms and reads selectable models and reasoning
 * efforts from the shared session model catalog.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-autoreview',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState, useSyncExternalStore } = React

    /** npm package name; keys the bundle's config slot. */
    const PACKAGE = 'dsh-plugin-autoreview'
    /** Loader row id declared by cordis.patch.yml; names the settings namespace. */
    const ROW_ID = 'dsh-autoreview'
    /** Locale dictionary namespace owned by this page. */
    const NS = 'dsh-autoreview'

    const zh = {
      summary: '按风险自动审查工具调用：高风险或涉及敏感信息时才请你确认。',
      intro: '在输入框下方的权限选择器中选择「自动审查」后生效。低、中风险调用直接执行；高风险、读取或外发敏感信息、以及审查失败的调用会弹出确认。',
      loading: '正在读取配置…',
      unavailable: 'Host 当前没有提供这个插件的配置。请确认组合包和 dsh-autoreview 行已启用，必要时重启 DSH Desktop。',
      readonly: '当前 Host 配置文档只读，无法保存。',
      sectionModel: '审查模型',
      model: '模型',
      modelHint: '用于判断风险的模型。跟随会话时使用被审查会话当前的模型。',
      followSession: '跟随当前会话模型',
      unavailableRoute: '{route}（当前不可用）',
      catalogLoading: '正在加载模型列表…',
      catalogError: '模型列表加载失败：{error}',
      catalogPartial: '部分提供方的模型列表加载失败。',
      retry: '重试',
      effort: '思考程度',
      effortHint: '审查请求使用的推理强度。思考越深越准确，但更慢、更耗 token。',
      effortDefault: '模型默认',
      effortDefaultNamed: '模型默认（{name}）',
      effortUnknown: '{id}（当前模型不支持）',
      effortNone: '所选模型不提供可选的思考程度。',
      effortFollow: '跟随会话时，列表汇总所有模型的选项；当前会话模型不支持时自动改用默认。',
      sectionPolicy: '审查策略',
      threshold: '需要确认的风险',
      thresholdHint: '涉及敏感信息的调用始终需要确认。',
      thresholdHigh: '仅高风险',
      thresholdMedium: '中风险及以上',
      scope: '审查范围',
      scopeHint: '均衡：只读工具和项目内文件编辑在未命中本地规则时直接执行，节省 token；全部：每次工具调用都交给模型审查。',
      scopeBalanced: '均衡',
      scopeAll: '全部',
      onError: '审查失败时',
      onErrorHint: '模型报错、超时或输出无法解析时的处理方式。',
      onErrorAsk: '请我确认',
      onErrorDeny: '直接拒绝',
      timeout: '超时（秒）',
      timeoutHint: '单次审查请求的最长等待时间，5–600 秒。',
      trusted: '信任的工具',
      trustedHint: '这些工具名不再审查，用逗号或空格分隔，例如 todo_write, web_search。',
      rules: '自定义规则',
      rulesHint: '追加给审查模型的自然语言规则，例如“对 production 目录的任何写入都视为高风险”。',
      rulesPlaceholder: '每行一条规则（可留空）',
      save: '保存',
      saving: '正在保存…',
      discard: '放弃修改',
      defaults: '恢复默认',
      saved: '已保存，新设置对下一次工具调用生效。',
      saveFailed: 'Host 拒绝了这次保存，已重新读取最新配置。',
      saveError: '保存失败：{error}',
      conflict: '配置已在别处更新。放弃修改后再编辑，以免覆盖较新的值。',
      timeoutInvalid: '请输入 5 到 600 之间的整数。',
    }

    const en = {
      summary: 'Reviews tool calls by risk and asks you only for high-risk or sensitive ones.',
      intro: 'Takes effect after you choose "Auto review" in the permission picker under the composer. Low- and medium-risk calls run immediately; high-risk calls, calls that read or send sensitive data, and calls the reviewer cannot judge ask for your confirmation.',
      loading: 'Loading settings…',
      unavailable: 'The Host does not serve this plugin\'s settings. Make sure the bundle and its dsh-autoreview row are enabled, and restart DSH Desktop if needed.',
      readonly: 'The Host settings document is read-only.',
      sectionModel: 'Reviewer model',
      model: 'Model',
      modelHint: 'Model that judges the risk. Follow session uses the reviewed session\'s current model.',
      followSession: 'Follow the session model',
      unavailableRoute: '{route} (unavailable)',
      catalogLoading: 'Loading models…',
      catalogError: 'Could not load models: {error}',
      catalogPartial: 'Some providers failed to list their models.',
      retry: 'Retry',
      effort: 'Reasoning effort',
      effortHint: 'Reasoning effort of review requests. Deeper is more accurate but slower and costs more tokens.',
      effortDefault: 'Model default',
      effortDefaultNamed: 'Model default ({name})',
      effortUnknown: '{id} (not supported by this model)',
      effortNone: 'The selected model offers no reasoning effort options.',
      effortFollow: 'While following the session, the list merges every model\'s options; an unsupported choice falls back to the default.',
      sectionPolicy: 'Review policy',
      threshold: 'Ask from',
      thresholdHint: 'Calls that touch sensitive data always ask.',
      thresholdHigh: 'High risk only',
      thresholdMedium: 'Medium and high',
      scope: 'Scope',
      scopeHint: 'Balanced runs read-only tools and project-local edits without review unless a local rule fires; All sends every call to the reviewer.',
      scopeBalanced: 'Balanced',
      scopeAll: 'All',
      onError: 'When review fails',
      onErrorHint: 'What happens when the reviewer errors, times out, or returns unreadable output.',
      onErrorAsk: 'Ask me',
      onErrorDeny: 'Deny',
      timeout: 'Timeout (seconds)',
      timeoutHint: 'Upper bound for one review request, 5–600 seconds.',
      trusted: 'Trusted tools',
      trustedHint: 'Tool names that skip review, separated by commas or spaces, e.g. todo_write, web_search.',
      rules: 'Custom rules',
      rulesHint: 'Extra natural-language rules for the reviewer, e.g. "any write under production/ is high risk".',
      rulesPlaceholder: 'One rule per line (optional)',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      defaults: 'Restore defaults',
      saved: 'Saved. New settings apply to the next tool call.',
      saveFailed: 'The Host refused this save and the latest settings were reloaded.',
      saveError: 'Save failed: {error}',
      conflict: 'Settings changed elsewhere. Discard your edits before editing again so newer values are not overwritten.',
      timeoutInvalid: 'Enter a whole number from 5 to 600.',
    }

    /** Host Config defaults, mirrored for the "restore defaults" action. */
    const DEFAULTS = {
      provider: '',
      model: '',
      reasoningEffort: '',
      threshold: 'high',
      scope: 'balanced',
      onError: 'ask',
      timeoutSeconds: 90,
      trustedTools: [],
      customRules: '',
    }
    const FIELDS = Object.keys(DEFAULTS)
    /** Common effort ids from least to most reasoning; merged lists follow this order. */
    const EFFORT_ORDER = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

    /** Encode one provider/model route as a select value; '' follows the session. */
    function routeValue(provider, model) {
      return provider === '' || model === '' ? '' : JSON.stringify([provider, model])
    }

    /** Split trusted-tool text into names. */
    function parseTools(text) {
      return text.split(/[\s,，;；]+/).map(item => item.trim()).filter(item => item !== '')
    }

    /** The editable draft shape of one accepted Host value. */
    function toDraft(value) {
      const source = { ...DEFAULTS, ...(value ?? {}) }
      return {
        route: routeValue(source.provider, source.model),
        provider: source.provider,
        model: source.model,
        reasoningEffort: source.reasoningEffort,
        threshold: source.threshold,
        scope: source.scope,
        onError: source.onError,
        timeoutText: String(source.timeoutSeconds),
        trustedText: (source.trustedTools ?? []).join(', '),
        customRules: source.customRules,
      }
    }

    /** The Host field values of one draft; undefined timeout marks an invalid draft. */
    function fromDraft(draft) {
      const timeout = Number(draft.timeoutText)
      return {
        provider: draft.provider,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort,
        threshold: draft.threshold,
        scope: draft.scope,
        onError: draft.onError,
        timeoutSeconds: Number.isInteger(timeout) && timeout >= 5 && timeout <= 600 ? timeout : undefined,
        trustedTools: parseTools(draft.trustedText),
        customRules: draft.customRules,
      }
    }

    function same(left, right) {
      return JSON.stringify(left) === JSON.stringify(right)
    }

    /** One shared, lazily loaded model catalog for every mounted page. */
    function createCatalog(ctx) {
      let snapshot = { status: 'idle', groups: [], partial: false, error: '' }
      let generation = 0
      const listeners = new Set()
      const publish = (next) => {
        snapshot = next
        for (const listener of [...listeners]) listener()
      }
      const refresh = () => {
        const current = ++generation
        publish({ ...snapshot, status: 'loading', error: '' })
        Promise.resolve(ctx.remote.session.modelCatalog()).then((response) => {
          if (current !== generation) return
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          publish({
            status: 'ready',
            groups: response.value.groups,
            partial: response.value.failures.length > 0,
            error: '',
          })
        }).catch((error) => {
          if (current !== generation) return
          publish({ ...snapshot, status: 'error', error: error instanceof Error ? error.message : String(error) })
        })
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        ensure: () => { if (snapshot.status === 'idle') refresh() },
        refresh,
        dispose: () => { generation += 1 },
      }
    }

    const CSS = `
.dar-root { display: grid; gap: 20px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dar-intro { margin: 0; color: var(--dsw-alias-label-secondary); }
.dar-section { display: grid; gap: 4px; padding: 4px 16px; border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3)); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-settings-card-fill, transparent); }
.dar-section-title { margin: 0; padding: 12px 0 4px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dar-field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 320px); align-items: start; gap: 8px 24px; padding: 12px 0; }
.dar-field + .dar-field { border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dar-field.dar-wide { grid-template-columns: minmax(0, 1fr); }
.dar-label { font-weight: 500; }
.dar-hint { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dar-note { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dar-error { margin: 0; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.dar-success { margin: 0; font-size: 12px; color: var(--dsw-alias-state-success-primary); }
.dar-control { display: grid; gap: 6px; min-width: 0; }
.dar-select, .dar-input, .dar-textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 0 8px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.dar-select, .dar-input { height: 32px; }
.dar-textarea { min-height: 88px; padding: 8px; resize: vertical; line-height: 1.5; }
.dar-select:focus, .dar-input:focus, .dar-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.dar-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dar-input::placeholder, .dar-textarea::placeholder { color: var(--dsw-alias-label-dimmed); }
.dar-segments { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover); justify-self: start; }
.dar-segment { height: 28px; padding: 0 12px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; }
.dar-segment:hover:not(:disabled), .dar-segment[aria-checked='true'] { color: var(--dsw-alias-label-primary); }
.dar-segment[aria-checked='true'] { background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-soft); }
.dar-segment:disabled { cursor: not-allowed; opacity: 0.4; }
.dar-link { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-link, var(--dsw-alias-brand-primary)); font: inherit; font-size: 12px; cursor: pointer; }
.dar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dar-actions-spacer { flex: 1; }
.dar-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
.dar-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dar-button.dar-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dar-button.dar-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill)); }
.dar-button:disabled { cursor: not-allowed; opacity: 0.4; }
@media (max-width: 640px) { .dar-field { grid-template-columns: minmax(0, 1fr); } }
`

    return {
      inject: ['slots', 'locale', 'remote', 'remote.session', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'autoreview: dictionaries')
        const form = ctx.configForms.get(ROW_ID)
        const catalog = createCatalog(ctx)
        const subscribeForm = listener => form.subscribe(listener)
        const readForm = () => form.getSnapshot()
        ctx.effect(() => () => { catalog.dispose() }, 'autoreview: model catalog')
        ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { catalog.refresh() }), 'autoreview: adapter invalidations')
        ctx.effect(() => ctx.on('connection/reset', () => { catalog.refresh() }), 'autoreview: connection generation')

        /** One labelled row: text on the left, control on the right. */
        function Field({ label, hint, wide, children }) {
          return h('div', { className: wide ? 'dar-field dar-wide' : 'dar-field' },
            h('div', null,
              h('div', { className: 'dar-label' }, label),
              hint ? h('p', { className: 'dar-hint' }, hint) : null),
            h('div', { className: 'dar-control' }, children))
        }

        /** Radio-group segmented control. */
        function Segments({ value, options, onChange, disabled, label }) {
          return h('div', { className: 'dar-segments', role: 'radiogroup', 'aria-label': label },
            options.map(option => h('button', {
              key: option.value,
              type: 'button',
              role: 'radio',
              className: 'dar-segment',
              'aria-checked': value === option.value,
              disabled,
              onClick: () => { onChange(option.value) },
            }, option.label)))
        }

        /** Look up one catalog model. */
        function findModel(groups, provider, model) {
          return groups.find(group => group.id === provider)?.models.find(item => item.id === model)
        }

        /** Effort options for the drafted route, plus the default entry. */
        function effortOptions(t, groups, draft) {
          const options = []
          let note
          if (draft.route === '') {
            const seen = new Map()
            for (const group of groups) {
              for (const model of group.models) {
                for (const effort of model.reasoning?.efforts ?? []) {
                  if (!seen.has(effort.id)) seen.set(effort.id, effort.name)
                }
              }
            }
            options.push({ value: '', label: t('effortDefault') })
            const rank = id => {
              const index = EFFORT_ORDER.indexOf(id)
              return index === -1 ? EFFORT_ORDER.length : index
            }
            const merged = [...seen].sort((left, right) => rank(left[0]) - rank(right[0]))
            for (const [id, label] of merged) options.push({ value: id, label })
            note = t('effortFollow')
          } else {
            const model = findModel(groups, draft.provider, draft.model)
            const efforts = model?.reasoning?.efforts ?? []
            const fallback = efforts.find(effort => effort.id === model?.reasoning?.defaultEffort)
            options.push({ value: '', label: fallback ? t('effortDefaultNamed', { name: fallback.name }) : t('effortDefault') })
            for (const effort of efforts) options.push({ value: effort.id, label: effort.name })
            if (model !== undefined && efforts.length === 0) note = t('effortNone')
          }
          if (draft.reasoningEffort !== '' && !options.some(option => option.value === draft.reasoningEffort)) {
            options.push({ value: draft.reasoningEffort, label: t('effortUnknown', { id: draft.reasoningEffort }) })
          }
          return { options, note }
        }

        function Editor({ t }) {
          const snapshot = useSyncExternalStore(subscribeForm, readForm)
          const models = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
          useEffect(() => { catalog.ensure() }, [])
          const stored = useMemo(() => toDraft(snapshot.value), [snapshot.value])
          const [draft, setDraft] = useState(undefined)
          const [fence, setFence] = useState(undefined)
          const [status, setStatus] = useState({ kind: 'idle' })

          if (snapshot.status === 'loading') return h('p', { className: 'dar-note' }, t('loading'))
          if (snapshot.status === 'unavailable') return h('p', { className: 'dar-error' }, t('unavailable'))

          const current = draft ?? stored
          const values = fromDraft(current)
          const storedValues = fromDraft(stored)
          const changed = FIELDS.filter(field => !same(values[field], storedValues[field]))
          const dirty = draft !== undefined && changed.length > 0
          const conflicted = dirty && fence !== undefined && snapshot.revision !== fence
          const invalidTimeout = values.timeoutSeconds === undefined
          const busy = status.kind === 'saving'
          const locked = !snapshot.writable || busy

          const edit = (patch) => {
            if (draft === undefined) setFence(snapshot.revision)
            setDraft({ ...current, ...patch })
            setStatus({ kind: 'idle' })
          }
          const discard = () => {
            setDraft(undefined)
            setFence(undefined)
            setStatus({ kind: 'idle' })
          }
          const save = async () => {
            if (!dirty || invalidTimeout || conflicted) return
            const ops = changed.map(field => ({ op: 'set', path: [field], value: values[field] }))
            setStatus({ kind: 'saving' })
            try {
              const accepted = await form.mutate(ops, fence)
              if (accepted) {
                setDraft(undefined)
                setFence(undefined)
                setStatus({ kind: 'saved' })
              } else {
                setStatus({ kind: 'refused' })
              }
            } catch (error) {
              setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
            }
          }

          const onRoute = (value) => {
            if (value === '') {
              edit({ route: '', provider: '', model: '' })
              return
            }
            const [provider, model] = JSON.parse(value)
            const efforts = findModel(models.groups, provider, model)?.reasoning?.efforts ?? []
            const keepEffort = efforts.some(effort => effort.id === current.reasoningEffort)
            edit({ route: value, provider, model, reasoningEffort: keepEffort ? current.reasoningEffort : '' })
          }

          const routeKnown = current.route === ''
            || findModel(models.groups, current.provider, current.model) !== undefined
          const routeOptions = [h('option', { key: 'follow', value: '' }, t('followSession'))]
          for (const group of models.groups) {
            routeOptions.push(h('optgroup', { key: group.id, label: group.name },
              group.models.map(model => h('option', { key: model.id, value: routeValue(group.id, model.id) }, model.name))))
          }
          if (!routeKnown) {
            routeOptions.push(h('option', { key: 'missing', value: current.route },
              t('unavailableRoute', { route: `${current.provider}/${current.model}` })))
          }
          const efforts = effortOptions(t, models.groups, current)

          let catalogLine = null
          if (models.status === 'loading' && models.groups.length === 0) {
            catalogLine = h('p', { className: 'dar-note' }, t('catalogLoading'))
          } else if (models.status === 'error') {
            catalogLine = h('p', { className: 'dar-error' }, t('catalogError', { error: models.error }), ' ',
              h('button', { type: 'button', className: 'dar-link', onClick: catalog.refresh }, t('retry')))
          } else if (models.partial) {
            catalogLine = h('p', { className: 'dar-note' }, t('catalogPartial'), ' ',
              h('button', { type: 'button', className: 'dar-link', onClick: catalog.refresh }, t('retry')))
          }

          let statusLine = null
          if (conflicted) statusLine = h('p', { className: 'dar-error', role: 'alert' }, t('conflict'))
          else if (status.kind === 'saved') statusLine = h('p', { className: 'dar-success', role: 'status' }, t('saved'))
          else if (status.kind === 'refused') statusLine = h('p', { className: 'dar-error', role: 'alert' }, t('saveFailed'))
          else if (status.kind === 'error') statusLine = h('p', { className: 'dar-error', role: 'alert' }, t('saveError', { error: status.message }))
          else if (!snapshot.writable) statusLine = h('p', { className: 'dar-note' }, t('readonly'))

          return h('div', { className: 'dar-root' },
            h('style', null, CSS),
            h('p', { className: 'dar-intro' }, t('intro')),
            h('section', { className: 'dar-section' },
              h('h3', { className: 'dar-section-title' }, t('sectionModel')),
              h(Field, { label: t('model'), hint: t('modelHint') },
                h('select', {
                  className: 'dar-select',
                  value: current.route,
                  disabled: locked,
                  'aria-label': t('model'),
                  onChange: event => { onRoute(event.target.value) },
                }, routeOptions),
                catalogLine),
              h(Field, { label: t('effort'), hint: t('effortHint') },
                h('select', {
                  className: 'dar-select',
                  value: current.reasoningEffort,
                  disabled: locked,
                  'aria-label': t('effort'),
                  onChange: event => { edit({ reasoningEffort: event.target.value }) },
                }, efforts.options.map(option => h('option', { key: option.value, value: option.value }, option.label))),
                efforts.note ? h('p', { className: 'dar-note' }, efforts.note) : null)),
            h('section', { className: 'dar-section' },
              h('h3', { className: 'dar-section-title' }, t('sectionPolicy')),
              h(Field, { label: t('threshold'), hint: t('thresholdHint') },
                h(Segments, {
                  label: t('threshold'),
                  value: current.threshold,
                  disabled: locked,
                  onChange: value => { edit({ threshold: value }) },
                  options: [
                    { value: 'high', label: t('thresholdHigh') },
                    { value: 'medium', label: t('thresholdMedium') },
                  ],
                })),
              h(Field, { label: t('scope'), hint: t('scopeHint') },
                h(Segments, {
                  label: t('scope'),
                  value: current.scope,
                  disabled: locked,
                  onChange: value => { edit({ scope: value }) },
                  options: [
                    { value: 'balanced', label: t('scopeBalanced') },
                    { value: 'all', label: t('scopeAll') },
                  ],
                })),
              h(Field, { label: t('onError'), hint: t('onErrorHint') },
                h(Segments, {
                  label: t('onError'),
                  value: current.onError,
                  disabled: locked,
                  onChange: value => { edit({ onError: value }) },
                  options: [
                    { value: 'ask', label: t('onErrorAsk') },
                    { value: 'deny', label: t('onErrorDeny') },
                  ],
                })),
              h(Field, { label: t('timeout'), hint: t('timeoutHint') },
                h('input', {
                  className: 'dar-input',
                  type: 'number',
                  min: 5,
                  max: 600,
                  step: 1,
                  value: current.timeoutText,
                  disabled: locked,
                  'aria-label': t('timeout'),
                  'aria-invalid': invalidTimeout,
                  onChange: event => { edit({ timeoutText: event.target.value }) },
                }),
                invalidTimeout ? h('p', { className: 'dar-error' }, t('timeoutInvalid')) : null),
              h(Field, { label: t('trusted'), hint: t('trustedHint') },
                h('input', {
                  className: 'dar-input',
                  type: 'text',
                  spellCheck: false,
                  value: current.trustedText,
                  disabled: locked,
                  placeholder: 'todo_write, web_search',
                  'aria-label': t('trusted'),
                  onChange: event => { edit({ trustedText: event.target.value }) },
                })),
              h(Field, { label: t('rules'), hint: t('rulesHint'), wide: true },
                h('textarea', {
                  className: 'dar-textarea',
                  value: current.customRules,
                  disabled: locked,
                  placeholder: t('rulesPlaceholder'),
                  'aria-label': t('rules'),
                  onChange: event => { edit({ customRules: event.target.value }) },
                }))),
            h('div', { className: 'dar-actions' },
              h('button', {
                type: 'button',
                className: 'dar-button',
                disabled: locked,
                onClick: () => { edit(toDraft(DEFAULTS)) },
              }, t('defaults')),
              h('span', { className: 'dar-actions-spacer' }),
              h('button', {
                type: 'button',
                className: 'dar-button',
                disabled: busy || draft === undefined,
                onClick: discard,
              }, t('discard')),
              h('button', {
                type: 'button',
                className: 'dar-button dar-primary',
                disabled: locked || !dirty || invalidTimeout || conflicted,
                onClick: () => { void save() },
              }, busy ? t('saving') : t('save'))),
            statusLine)
        }

        function Page({ view, t }) {
          if (view === 'summary') return t('summary')
          return h(Editor, { t })
        }

        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE,
          locale: NS,
        }, Page))
      },
    }
  },
})
