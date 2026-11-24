/* dsh-iTab — React hooks for the tab strip.
 *
 * Adapted from the reference plugin's proven implementations: overflow
 * measurement, active-chip reveal, wheel scrolling, header-room fill,
 * chips parking, and HTML5 drag reorder. Renamed to the itab prefix;
 * the strip deliberately avoids any "_tabs" class substring so the
 * shell's own view-nav selectors keep matching only the shell's row. */

/** Live subscription to the persisted tab list. */
function useTabs() {
  const React = P.React
  const [tabs, setTabs] = React.useState(tabsSnapshot)
  React.useEffect(() => subscribeTabs(setTabs), [])
  return tabs
}

/** Mirrors html[data-itab-off] so the header override CSS falls back to
 *  the stock header when the strip is disabled in the config page. */
function useTabsSurface(enabled) {
  const React = P.React
  const useIsoLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return undefined
    const root = document.documentElement
    if (!enabled) root.setAttribute('data-itab-off', '1')
    else root.removeAttribute('data-itab-off')
    return () => { root.removeAttribute('data-itab-off') }
  }, [enabled])
}

/** Keeps the persisted tab list attached to the session on screen.
 *
 * Reconciles on every sessions-store change: archived sessions drop,
 * sessions deleted from the sidebar drop too (their tab closes by
 * itself — once the host's session list has loaded), blank (newly
 * created) sessions gain their chip, and a navigation is an open
 * (default) or a replace (opt-in) per prefs. When the session on screen
 * is the one deleted, the strip lands on the last surviving tab instead
 * of chasing the host to its fresh blank session. Writes only when the
 * list actually changed, so an idle store costs no renders. */
// Module scope on purpose: the shell remounts the conversation header (and
// this strip with it) on every navigation, which wipes any useRef. Keeping
// the last on-screen session id in the module lets the post-remount
// reconcile still see the session it navigated FROM, so a sidebar click
// replaces the active tab instead of appending a new one.
let lastCurrentId = ''
// The deleted session id that already sent the strip to its fallback tab,
// so a store tick landing before the host finishes navigating cannot ask
// for the same redirect twice.
let fallbackFrom = ''

const sameTabList = (a, b) => a.length === b.length && a.every((id, at) => id === b[at])

function useTabSync(sessions, useWorkspaces, prefs, open) {
  const React = P.React
  const workspaces = typeof useWorkspaces === 'function' ? useWorkspaces((s) => s) : null
  const archivedIds = (workspaces && workspaces.archivedSessionIds) || []
  // 'replace' must be chosen explicitly; anything else (including a key
  // missing from an older snapshot) keeps the browser-like open default.
  const sidebarOpen = prefs.sidebarOpen === 'replace' ? 'replace' : 'open'
  const cap = capFromPrefs(prefs)
  React.useEffect(() => {
    const byId = sessions && sessions.byId ? sessions.byId : null
    // The host list starts 'pending' with an EMPTY byId and only becomes
    // authoritative once the baseline fetch landed ('ready'). Pruning by
    // membership before that would wipe every persisted tab at startup.
    const listReady = !!(byId && sessions && sessions.phase === 'ready')
    const current = currentSessionIdOf(sessions)
    const previous = lastCurrentId || undefined
    const archived = new Set(archivedIds.map(String))
    const isArchived = (id) => archived.has(String(id))
    const isDeleted = listReady ? (id) => !byId[id] : () => false
    // The chips that still point at a live, unarchived session.
    const live = tabsSnapshot().filter((id) => !isArchived(id) && !isDeleted(id))

    // The session that was on screen is the one deleted from the sidebar.
    // The host lands on a brand-new blank session (or nowhere at all), and
    // minting a chip for that landing is not what a tab strip should do:
    // fall back to the last surviving tab, the way closing a browser tab
    // does. When nothing survives, the open/replace rule below still runs
    // so the blank session keeps a chip — an empty strip would be a dead end.
    const onScreenDeleted = !!(listReady && previous && !byId[previous])
    if (onScreenDeleted && live.length && !(current && live.includes(current))) {
      const target = live[live.length - 1]
      if (!sameTabList(tabsSnapshot(), live)) saveTabs(live, target)
      else if (tabsActive() !== target) setActiveTab(target)
      if (typeof open === 'function' && target !== current && fallbackFrom !== previous) {
        fallbackFrom = previous
        open(target)
      }
      return
    }
    fallbackFrom = ''

    if (!current) {
      // No session on screen (e.g. the last one was just deleted): still
      // prune, so the strip does not keep a chip for a session that is gone.
      if (!listReady || sameTabList(tabsSnapshot(), live)) return
      const active = tabsActive()
      if (active && live.includes(active)) saveTabs(live)
      else saveTabs(live, '')
      return
    }
    lastCurrentId = current
    if (previous !== current && tabsActive() !== current) setActiveTab(current)
    const next = reconcileTabs(tabsSnapshot(), current, previous, {
      isBlank: (id) => !!(byId && byId[id] && byId[id].blank),
      isArchived,
      isDeleted,
      sidebarOpen,
      cap,
    })
    const before = tabsSnapshot()
    const storedActive = tabsActive()
    const activeGone = !!storedActive && !next.includes(storedActive)
    const listChanged = !sameTabList(before, next)
    if (!listChanged && !activeGone) return
    // saveTabs treats a second argument as "set the active id", so the
    // no-fallback write must pass exactly one argument.
    if (activeGone) saveTabs(next, current || '')
    else saveTabs(next)
  }, [sessions, archivedIds, sidebarOpen, cap])
}

