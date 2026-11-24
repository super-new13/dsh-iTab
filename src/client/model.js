// dsh-itab — pure tab model (no DOM, no React; testable under node).
// Adapted from dsh-workspace-plus (MIT © 2026 lsdt45 / KannaKuron) with
// browser-style bulk-close extensions.

export const DEFAULT_MAX_TABS = 20
export const DEFAULT_CLOSED_STACK = 20
export const DEFAULT_HISTORY_CAP = 50
export const STORAGE_KEY = 'dsh.itab.tabs.v1'
export const HISTORY_KEY = 'dsh.itab.history.v1'

export const tabIdOf = (value) => String(value ?? '')

export function normalizeTabs(value, cap = DEFAULT_MAX_TABS) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const id = tabIdOf(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= cap) break
  }
  return out
}

export function openTab(tabs, sessionId, cap = DEFAULT_MAX_TABS) {
  const id = tabIdOf(sessionId)
  if (!id) return normalizeTabs(tabs, cap)
  const kept = normalizeTabs(tabs, Number.MAX_SAFE_INTEGER)
  const at = kept.indexOf(id)
  if (at >= 0) return kept.slice(0, cap)
  kept.push(id)
  return kept.length > cap ? kept.slice(kept.length - cap) : kept
}

export function replaceTab(tabs, previousId, nextId, cap = DEFAULT_MAX_TABS) {
  const prev = tabIdOf(previousId)
  const next = tabIdOf(nextId)
  const kept = normalizeTabs(tabs, Number.MAX_SAFE_INTEGER)
  if (!next) return kept.slice(0, cap)
  const existing = kept.indexOf(next)
  const at = kept.indexOf(prev)
  if (existing >= 0 && at < 0) return kept.slice(0, cap)
  if (existing >= 0 && at >= 0) {
    kept.splice(at, 1)
    return kept.slice(0, cap)
  }
  if (at >= 0) {
    kept[at] = next
    return kept.slice(0, cap)
  }
  kept.push(next)
  return kept.length > cap ? kept.slice(kept.length - cap) : kept
}

export function moveTab(tabs, fromId, toId) {
  const from = tabIdOf(fromId)
  const to = tabIdOf(toId)
  const kept = [...tabs]
  const fromAt = kept.indexOf(from)
  const toAt = kept.indexOf(to)
  if (fromAt < 0 || toAt < 0 || fromAt === toAt) return kept
  const [moved] = kept.splice(fromAt, 1)
  // insert at the target's ORIGINAL slot: the dragged tab lands before it
  kept.splice(fromAt < toAt ? toAt - 1 : toAt, 0, moved)
  return kept
}

// Close a single tab. Returns the next tab to activate when the closed one was
// active: its right neighbour, else the left neighbour (browser behaviour).
export function closeTab(tabs, sessionId) {
  const id = tabIdOf(sessionId)
  const kept = [...tabs]
  const at = kept.indexOf(id)
  if (at < 0) return { closed: false, tabs: kept, next: null }
  kept.splice(at, 1)
  const next = kept.length ? kept[Math.min(at, kept.length - 1)] : null
  return { closed: true, tabs: kept, next }
}

// Close every tab except the anchor (Chrome: the right-clicked tab survives
// and becomes active).
export function closeOthers(tabs, anchorId) {
  const anchor = tabIdOf(anchorId)
  const kept = [...tabs]
  if (!kept.includes(anchor)) return { tabs: kept, closedIds: [] }
  const closedIds = kept.filter((id) => id !== anchor)
  return { tabs: anchor ? [anchor] : [], closedIds }
}

// Close all tabs to the right of the anchor.
export function closeRight(tabs, anchorId) {
  const anchor = tabIdOf(anchorId)
  const kept = [...tabs]
  const at = kept.indexOf(anchor)
  if (at < 0) return { tabs: kept, closedIds: [] }
  const closedIds = kept.slice(at + 1)
  return { tabs: kept.slice(0, at + 1), closedIds }
}

export function closeAll() {
  return { tabs: [], closedIds: null }
}

// Reopen stack: most-recently-closed first. Push ids so popping yields the
// rightmost/last-closed tab first (Chrome Ctrl+Shift+T order).
export function pushClosed(stack, ids, cap = DEFAULT_CLOSED_STACK) {
  if (!Array.isArray(ids)) return [...stack]
  const additions = ids.filter(Boolean).reverse()
  const seen = new Set()
  const out = []
  for (const id of [...additions, ...stack]) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= cap) break
  }
  return out
}

