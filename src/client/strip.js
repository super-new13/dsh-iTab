/* dsh-iTab — the tab strip and its menus.
 *
 * One chip per open session in the conversation header's leading seat.
 * Beyond the reference's switch/close/drag basics, this strip carries
 * the browser tab-menu operations the reference delegates to the
 * sidebar: close others / close right / close all / reopen, plus
 * middle-click close. Closing the last tab starts a new session (the
 * strip is never empty), which also keeps the reconcile loop from
 * resurrecting deliberately closed sessions. */

/* ------------------------- shared menu surface ------------------------- */

/** Overlay + floating panel. Fixed-positioned so the header's clipping
 *  and the strip's scroll cannot crop it. */
function MenuLayer({ onClose, children }) {
  return P.E('div', { className: 'itab-menu-layer' },
    P.E('div', { className: 'itab-menu-overlay', onClick: onClose }),
    children,
  )
}

/* --------------------------- tab context menu -------------------------- */

/** The browser-style chip menu: close / close others / close right /
 *  close all / reopen / new session. Items arrive pre-built (with
 *  disabled flags) so the keyboard cursor can skip them. */
function TabContextMenu(props) {
  const { ctx, items, t, onClose } = props
  const React = P.React
  const E = P.E
  const panelRef = React.useRef(null)
  const enabled = items.filter((item) => item.key !== 'sep' && !item.disabled)
  const [cursor, setCursor] = React.useState(0)
  const [pos, setPos] = React.useState(() => ({
    x: Math.max(8, ctx.x - 190 / 2),
    y: ctx.y,
  }))
  // Clamp after mount: the panel's real size is known only once it has
  // rendered, so first paint estimates, then this pins it on-screen.
  React.useLayoutEffect(() => {
    const el = panelRef.current
    if (!el || typeof window === 'undefined') return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth || rect.right
    const vh = window.innerHeight || rect.bottom
    setPos({
      x: Math.max(8, Math.min(ctx.x, vw - rect.width - 8)),
      y: Math.max(8, Math.min(ctx.y, vh - rect.height - 8)),
    })
  }, [])
  React.useEffect(() => {
    const node = panelRef.current
    if (node && typeof node.focus === 'function') node.focus()
  }, [])
  const onKeyDown = (event) => {
    const key = event && event.key
    if (key === 'Escape') { event.preventDefault(); onClose(); return }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!enabled.length) return
      event.preventDefault()
      setCursor((current) => {
        const at = Math.min(Math.max(current, 0), enabled.length - 1)
        return (at + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
      })
      return
    }
    if (key === 'Home' || key === 'End') {
      if (!enabled.length) return
      event.preventDefault()
      setCursor(key === 'Home' ? 0 : enabled.length - 1)
      return
    }
    if (key === 'Enter' || key === ' ') {
      const item = enabled[Math.min(Math.max(cursor, 0), enabled.length - 1)]
      if (!item || item.disabled) return
      event.preventDefault()
      item.action()
      onClose()
    }
  }
  let enabledSeen = -1
  return E(MenuLayer, { onClose },
    E('div', {
      ref: panelRef,
      className: 'itab-menu',
      role: 'menu',
      'aria-label': t('tabs.label'),
      tabIndex: -1,
      style: { left: Math.round(pos.x) + 'px', top: Math.round(pos.y) + 'px' },
      onKeyDown,
    },
      items.map((item, index) => {
        if (item.key === 'sep') return E('div', { key: 'sep' + index, className: 'itab-menu-sep' })
        const isCursor = !item.disabled && ++enabledSeen === Math.min(Math.max(cursor, 0), enabled.length - 1)
        return E('button', {
          key: item.key,
          type: 'button',
          className: cls('itab-menu-item', isCursor && 'itab-menu-item-cursor'),
          role: 'menuitem',
          disabled: item.disabled || undefined,
          'aria-disabled': item.disabled ? 'true' : undefined,
          onMouseEnter: () => { if (!item.disabled) setCursor(enabled.indexOf(item)) },
          onClick: () => { if (!item.disabled) { item.action(); onClose() } },
        }, item.label)
      }),
    ),
  )
}

/* ---------------------------- overflow menu ---------------------------- */

/** The "all tabs" panel behind the chevron: every open tab, visible or
 *  scrolled away, with a check on the on-screen one and per-row close.
 *  Right-clicking a row opens the same context menu the chips use. */