/** Whether the strip overflows and which edges can scroll. */
function useStripOverflow(stripRef, deps) {
  const React = P.React
  const [state, setState] = React.useState({ overflowing: false, canLeft: false, canRight: false })
  React.useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return undefined
    const measure = () => {
      const overflowing = el.scrollWidth > el.clientWidth + 1
      const canLeft = el.scrollLeft > 1
      const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setState((prev) => (prev.overflowing === overflowing && prev.canLeft === canLeft && prev.canRight === canRight
        ? prev
        : { overflowing, canLeft, canRight }))
    }
    measure()
    let observer = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure)
      observer.observe(el)
      for (const child of Array.from(el.children)) observer.observe(child)
    }
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      if (observer) observer.disconnect()
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, deps)
  return state
}

/** Scrolls the active chip into view (instant: the shell remounts the
 *  header during navigation, so smooth scrolling never finishes). */
function useRevealActive(stripRef, sessionId, tabCount) {
  const React = P.React
  React.useLayoutEffect(() => {
    if (!tabCount) return undefined
    const reveal = () => {
      const el = stripRef.current
      if (!el) return
      const chip = el.querySelector('[data-itab-active="1"]')
      if (!chip) return
      const delta = scrollDeltaFor(el, chip, 6)
      if (delta) el.scrollLeft += delta
    }
    reveal()
    const timer = typeof setTimeout === 'function' ? setTimeout(reveal, 120) : null
    return () => { if (timer) clearTimeout(timer) }
  }, [sessionId, tabCount])
}