// Pop the first closable id that is not already open; returns
// {stack, id} with id null when nothing is reopenable.
export function reopenTab(stack, tabs) {
  const open = new Set(tabs)
  const rest = [...stack]
  while (rest.length) {
    const id = rest.shift()
    if (open.has(id)) continue
    return { stack: rest, id }
  }
  return { stack: rest, id: null }
}

// Strip chip click: default switch-in-place; Shift inverts the configured
// "open in new tab" preference (XOR). Preference defaults to false (browser
// default: a plain click switches the tab in place).
export function tabsForClick(tabs, activeId, clickedId, options = {}) {
  const clicked = tabIdOf(clickedId)
  const active = tabIdOf(activeId)
  const newTabOnClick = options.newTabOnClick === true
  const shift = options.shift === true
  const opensTab = newTabOnClick !== shift
  const cap = options.cap ?? DEFAULT_MAX_TABS
  if (!opensTab) return { tabs: normalizeTabs(tabs, cap), opened: false }
  const seeded = tabs.length ? tabs : active ? [active] : []
  return { tabs: openTab(seeded, clicked, cap), opened: true }
}

export function reconcileTabs(tabs, currentId, previousId, options = {}) {
  const cap = options.cap ?? DEFAULT_MAX_TABS
  const current = tabIdOf(currentId)
  const previous = tabIdOf(previousId)
  const isBlank = options.isBlank ?? (() => false)
  const isArchived = options.isArchived ?? (() => false)
  // Only passed by the caller once the session list is authoritative
  // (a deleted session is gone from the list); absent → nothing is pruned.
  const isDeleted = options.isDeleted ?? (() => false)
  const sidebarOpen = options.sidebarOpen ?? 'open'
  let kept = normalizeTabs(tabs, Number.MAX_SAFE_INTEGER).filter((id) => !isArchived(id) && !isDeleted(id))
  if (!current) return kept.slice(0, cap)
  if (kept.includes(current)) return kept.slice(0, cap)
  // No navigation happened (same session stays on screen): its tab was closed
  // deliberately — never resurrect it, even for a blank session. The strip may
  // legitimately go empty; the "+" button stays reachable.
  if (current === previous) return kept.slice(0, cap)
  const keepBlank = isBlank(current) || (previous && isBlank(previous))
  if (keepBlank || sidebarOpen === 'open') return openTab(kept, current, cap)
  if (previous && kept.includes(previous)) return replaceTab(kept, previous, current, cap)
  // The previously-active tab is gone from the strip (closed while another
  // navigation landed on this session): give the on-screen session a tab.
  return openTab(kept, current, cap)
}

// ── persisted store ─────────────────────────────────────────────────────────

const listeners = new Set()

function readState() {
  try {
    if (typeof localStorage === 'undefined') return { tabs: [], active: '' }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tabs: [], active: '' }
    const parsed = JSON.parse(raw)
    return {
      tabs: normalizeTabs(parsed?.tabs),
      active: tabIdOf(parsed?.active),
    }
  } catch {
    return { tabs: [], active: '' }
  }
}

function writeState(next) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    /* storage full or unavailable — keep going with in-memory state */
  }
  for (const listener of listeners) {
    try {
      listener(next.tabs, next.active)
    } catch {
      /* one bad subscriber must not break the rest */
    }
  }
  return next
}

export function tabsSnapshot() {
  return readState().tabs
}

export function tabsActive() {
  return readState().active
}

export function saveTabs(tabs, active) {
  const state = readState()
  const nextActive = arguments.length > 1 ? tabIdOf(active) : state.active
  return writeState({ tabs: normalizeTabs(tabs), active: nextActive })
}

export function setActiveTab(id) {
  const state = readState()
  return writeState({ tabs: state.tabs, active: tabIdOf(id) })
}

export function subscribeTabs(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ── closed-tab history (persistent, browser-history-like) ───────────────────
// Entries {id, at} with the most-recently-closed first. The same session
// closing again moves to the top with a fresh timestamp (Chrome's "recently
// closed" ordering). Reopen keeps entries — history records closes, not opens.

const historyListeners = new Set()

export function normalizeHistory(value, cap = DEFAULT_HISTORY_CAP) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = tabIdOf(raw.id)
    const at = Number(raw.at)
    if (!id || !Number.isFinite(at) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, at })
    if (out.length >= cap) break
  }
  return out
}