function TabsOverflowMenu(props) {
  const { tabs, activeId, titleOf, stateOf, statusDots, t, anchor, onSelect, onClose, onCloseTab, onContextMenu } = props
  const React = P.React
  const E = P.E
  const menuRef = React.useRef(null)
  const [cursor, setCursor] = React.useState(() => {
    const at = activeId === null ? -1 : tabs.indexOf(activeId)
    return at < 0 ? 0 : at
  })
  React.useEffect(() => {
    const node = menuRef.current
    if (node && typeof node.focus === 'function') node.focus()
  }, [])
  const viewportWidth = typeof window === 'undefined' ? 0 : (window.innerWidth || 0)
  const viewportHeight = typeof window === 'undefined' ? 0 : (window.innerHeight || 0)
  const style = anchor
    ? {
      top: Math.round(anchor.bottom + 6) + 'px',
      right: Math.max(8, Math.round(viewportWidth - anchor.right)) + 'px',
      maxHeight: Math.max(160, viewportHeight - Math.round(anchor.bottom) - 14) + 'px',
    }
    : undefined
  const activeIndex = tabs.length === 0 ? -1 : Math.min(Math.max(cursor, 0), tabs.length - 1)
  const onKeyDown = (event) => {
    const key = event && event.key
    if (key === 'Escape') { event.preventDefault(); onClose(); return }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!tabs.length) return
      event.preventDefault()
      setCursor((current) => ((Math.min(Math.max(current, 0), tabs.length - 1)) + (key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length)
      return
    }
    if (key === 'Home' || key === 'End') {
      if (!tabs.length) return
      event.preventDefault()
      setCursor(key === 'Home' ? 0 : tabs.length - 1)
      return
    }
    if (key === 'Enter' || key === ' ') {
      const id = tabs[activeIndex]
      if (!id) return
      event.preventDefault()
      onSelect(id)
    }
  }
  return E(MenuLayer, { onClose },
    E('div', {
      ref: menuRef,
      className: 'itab-menu',
      role: 'menu',
      'aria-label': t('tabs.menu'),
      tabIndex: -1,
      style,
      onKeyDown,
    },
      E('div', { className: 'itab-menu-head' }, t('tabs.menuCount', { n: tabs.length })),
      E('div', { className: 'itab-menu-list' },
        tabs.map((id, index) => {
          const active = id === activeId
          const state = stateOf(id)
          return E('div', {
            key: id,
            className: cls('itab-menu-row', active && 'itab-menu-row-active', index === activeIndex && 'itab-menu-row-cursor'),
            role: 'menuitem',
            'aria-current': active ? 'true' : 'false',
            'data-itab-tab-id': id,
            onMouseEnter: () => setCursor(index),
            onClick: () => onSelect(id),
            onContextMenu: (event) => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
              if (typeof onContextMenu === 'function') onContextMenu(id, event)
            },
          },
            statusDots
              ? (state ? E(StatusDot, { state, label: t('tabs.' + state) }) : E('span', { className: 'itab-menu-dot', 'aria-hidden': 'true' }))
              : null,
            E('span', { className: 'itab-menu-label' }, titleOf(id)),
            active ? E(CheckIcon, { size: 13, className: 'itab-menu-check' }) : null,
            E('button', {
              type: 'button',
              className: 'itab-menu-close',
              'aria-label': t('tabs.close'),
              title: t('tabs.close'),
              onClick: (event) => {
                event.stopPropagation()
                onCloseTab(event, id)
              },
            }, '×'),
          )
        }),
      ),
      E('div', { className: 'itab-menu-hint' }, t('tabs.menuHint')),
    ),
  )
}

/* ---------------------------- history panel ----------------------------- */

/** Browser-history surface for closed tabs: persistent entries {id, at},
 *  newest first. Rows restore the tab on click; entries stay (history
 *  records closes, not opens). Deleted sessions render disabled. */