/** Wheel over the strip scrolls it horizontally when it overflows. */
function useWheelScroll(stripRef) {
  const React = P.React
  React.useEffect(() => {
    const el = stripRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      const before = el.scrollLeft
      el.scrollLeft += delta
      if (el.scrollLeft !== before) event.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
}

/** Measures the header room before the shell's right-hand controls and
 *  caps the strip's outer bar to it (fallback width stays in CSS). */
function useStripFill(barRef, deps) {
  const React = P.React
  const [room, setRoom] = React.useState(0)
  React.useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || typeof document === 'undefined') return undefined
    const timers = []
    let stopped = false
    const measure = () => {
      if (stopped) return
      const header = bar.closest ? bar.closest('header[data-window-drag]') : null
      if (!header) return
      const barRect = bar.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      if (!barRect.width || !headerRect.width) return
      // The header's grid item that contains us: its right edge is where
      // the leading region ends.
      let gridItem = bar
      while (gridItem && gridItem.parentElement && gridItem.parentElement !== header) gridItem = gridItem.parentElement
      const leadingRight = gridItem ? gridItem.getBoundingClientRect().right : barRect.right
      let limit = Infinity
      for (const node of Array.from(header.querySelectorAll('*'))) {
        if (!(node instanceof Element) || node === bar || bar.contains(node) || node.contains(bar)) continue
        const rect = node.getBoundingClientRect()
        if (rect.width < 8 || rect.height < 8) continue
        if (rect.bottom <= barRect.top + 2 || rect.top >= barRect.bottom - 2) continue
        const style = window.getComputedStyle(node)
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
        if (rect.left <= leadingRight + 8 && rect.right >= headerRect.right - 40) continue
        if (headerRect.right - rect.right > 120) continue
        if (rect.left <= barRect.left + 8) continue
        if (rect.left < limit) limit = rect.left
      }
      if (limit === Infinity) return
      const next = stripFillWidth(limit, barRect.left, headerRect.width, 0, 100)
      setRoom((prev) => (Math.abs(prev - next) < 2 ? prev : next))
    }
    measure()
    for (const delay of [80, 300, 900]) timers.push(setTimeout(measure, delay))
    window.addEventListener('resize', measure)
    return () => {
      stopped = true
      for (const timer of timers) clearTimeout(timer)
      window.removeEventListener('resize', measure)
    }
  }, deps)
  return room
}

/** Parks the shell's session chips ([class*="_headerActions"]) in line
 *  with the view-nav row once the crumbs title is hidden.
 *
 *  Cold start is the hard case: the header mounts first while the chips
 *  arrive frames later (sometimes with zero height), so an
 *  unusable measurement schedules retries instead of giving up, and a
 *  DOM mutation re-measures even when the header node is unchanged. */
const CHIPS_TOP_VAR = '--itab-chips-top'

