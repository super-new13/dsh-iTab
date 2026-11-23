/* dsh-iTab — the bundle's configuration page (Settings → Plugins →
 * dsh-itab). Rendered only for view === 'page'; every row writes
 * through the shared view store so the strip reacts live. */

function ItabBundleConfig(props) {
  const { view, useStore, actions, t } = props
  const React = P.React
  const E = P.E
  if (view !== 'page') return null
  const prefs = (typeof useStore === 'function' ? useStore((s) => s.prefs) : null) || {}
  const setPref = (key, value) => { if (actions && typeof actions.setPref === 'function') actions.setPref(key, value) }

  const enabled = prefs.enabled !== false
  const maxWidth = maxWidthFromPrefs(prefs)
  const cap = capFromPrefs(prefs)
  const statusDots = prefs.statusDots !== false
  const middleClickClose = prefs.middleClickClose !== false
  // 'replace' must be chosen explicitly; anything else (including a key
  // missing from an older snapshot) keeps the browser-like open default.
  const sidebarOpen = prefs.sidebarOpen === 'replace' ? 'replace' : 'open'

  const switchRow = (key, label, hint, value) =>
    E('div', { className: 'itab-cfg-row', key: key },
      E('div', { className: 'itab-cfg-main' },
        E('span', { className: 'itab-cfg-label' }, label),
        hint ? E('span', { className: 'itab-cfg-hint' }, hint) : null,
      ),
      E('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': value ? 'true' : 'false',
        className: cls('itab-switch', value && 'itab-switch-on'),
        onClick: () => setPref(key, !value),
      }),
    )

  const segRow = (key, label, hint, choices, value, nameOf) =>
    E('div', { className: 'itab-cfg-row', key: key },
      E('div', { className: 'itab-cfg-main' },
        E('span', { className: 'itab-cfg-label' }, label),
        hint ? E('span', { className: 'itab-cfg-hint' }, hint) : null,
      ),
      E('div', { className: 'itab-seg', role: 'radiogroup', 'aria-label': label },
        choices.map((choice) => E('button', {
          key: String(choice),
          type: 'button',
          role: 'radio',
          'aria-checked': choice === value ? 'true' : 'false',
          className: cls('itab-seg-btn', choice === value && 'itab-seg-btn-active'),
          onClick: () => setPref(key, choice),
        }, nameOf ? nameOf(choice) : String(choice))),
      ),
    )

  return E('div', { className: 'itab-cfg' },
    StyleNode(),
    switchRow('enabled', t('config.enabled'), t('config.enabledHint'), enabled),
    segRow('maxWidth', t('config.maxWidth'), null, [160, 200, 240, 300], maxWidth, (v) => v + 'px'),
    segRow('maxTabs', t('config.maxTabs'), null, [8, 12, 20, 30], cap),
    switchRow('statusDots', t('config.statusDots'), t('config.statusDotsHint'), statusDots),
    switchRow('statusPulse', t('config.statusPulse'), t('config.statusPulseHint'), prefs.statusPulse === true),
    switchRow('middleClickClose', t('config.middleClickClose'), null, middleClickClose),
    segRow('sidebarOpen', t('config.sidebarOpen'), null, ['open', 'replace'], sidebarOpen, (v) => t('config.sidebarOpen.' + v)),
  )
}
