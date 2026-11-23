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
  migrateViewStore()
  return P.storeKit.defineStore({
    init: () => ({
      prefs: {
        enabled: true,
        maxWidth: 240,
        maxTabs: 20,
        statusDots: true,
        middleClickClose: true,
        sidebarOpen: 'open',
      },
    }),
    persist: 'dsh.itab.view.v2',
    actions: {
      setPref(d, key, value) {
        if (!d.prefs) d.prefs = {}
        d.prefs[key] = value
      },
    },
  })
}

/* v1 → v2: the sidebar-open default changed from 'replace' to 'open' —
 * replacing the on-screen tab read as a bug (a running session's tab,
 * status dot included, vanished when any sidebar row was clicked).
 * Hydration is WHOLESALE, so the new default never reaches a stored v1
 * snapshot: copy the prefs forward WITHOUT sidebarOpen (it re-defaults
 * to 'open'), then drop v1. Idempotent, and a no-op where v2 already
 * exists or localStorage is unavailable. */
export function migrateViewStore() {
  const LEGACY_KEY = 'dsh.itab.view.v1'
  const KEY = 'dsh.itab.view.v2'
  if (typeof localStorage === 'undefined') return
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === null) return
    if (localStorage.getItem(KEY) === null) {
      const parsed = JSON.parse(legacy)
      const prefs = parsed && parsed.prefs ? { ...parsed.prefs } : {}
      delete prefs.sidebarOpen
      localStorage.setItem(KEY, JSON.stringify({ prefs }))
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* corrupt legacy payload — leave it; the store starts from defaults */
  }
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