function useChipsAfterNav(enabled) {
  const React = P.React
  const useIsoLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined' || !enabled) return undefined
    let header = null
    let nav = null
    let headerObserver = null
    let navObserver = null
    let chipsObserver = null
    let headerTreeObserver = null
    let bodyObserver = null
    let observedChips = null
    let timers = []
    let stopped = false
    let applied = null
    let retrying = false
    const RETRY_DELAYS = [40, 90, 180, 350, 650, 1000, 1500, 2200]
    let retryIndex = 0

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer)
      timers = []
    }

    const observeChips = (chips) => {
      if (chipsObserver) { chipsObserver.disconnect(); chipsObserver = null }
      observedChips = chips
      if (!chips || typeof ResizeObserver !== 'function') return
      chipsObserver = new ResizeObserver(() => requestMeasure())
      chipsObserver.observe(chips)
    }

    const watchHeaderTree = (node) => {
      if (headerTreeObserver) headerTreeObserver.disconnect()
      if (typeof MutationObserver !== 'function') return
      headerTreeObserver = new MutationObserver(() => {
        if (stopped || !node.isConnected) return
        if (node.querySelector('[class*="_headerActions"]') !== observedChips) requestMeasure()
      })
      headerTreeObserver.observe(node, { childList: true, subtree: true })
    }

    const bind = (next) => {
      if (headerObserver) headerObserver.disconnect()
      if (navObserver) navObserver.disconnect()
      header = next
      nav = next.querySelector('[class*="_tabs"]')
      watchHeaderTree(next)
      observeChips(next.querySelector('[class*="_headerActions"]'))
      if (typeof ResizeObserver !== 'function') return
      headerObserver = new ResizeObserver(() => requestMeasure())
      headerObserver.observe(next)
      if (nav) {
        navObserver = new ResizeObserver(() => requestMeasure())
        navObserver.observe(nav)
      }
    }

    const place = () => {
      if (stopped) return true
      const current = document.querySelector('header[data-window-drag]')
      if (!current) return false
      if (current !== header) bind(current)
      const chips = current.querySelector('[class*="_headerActions"]')
      if (!chips) { observeChips(null); return false }
      if (chips !== observedChips) observeChips(chips)
      if (!nav) { nav = current.querySelector('[class*="_tabs"]'); if (!nav) return false }
      const head = current.getBoundingClientRect()
      const chipsHeight = chips.getBoundingClientRect().height
      const row = nav.getBoundingClientRect()
      if (!head.height || !row.height || chipsHeight <= 0) return false
      const maxTop = Math.max(0, head.height - chipsHeight)
      const top = Math.max(0, Math.min(maxTop, Math.round(row.top + row.height / 2 - head.top - chipsHeight / 2)))
      if (top !== applied) {
        current.style.setProperty(CHIPS_TOP_VAR, top + 'px')
        applied = top
      }
      return true
    }

    let frame = 0
    const requestMeasure = () => {
      if (stopped) return
      if (typeof requestAnimationFrame !== 'function') { measure(); return }
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; measure() })
    }

    const measure = () => {
      if (stopped) return
      if (place()) { retryIndex = 0; return }
      scheduleRetry()
    }

    const scheduleRetry = () => {
      if (stopped || retrying) return
      if (retryIndex >= RETRY_DELAYS.length) return
      retrying = true
      const delay = RETRY_DELAYS[retryIndex++]
      timers.push(setTimeout(() => {
        retrying = false
        if (stopped) return
        if (!place()) scheduleRetry()
        else retryIndex = 0
      }, delay))
    }

    measure()
    if (typeof MutationObserver === 'function' && document.body) {
      bodyObserver = new MutationObserver(() => {
        if (stopped) return
        const current = document.querySelector('header[data-window-drag]')
        if (current && current !== header) requestMeasure()
      })
      bodyObserver.observe(document.body, { childList: true, subtree: false })
    }
    window.addEventListener('resize', requestMeasure)
    return () => {
      stopped = true
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      clearTimers()
      if (headerObserver) headerObserver.disconnect()
      if (navObserver) navObserver.disconnect()
      if (chipsObserver) chipsObserver.disconnect()
      if (headerTreeObserver) headerTreeObserver.disconnect()
      if (bodyObserver) bodyObserver.disconnect()
      window.removeEventListener('resize', requestMeasure)
      const current = document.querySelector('header[data-window-drag]')
      if (current) current.style.removeProperty(CHIPS_TOP_VAR)
    }
  }, [enabled])
}

/** HTML5 drag reordering for the flat chip row; the moved chip takes the
 *  target's place with a live preview (the order follows the pointer). */
function useTabReorder({ onReorder }) {
  const React = P.React
  const [dragId, setDragId] = React.useState(null)
  const [overId, setOverId] = React.useState(null)
  const lastOverRef = React.useRef(null)
  React.useEffect(() => {
    if (dragId === null) return undefined
    const accept = (event) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event) => { event.preventDefault() }
    document.addEventListener('dragover', accept)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', accept)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [dragId === null])
  const eventsFor = (id) => ({
    draggable: true,
    onDragStart: (event) => {
      lastOverRef.current = null
      setDragId(id)
      try {
        event.dataTransfer.setData('text/plain', id)
        event.dataTransfer.effectAllowed = 'move'
      } catch { /* IE-style dataTransfer; ignore */ }
    },
    onDragOver: (event) => {
      if (!dragId || dragId === id) return
      event.preventDefault()
      try { event.dataTransfer.dropEffect = 'move' } catch { /* ignore */ }
      if (lastOverRef.current === id) return
      lastOverRef.current = id
      setOverId(id)
      if (typeof onReorder === 'function') onReorder(dragId, id)
    },
    onDragLeave: () => {
      if (lastOverRef.current === id) lastOverRef.current = null
      setOverId((current) => (current === id ? null : current))
    },
    onDrop: (event) => {
      event.preventDefault()
      lastOverRef.current = null
      setDragId(null)
      setOverId(null)
    },
    onDragEnd: () => {
      lastOverRef.current = null
      setDragId(null)
      setOverId(null)
    },
  })
  return { draggingId: dragId, overId, eventsFor }
}