export function pushHistory(list, ids, options = {}) {
  const cap = options.cap ?? DEFAULT_HISTORY_CAP
  const now = options.now ?? 0
  const base = normalizeHistory(list, Number.MAX_SAFE_INTEGER)
  if (!Array.isArray(ids) || !ids.length) return normalizeHistory(base, cap)
  const fresh = []
  const seen = new Set()
  for (const raw of ids) {
    const id = tabIdOf(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    fresh.push({ id, at: now })
  }
  const kept = base.filter((entry) => !seen.has(entry.id))
  return normalizeHistory([...fresh, ...kept], cap)
}

function readHistory() {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return normalizeHistory(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeHistory(next) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    }
  } catch {
    /* storage full or unavailable — keep going with in-memory state */
  }
  for (const listener of historyListeners) {
    try {
      listener(next)
    } catch {
      /* one bad subscriber must not break the rest */
    }
  }
  return next
}

export function historySnapshot() {
  return readHistory()
}

export function saveHistory(list) {
  return writeHistory(normalizeHistory(list))
}

export function subscribeHistory(listener) {
  historyListeners.add(listener)
  return () => historyListeners.delete(listener)
}

// ── layout helpers (roomier defaults than the reference) ────────────────────

export function scrollDeltaFor(container, item, pad = 6) {
  if (!container || !item) return 0
  const cRect = container.getBoundingClientRect()
  const iRect = item.getBoundingClientRect()
  if (iRect.left < cRect.left) return iRect.left - cRect.left - pad
  if (iRect.right > cRect.right) return iRect.right - cRect.right + pad
  return 0
}

export function stripFillWidth(limitLeft, barLeft, headerWidth, minimum = 180, reserve = 40) {
  const room = limitLeft - barLeft - reserve
  const byHeader = headerWidth * 0.7
  return Math.round(Math.max(minimum, Math.min(room, byHeader)))
}

// Room the strip bar may occupy before the shell's right-hand controls.
// 0 means "do not cap": nothing sits to the right of the bar, or the bar's
// natural content already fits — capping in that case would only make the
// strip scroll on its own and look indented.
//
// The gap before the controls is a real gutter, not a reserve: a wide reserve
// starves the strip in a narrow window, squeezing three chips into the corner
// while the header still has empty space to the right of them.
export const STRIP_GAP = 16
// Floor for the capped bar. Chips keep their own 96px minimum, so this buys
// two readable chips plus the add / history / overflow buttons; everything
// past that scrolls with the wheel instead of being squashed into the corner.
export const STRIP_MIN_ROOM = 300

// maxWidth only ever constrains (it never stretches the bar), so this can be
// applied unconditionally whenever something sits to the right of the bar.
export function stripRoomFor(limitLeft, barLeft, headerWidth) {
  if (!Number.isFinite(limitLeft)) return 0
  const available = Math.max(0, limitLeft - barLeft)
  const room = stripFillWidth(limitLeft, barLeft, headerWidth, 0, STRIP_GAP)
  if (room <= 0) return 0
  // Keep the strip usable when the row can afford it: a cap that leaves room
  // for less than a couple of chips reads as a stray indent, not as a cap.
  // The floor spends the gutter rather than shrinking the strip further.
  return Math.max(room, Math.min(STRIP_MIN_ROOM, available))
}

// Chips never get narrower than this: a row that cannot hold whole chips
// scrolls instead of shaving the last one down to a single glyph.
export const CHIP_MIN_WIDTH = 128
export const CHIP_GAP = 4

// Width the strip must take when the tabs cannot all fit at CHIP_MIN_WIDTH:
// the largest multiple of (chip + gap) that fits, so the row ends on a chip
// boundary rather than mid-glyph; the remaining tabs scroll. `width: 0` means
// "no snapping needed" — the chips simply share the row.
export function stripFitWidth(available, tabCount) {
  const room = Math.floor(available)
  const count = Math.floor(tabCount)
  if (!(room > 0) || !(count > 0)) return { width: 0, chipWidth: 0 }
  const perRow = Math.max(1, Math.floor((room + CHIP_GAP) / (CHIP_MIN_WIDTH + CHIP_GAP)))
  if (count <= perRow) return { width: 0, chipWidth: 0 }
  return {
    width: perRow * CHIP_MIN_WIDTH + (perRow - 1) * CHIP_GAP,
    chipWidth: CHIP_MIN_WIDTH,
  }
}