function HistoryPanel(props) {
  const { entries, titleOf, stateOf, statusDots, t, anchor, onSelect, onClose, onClear } = props
  const React = P.React
  const E = P.E
  const menuRef = React.useRef(null)
  const [cursor, setCursor] = React.useState(0)
  React.useEffect(() => {
    const node = menuRef.current
    if (node && typeof node.focus === 'function') node.focus()
  }, [])
  const now = Date.now()
  const viewportWidth = typeof window === 'undefined' ? 0 : (window.innerWidth || 0)
  const viewportHeight = typeof window === 'undefined' ? 0 : (window.innerHeight || 0)
  const style = anchor
    ? {
      top: Math.round(anchor.bottom + 6) + 'px',
      right: Math.max(8, Math.round(viewportWidth - anchor.right)) + 'px',
      maxHeight: Math.max(160, viewportHeight - Math.round(anchor.bottom) - 14) + 'px',
    }
    : undefined
  const activeIndex = entries.length === 0 ? -1 : Math.min(Math.max(cursor, 0), entries.length - 1)
  const onKeyDown = (event) => {
    const key = event && event.key
    if (key === 'Escape') { event.preventDefault(); onClose(); return }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!entries.length) return
      event.preventDefault()
      setCursor((current) => (Math.min(Math.max(current, 0), entries.length - 1) + (key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length)
      return
    }
    if (key === 'Home' || key === 'End') {
      if (!entries.length) return
      event.preventDefault()
      setCursor(key === 'Home' ? 0 : entries.length - 1)
      return
    }
    if (key === 'Enter' || key === ' ') {
      const entry = entries[activeIndex]
      if (!entry || entry.deleted) return
      event.preventDefault()
      onSelect(entry.id)
    }
  }
  return E(MenuLayer, { onClose },
    E('div', {
      ref: menuRef,
      className: 'itab-menu',
      role: 'menu',
      'aria-label': t('history.title'),
      tabIndex: -1,
      style,
      onKeyDown,
    },
      E('div', { className: 'itab-menu-head' }, t('history.count', { n: entries.length })),
      entries.length === 0
        ? E('div', { className: 'itab-menu-empty' }, t('history.empty'))
        : E('div', { className: 'itab-menu-list' },
          entries.map((entry, index) => {
            const state = entry.deleted ? null : stateOf(entry.id)
            return E('div', {
              key: entry.id,
              className: cls('itab-menu-row', index === activeIndex && 'itab-menu-row-cursor', entry.deleted && 'itab-menu-row-disabled'),
              role: 'menuitem',
              'aria-disabled': entry.deleted ? 'true' : undefined,
              'data-itab-history-id': entry.id,
              onMouseEnter: () => setCursor(index),
              onClick: () => { if (!entry.deleted) onSelect(entry.id) },
            },
              statusDots
                ? (state ? E(StatusDot, { state, label: t('tabs.' + state) }) : E('span', { className: 'itab-menu-dot', 'aria-hidden': 'true' }))
                : null,
              E('span', { className: 'itab-menu-label' }, entry.deleted ? t('history.deleted') : titleOf(entry.id)),
              E('span', { className: 'itab-menu-time' }, relativeTime(entry.at, now, t)),
            )
          }),
        ),
      E('div', { className: 'itab-menu-hint' },
        E('span', null, t('history.hint')),
        entries.length > 0
          ? E('button', {
            type: 'button',
            className: 'itab-menu-clear',
            onClick: (event) => { event.stopPropagation(); onClear() },
          }, t('history.clear'))
          : null,
      ),
    ),
  )
}

/* ------------------------------ the strip ------------------------------ */

/** Props the leading seat hands down (shell store hooks via the seat's
 *  declared store/locale, plus the entry's injected callbacks). */
