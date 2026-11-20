/* dsh-iTab — the shared preference store.
 *
 * One store handle for every seat (the strip in the header and the
 * bundle's config page), created once per client factory. The seats all
 * mount at root scope, so the renderer hands each of them the same
 * instance. Persisted state is hydrated WHOLESALE (init defaults never
 * merge into a restored snapshot), so every reader takes fallbacks for
 * keys an older snapshot may not carry.
 */
function createViewStore() {
  if (!P.storeKit || typeof P.storeKit.defineStore !== 'function') return null
  return P.storeKit.defineStore({
    init: () => ({
      prefs: {
        enabled: true,
        maxWidth: 240,
        maxTabs: 20,
        statusDots: true,
        middleClickClose: true,
        sidebarOpen: 'replace',
      },
    }),
    persist: 'dsh.itab.view.v1',
    actions: {
      setPref(d, key, value) {
        if (!d.prefs) d.prefs = {}
        d.prefs[key] = value
      },
    },
  })
}

/** Effective tab cap from prefs (bounded to the known choice set). */
function capFromPrefs(prefs) {
  const value = Number(prefs && prefs.maxTabs)
  return value === 8 || value === 12 || value === 20 || value === 30 ? value : DEFAULT_MAX_TABS
}

/** Effective max chip width from prefs (bounded to the known choice set). */
function maxWidthFromPrefs(prefs) {
  const value = Number(prefs && prefs.maxWidth)
  return value === 160 || value === 200 || value === 240 || value === 300 ? value : 240
}