function TabsStrip(props) {
  const { useSessions, useSessionStatus, useWorkspaces, useStore, t, open, newSession, fork } = props
  const React = P.React
  const E = P.E

  const prefs = typeof useStore === 'function' ? (useStore((s) => s.prefs) || {}) : {}
  const enabled = prefs.enabled !== false
  const statusDots = prefs.statusDots !== false
  const statusPulse = prefs.statusPulse === true
  const middleClickClose = prefs.middleClickClose !== false
  const cap = capFromPrefs(prefs)
  const maxWidth = maxWidthFromPrefs(prefs)

  useTabsSurface(enabled)
  useChipsAfterNav(enabled)

  const stored = useTabs()
  const [closedStack, setClosedStack] = React.useState([])
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const historyAnchorRef = React.useRef(null)
  const [historyEntries, setHistoryEntries] = React.useState(historySnapshot)
  React.useEffect(() => subscribeHistory(setHistoryEntries), [])
  const { draggingId, eventsFor } = useTabReorder({
    onReorder: (fromId, toId) => { saveTabs(moveTab(tabsSnapshot(), fromId, toId)) },
  })

  const sessions = typeof useSessions === 'function' ? useSessions((s) => s) : null
  useTabSync(sessions, useWorkspaces, prefs, open)
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((s) => s) : null
  // The workspace listing feeds the chip bubbles' project segment: the entry
  // owning a session names the project (last title segment) and supplies the
  // directory the git-branch lookup keys on.
  const workspaceItems = typeof useWorkspaces === 'function' ? useWorkspaces((s) => s.items) : null

  const bound = props.sessionId === undefined || props.sessionId === null ? null : String(props.sessionId)
  const liveCurrent = currentSessionIdOf(sessions)
  const sessionId = liveCurrent || tabsActive() || bound || null
  // The persisted list IS the strip: an empty store renders an empty strip
  // (close-all / close-last are deliberate). First-ever load seeds through
  // useTabSync's reconcile (previous=undefined ≠ current), never here.
  const tabs = stored

  const barRef = React.useRef(null)
  const stripRef = React.useRef(null)
  const moreRef = React.useRef(null)
  const anchorRef = React.useRef(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [ctx, setCtx] = React.useState(null) // { x, y, id }
  const overflow = useStripOverflow(stripRef, [tabs.length, sessionId, enabled])
  const fit = useStripFit(stripRef, tabs.length)
  const roomWidth = useStripFill(barRef, [tabs.length, sessionId, enabled])
  useRevealActive(stripRef, sessionId, tabs.length)
  useWheelScroll(stripRef)
  // Hover bubble state: the second line carries the hovered project's git
  // branch, so the hovered chip is state — the strip must re-render when the
  // branch answer lands (the cache is module state, not a React store). The
  // anchor chip is tracked in chipTipState below, which the delayed show()
  // reads; the ref-shaped closure belongs to a render that predates the hover.
  const [hovered, setHovered] = React.useState({ id: '', cwd: '' })
  const hoverBranch = useGitBranch(hovered.cwd)
  React.useEffect(() => {
    if (menuOpen && !overflow.overflowing) setMenuOpen(false)
  }, [menuOpen, overflow.overflowing])
  React.useEffect(() => {
    if (!menuOpen || typeof window === 'undefined') return undefined
    const close = () => setMenuOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [menuOpen])

  if (sessions === null && typeof useSessions !== 'function') return null
  if (!enabled) return null
  if (tabs.length === 0 && typeof newSession !== 'function') return null

  const titleOf = (id) => {
    const summary = sessions && sessions.byId ? sessions.byId[id] : undefined
    return sessionTitleOf(summary, t) || id
  }
  /* ---- chip bubble meta (project · git branch · absolute time) ---- */

  // The project a chip belongs to: its workspace's last title segment (the tag
  // the sidebar rows show) and the directory the branch lookup keys on. A
  // session summary may carry its own cwd; the workspace listing supplies the
  // path otherwise, exactly like the reference's session rows.
  const chipProjectOf = (id) => {
    const summary = sessions && sessions.byId ? sessions.byId[id] : undefined
    const entries = Array.isArray(workspaceItems) ? workspaceItems : []
    let workspace = null
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.sessionIds)) continue
      if (entry.sessionIds.some((sid) => String(sid) === String(id))) { workspace = entry; break }
    }
    const name = workspace ? (String(workspace.title || '').split('/').pop() || workspace.leaf || '') : ''
    const cwd = String((summary && summary.cwd) || (workspace && workspace.path) || '').trim()
    return { name, cwd }
  }
  // Join the non-empty segments so a missing branch (not a repo / route off)
  // never leaves a bare " · " separator.
  const joinMeta = (...parts) => parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean).join(' · ')
  const chipMetaOf = (id, branch) => {
    const summary = sessions && sessions.byId ? sessions.byId[id] : undefined
    const updatedAt = Number(summary && summary.updatedAt) > 0 ? new Date(Number(summary.updatedAt)).toLocaleString() : ''
    return joinMeta(chipProjectOf(id).name, branch, updatedAt)
  }
  const chipTipState = React.useRef({ id: '', cwd: '' })
  const chipTip = useHoverTip({
    label: () => {
      const id = hovered.id
      if (!id) return ''
      const title = titleOf(id)
      const meta = chipMetaOf(id, hoverBranch)
      return meta ? title + '\n' + meta : title
    },
    delayMs: 300,
    gap: 6,
    maxWidth: 380,
    prefer: 'below',
    // The resolver runs only while the bubble is visible and reads the branch
    // from the cache, so it stays side-effect free; the refresh rides the
    // opening instead.
    onShow: () => { if (chipTipState.current.cwd) branchCache.ensure([chipTipState.current.cwd]) },
  })
  // Shell parity (sidebar sessionNode): a status entry exists for EVERY
  // listed session, but its `running` stays undefined until the host
  // observes that session — an entry with undefined must fall through to
  // the list row's own flag, exactly like the sidebar's
  // `status?.running ?? s.running`. Treating the entry as authoritative
  // turned never-observed rows (fresh load, cross-host listings) into
  // "not running" and their dots never showed.
  const runningOf = (id) => {
    const entry = statuses && typeof statuses.get === 'function' ? statuses.get(id) : undefined
    if (entry && entry.running !== undefined) return entry.running === true
    const row = sessions && sessions.byId ? sessions.byId[id] : undefined
    return !!(row && row.running)
  }
  // A parent session whose SUBAGENTS are still running shows ongoing in
  // the sidebar (running-subagent count over the session catalog); the
  // chips owe the same answer. Catalog shape mirrors the shell:
  // sessions.projectionsBySession[parent].values.subagentCatalog.
  const runningSubagentsOf = (id) => {
    const projections = sessions && sessions.projectionsBySession ? sessions.projectionsBySession : null
    const catalog = projections && projections[id] && projections[id].values
      ? projections[id].values.subagentCatalog : null
    if (!Array.isArray(catalog)) return 0
    let count = 0
    for (const child of catalog) {
      if (!child || child.id === undefined || child.id === null) continue
      if (runningOf(String(child.id))) count += 1
    }
    return count
  }
  const stateOf = (id) => {
    const status = statuses && typeof statuses.get === 'function' ? statuses.get(id) : undefined
    const summary = sessions && sessions.byId ? sessions.byId[id] : undefined
    return sessionStateOf({
      running: runningOf(id),
      completed: status ? status.completionUnread === true : !!(summary && summary.completed),
      pending: status && status.pendingInteraction ? status.pendingInteraction.kind : undefined,
      subagents: runningSubagentsOf(id),
    }, sessionId === id)
  }

  const switchTo = (id) => {
    setActiveTab(id)
    if (typeof open === 'function' && id !== sessionId) open(id)
  }

  /* ---- close operations (all Chrome-shaped; the strip never empties) ---- */

  const rememberClosed = (ids) => {
    if (ids && ids.length) {
      setClosedStack((stack) => pushClosed(stack, ids))
      saveHistory(pushHistory(historySnapshot(), ids, { now: Date.now() }))
    }
  }

  const closeOne = (event, id) => {
    if (event) { event.stopPropagation(); event.preventDefault() }
    const result = closeTab(tabs, id, sessionId)
    if (!result.closed) return
    rememberClosed([id])
    saveTabs(result.tabs)
    // Closing the last tab leaves the empty strip (session stays on screen;
    // the "+" button remains the way forward). No auto-new-session.
    if (result.next) switchTo(result.next)
  }
  const closeOthersFrom = (id) => {
    const result = closeOthers(tabs, id)
    if (!result.closedIds.length) return
    rememberClosed(result.closedIds)
    saveTabs(result.tabs)
    if (sessionId !== id) switchTo(id)
  }
  const closeRightFrom = (id) => {
    const result = closeRight(tabs, id)
    if (!result.closedIds.length) return
    rememberClosed(result.closedIds)
    saveTabs(result.tabs)
    if (result.closedIds.indexOf(sessionId) >= 0) switchTo(id)
  }
  const closeAllTabs = () => {
    if (!tabs.length) return
    rememberClosed(tabs)
    saveTabs([])
    // Deliberately empty: no fresh session is started, and reconcileTabs'
    // no-navigation rule keeps the closed tabs (including the current
    // session's) from resurrecting on the next store update.
  }
  const reopenClosed = () => {
    const result = reopenTab(closedStack, tabs)
    if (!result || !result.id) return
    setClosedStack(result.stack)
    saveTabs(openTab(tabs, result.id, cap))
    switchTo(result.id)
  }
  const hasReopenable = closedStack.some((id) => tabs.indexOf(id) < 0)

  /* ---- chip helpers ---- */

  const chipOf = (id) => {
    const strip = stripRef.current
    if (!strip) return null
    for (const node of Array.from(strip.children)) {
      if (node && typeof node.getAttribute === 'function' && node.getAttribute('data-itab-tab-id') === id) return node
    }
    return null
  }
  // ←/→ move the selection and take focus along; the shell remounts the
  // header while navigating, so refocus now and again once it lands.
  const moveSelection = (id, key) => {
    const at = tabs.indexOf(id)
    const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    if (!step || at < 0) return false
    const next = tabs[at + step]
    if (!next) return false
    switchTo(next)
    const focusNext = () => {
      const node = chipOf(next)
      if (node && typeof node.focus === 'function') node.focus()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusNext)
    else if (typeof setTimeout === 'function') setTimeout(focusNext, 0)
    if (typeof setTimeout === 'function') setTimeout(focusNext, 80)
    return true
  }
  const openMenu = () => {
    const node = moreRef.current
    anchorRef.current = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
    setMenuOpen((current) => !current)
  }
  const openContextMenu = (id, event) => {
    setCtx({ x: event.clientX || 0, y: event.clientY || 0, id })
  }

  const ctxItems = ctx
    ? [
      { key: 'close', label: t('tabs.close'), disabled: false, action: () => { closeOne(null, ctx.id) } },
      { key: 'closeOthers', label: t('tabs.closeOthers'), disabled: tabs.length <= 1, action: () => closeOthersFrom(ctx.id) },
      { key: 'closeRight', label: t('tabs.closeRight'), disabled: tabs.indexOf(ctx.id) === tabs.length - 1, action: () => closeRightFrom(ctx.id) },
      { key: 'closeAll', label: t('tabs.closeAll'), disabled: tabs.length === 0, action: closeAllTabs },
      { key: 'sep' },
      { key: 'reopen', label: t('tabs.reopen'), disabled: !hasReopenable, action: reopenClosed },
      { key: 'history', label: t('tabs.history'), disabled: false, action: () => { setHistoryOpen(true) } },
      { key: 'sep' },
      { key: 'reveal', label: t('tabs.reveal'), disabled: !chipProjectOf(ctx.id).cwd, action: () => { revealProjectFolder(chipProjectOf(ctx.id).cwd) } },
      { key: 'vscode', label: t('tabs.vscode'), disabled: !chipProjectOf(ctx.id).cwd, action: () => { openProjectInVscode(chipProjectOf(ctx.id).cwd) } },
      { key: 'fork', label: t('tabs.fork'), disabled: typeof fork !== 'function', action: () => { if (typeof fork === 'function') fork(ctx.id) } },
      { key: 'new', label: t('tabs.new'), disabled: typeof newSession !== 'function', action: () => { if (typeof newSession === 'function') newSession() } },
    ]
    : null

  return E('div', {
    ref: barRef,
    className: 'itab-tabbar',
    'data-itab-overflow': overflow.overflowing ? '1' : '0',
    style: Object.assign(
      { '--itab-tab-max': maxWidth + 'px' },
      roomWidth > 0 ? { maxWidth: roomWidth + 'px' } : null,
    ),
  },
    StyleNode(),
    E('div', {
      ref: stripRef,
      className: 'itab-strip',
      role: 'tablist',
      'aria-label': t('tabs.label'),
      'data-itab-tabs': String(tabs.length),
      'data-itab-fade-left': overflow.canLeft ? '1' : '0',
      'data-itab-fade-right': overflow.canRight ? '1' : '0',
      // Chips share the row at 1/n; when that would drop them under their
      // minimum, the strip snaps to whole chips and the rest scrolls.
      style: Object.assign(
        { '--itab-count': String(Math.max(1, tabs.length)) },
        fit.width > 0 ? { maxWidth: fit.width + 'px', '--itab-chip-w': fit.chipWidth + 'px' } : null,
      ),
    },
      tabs.map((id) => {
        const active = sessionId === id
        const state = stateOf(id)
        return E('div', Object.assign({
          key: id,
          className: cls('itab-tab', active && 'itab-tab-active', draggingId === id && 'itab-tab-dragging'),
          'data-itab-active': active ? '1' : '0',
          'data-itab-tab-id': id,
          role: 'tab',
          tabIndex: active ? 0 : -1,
          'aria-selected': active,
          'aria-label': titleOf(id),
          style: active ? { boxShadow: 'inset 0 -2px 0 var(--dsw-alias-brand-primary, #5b8def)' } : undefined,
          onMouseDown: (event) => { if (middleClickClose && event.button === 1) event.preventDefault() },
          onAuxClick: (event) => { if (middleClickClose && event.button === 1) closeOne(event, id) },
          onClick: () => switchTo(id),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); switchTo(id); return }
            moveSelection(id, event.key)
          },
          onContextMenu: (event) => {
            event.preventDefault()
            event.stopPropagation()
            openContextMenu(id, event)
          },
          // The plugin bubble replaces the native tooltip (a native title would
          // double up); one bubble for the whole strip, the hovered chip is its
          // anchor via the shared ref the delayed show() reads.
          onMouseEnter: (event) => {
            chipTip.attach.ref.current = event.currentTarget
            const project = chipProjectOf(id)
            chipTipState.current = { id, cwd: project.cwd }
            setHovered((previous) => (previous.id === id && previous.cwd === project.cwd
              ? previous
              : { id, cwd: project.cwd }))
            chipTip.attach.onMouseEnter(event)
          },
          onMouseLeave: chipTip.attach.onMouseLeave,
        }, eventsFor(id)),
          statusDots
            ? (state
              ? E(StatusDot, { state, label: t('tabs.' + state), pulse: statusPulse })
              : E('span', { className: 'itab-tab-dot', 'aria-hidden': 'true' }))
            : null,
          E('span', {
            className: 'itab-tab-label',
            style: active ? { color: 'var(--dsw-alias-brand-primary, #5b8def)', fontWeight: 600 } : undefined,
          }, titleOf(id)),
          E('button', {
            type: 'button',
            className: 'itab-tab-close',
            draggable: false,
            'aria-label': t('tabs.close'),
            title: t('tabs.close'),
            onClick: (event) => closeOne(event, id),
          }, '×'),
        )
      }),
    ),
    typeof newSession === 'function'
      ? E('button', {
        type: 'button',
        className: 'itab-new',
        'aria-label': t('session.new'),
        title: t('session.new'),
        onClick: (event) => { event.stopPropagation(); newSession() },
      }, E(PlusIcon, { size: 14 }))
      : null,
    E('button', {
      ref: historyAnchorRef,
      type: 'button',
      className: cls('itab-history', historyOpen && 'itab-history-open'),
      'aria-haspopup': 'menu',
      'aria-expanded': historyOpen,
      'aria-label': t('history.title'),
      title: t('history.title'),
      onClick: (event) => {
        event.stopPropagation()
        setCtx(null)
        setHistoryOpen((current) => !current)
      },
    }, E(ClockIcon, { size: 13 })),
    overflow.overflowing
      ? E('button', {
        ref: moreRef,
        type: 'button',
        className: cls('itab-more', menuOpen && 'itab-more-open'),
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen,
        'aria-label': t('tabs.menu'),
        title: t('tabs.menuCount', { n: tabs.length }),
        onClick: openMenu,
      }, E(ChevronDownIcon, { size: 13 }))
      : null,
    menuOpen
      ? E(TabsOverflowMenu, {
        tabs,
        activeId: sessionId,
        titleOf,
        stateOf,
        statusDots,
        t,
        anchor: anchorRef.current,
        onSelect: (id) => { setMenuOpen(false); switchTo(id) },
        onClose: () => setMenuOpen(false),
        onCloseTab: (event, id) => closeOne(event, id),
        onContextMenu: (id, event) => openContextMenu(id, event),
      })
      : null,
    historyOpen
      ? E(HistoryPanel, {
        entries: historyEntries.map((entry) => Object.assign({}, entry, {
          deleted: !(sessions && sessions.byId && sessions.byId[entry.id]),
        })),
        titleOf,
        stateOf,
        statusDots,
        t,
        anchor: (historyAnchorRef.current && typeof historyAnchorRef.current.getBoundingClientRect === 'function')
          ? historyAnchorRef.current.getBoundingClientRect()
          : null,
        onSelect: (id) => {
          setHistoryOpen(false)
          saveTabs(openTab(tabsSnapshot(), id, cap))
          switchTo(id)
        },
        onClose: () => setHistoryOpen(false),
        onClear: () => { saveHistory([]) },
      })
      : null,
    ctxItems ? E(TabContextMenu, {
      ctx,
      items: ctxItems,
      t,
      onClose: () => setCtx(null),
    }) : null,
    // Shared bubble, rendered last so it floats above the row.
    chipTip.bubble,
  )
}
