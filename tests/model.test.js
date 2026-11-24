import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MAX_TABS,
  normalizeTabs,
  openTab,
  replaceTab,
  moveTab,
  closeTab,
  closeOthers,
  closeRight,
  closeAll,
  pushClosed,
  reopenTab,
  tabsForClick,
  reconcileTabs,
  tabsSnapshot,
  tabsActive,
  saveTabs,
  setActiveTab,
  subscribeTabs,
  stripFillWidth,
  stripRoomFor,
  STORAGE_KEY,
  normalizeHistory,
  pushHistory,
  historySnapshot,
  saveHistory,
  subscribeHistory,
  HISTORY_KEY,
  DEFAULT_HISTORY_CAP,
} from '../src/client/model.js'

const T = ['a', 'b', 'c', 'd', 'e']

test('normalizeTabs dedupes, drops empties, caps', () => {
  assert.deepEqual(normalizeTabs(['a', 'b', 'a', '', 3, 'c']), ['a', 'b', '3', 'c'])
  assert.deepEqual(normalizeTabs('nope'), [])
  assert.deepEqual(normalizeTabs(null), [])
  assert.equal(normalizeTabs(T, 3).length, 3)
})

test('openTab appends, respects cap by dropping oldest', () => {
  assert.deepEqual(openTab(['a', 'b'], 'c'), ['a', 'b', 'c'])
  assert.deepEqual(openTab(['a', 'b'], 'b'), ['a', 'b'])
  assert.deepEqual(openTab(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd'])
})

test('replaceTab swaps in place or merges', () => {
  assert.deepEqual(replaceTab(T, 'c', 'x'), ['a', 'b', 'x', 'd', 'e'])
  assert.deepEqual(replaceTab(T, 'c', 'e'), ['a', 'b', 'd', 'e'])
  assert.deepEqual(replaceTab(T, 'zz', 'x'), ['a', 'b', 'c', 'd', 'e', 'x'])
})

test('moveTab splices at the original target index', () => {
  assert.deepEqual(moveTab(T, 'a', 'd'), ['b', 'c', 'a', 'd', 'e'])
  assert.deepEqual(moveTab(T, 'e', 'a'), ['e', 'a', 'b', 'c', 'd'])
  assert.deepEqual(moveTab(T, 'c', 'c'), T)
})

test('closeTab picks right neighbour then left', () => {
  assert.deepEqual(closeTab(T, 'c'), { closed: true, tabs: ['a', 'b', 'd', 'e'], next: 'd' })
  assert.deepEqual(closeTab(T, 'e'), { closed: true, tabs: ['a', 'b', 'c', 'd'], next: 'd' })
  assert.deepEqual(closeTab(T, 'a'), { closed: true, tabs: ['b', 'c', 'd', 'e'], next: 'b' })
  assert.equal(closeTab(T, 'zz').closed, false)
  const last = closeTab(['a'], 'a')
  assert.deepEqual(last, { closed: true, tabs: [], next: null })
})

test('closeOthers keeps anchor only, reports closed ids', () => {
  const r = closeOthers(T, 'c')
  assert.deepEqual(r.tabs, ['c'])
  assert.deepEqual(r.closedIds, ['a', 'b', 'd', 'e'])
  // anchor not open → no-op (caller switches to anchor instead)
  const noop = closeOthers(T, 'zz')
  assert.deepEqual(noop, { tabs: T, closedIds: [] })
})

test('closeRight drops everything right of anchor', () => {
  const r = closeRight(T, 'c')
  assert.deepEqual(r.tabs, ['a', 'b', 'c'])
  assert.deepEqual(r.closedIds, ['d', 'e'])
  const tail = closeRight(T, 'e')
  assert.deepEqual(tail, { tabs: T, closedIds: [] })
})

test('closeAll empties the strip', () => {
  assert.deepEqual(closeAll(), { tabs: [], closedIds: null })
})

test('pushClosed most-recent-first, capped, deduped', () => {
  const s1 = pushClosed([], ['a', 'b', 'c'])
  assert.deepEqual(s1, ['c', 'b', 'a']) // rightmost/last closed pops first
  const s2 = pushClosed(s1, ['b'])
  assert.deepEqual(s2, ['b', 'c', 'a'])
  const s3 = pushClosed([], ['1', '2', '3'], 2)
  assert.deepEqual(s3, ['3', '2'])
})

test('reopenTab skips already-open ids', () => {
  const { stack, id } = reopenTab(['c', 'b', 'a'], ['b'])
  assert.equal(id, 'c')
  assert.deepEqual(stack, ['b', 'a'])
  const none = reopenTab(['a'], ['a'])
  assert.equal(none.id, null)
  assert.deepEqual(none.stack, [])
})

test('tabsForClick XOR of preference and shift', () => {
  // default: click switches, shift opens
  assert.equal(tabsForClick(T, 'a', 'c', { shift: false }).opened, false)
  assert.equal(tabsForClick(T, 'a', 'c', { shift: true }).opened, true)
  // inverted preference: click opens, shift switches
  assert.equal(tabsForClick(T, 'a', 'c', { newTabOnClick: true, shift: false }).opened, true)
  assert.equal(tabsForClick(T, 'a', 'c', { newTabOnClick: false, shift: false }).opened, false)
  assert.equal(tabsForClick(T, 'a', 'c', { newTabOnClick: false, shift: true }).opened, true)
  // opening seeds from the active tab when the strip is empty
  assert.deepEqual(tabsForClick([], '', 'x', { shift: true }), { tabs: ['x'], opened: true })
})

test('reconcileTabs opens a new tab by default (browser-like)', () => {
  assert.deepEqual(reconcileTabs(T, 'x', 'c'), ['a', 'b', 'c', 'd', 'e', 'x'])
})

test('reconcileTabs replaces the current tab only when sidebarOpen=replace (opt-in)', () => {
  assert.deepEqual(reconcileTabs(T, 'x', 'c', { sidebarOpen: 'replace' }), ['a', 'b', 'x', 'd', 'e'])
})

test('reconcileTabs keeps blank tabs open', () => {
  const blank = (id) => id === 'new'
  // blank current appends as a kept tab (browser keeps the new-tab page open)
  assert.deepEqual(reconcileTabs(T, 'new', 'c', { isBlank: blank }), ['a', 'b', 'c', 'd', 'e', 'new'])
  // navigating away from a blank tab opens the target instead of replacing
  assert.deepEqual(reconcileTabs(T, 'x', 'new', { isBlank: blank }), ['a', 'b', 'c', 'd', 'e', 'x'])
})

test('reconcileTabs drops archived and never strands the on-screen session', () => {
  const archived = (id) => id === 'b'
  assert.deepEqual(reconcileTabs(T, 'a', 'c', { isArchived: archived }), ['a', 'c', 'd', 'e'])
  // previous closed → current still gets a tab (open mode appends)
  assert.deepEqual(reconcileTabs(['a', 'b'], 'z', 'b'), ['a', 'b', 'z'])
})

test('reconcileTabs never resurrects a deliberately closed current tab (no navigation)', () => {
  // close-one/close-all: current stays on screen, its tab must stay closed
  assert.deepEqual(reconcileTabs(['b', 'c'], 'a', 'a'), ['b', 'c'])
  assert.deepEqual(reconcileTabs([], 'x', 'x'), [])
  // even a blank session's tab stays closed when it was closed in place
  const blank = (id) => id === 'new'
  assert.deepEqual(reconcileTabs(['b'], 'new', 'new', { isBlank: blank }), ['b'])
  // navigation to a blank session still opens its tab (previous differs)
  assert.deepEqual(reconcileTabs(['b'], 'new', 'b', { isBlank: blank }), ['b', 'new'])
})

test('reconcileTabs drops deleted sessions (isDeleted) and never strands the on-screen one', () => {
  const deleted = (id) => id === 'b' || id === 'd'
  // a background tab whose session was removed from the sidebar closes itself
  assert.deepEqual(reconcileTabs(T, 'a', 'a', { isDeleted: deleted }), ['a', 'c', 'e'])
  // the previously-active (deleted) tab is gone → current still gets a tab
  assert.deepEqual(reconcileTabs(T, 'z', 'b', { isDeleted: deleted, sidebarOpen: 'replace' }), ['a', 'c', 'e', 'z'])
  // replace mode: a surviving previous tab is replaced by the new current
  assert.deepEqual(reconcileTabs(T, 'z', 'c', { isDeleted: deleted, sidebarOpen: 'replace' }), ['a', 'z', 'e'])
  // no predicate → nothing pruned (cold start: list not authoritative yet)
  assert.deepEqual(reconcileTabs(T, 'a', 'a'), T)
  // no session on screen: prune still happens
  assert.deepEqual(reconcileTabs(T, null, 'a', { isDeleted: deleted }), ['a', 'c', 'e'])
})

test('persistence roundtrips through localStorage', (t) => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
  t.after(() => {
    delete globalThis.localStorage
  })
  saveTabs(['a', 'b'], 'a')
  assert.deepEqual(tabsSnapshot(), ['a', 'b'])
  assert.equal(tabsActive(), 'a')
  setActiveTab('b')
  assert.equal(tabsActive(), 'b')
  assert.deepEqual(tabsSnapshot(), ['a', 'b'])

  let seen = null
  const off = subscribeTabs((tabs, active) => (seen = { tabs, active }))
  saveTabs(['c'], 'c')
  assert.deepEqual(seen, { tabs: ['c'], active: 'c' })
  off()
  saveTabs(['d'], 'd')
  assert.deepEqual(seen, { tabs: ['c'], active: 'c' }) // no notify after unsubscribe
  assert.match(backing.get(STORAGE_KEY), /"tabs":\["d"\]/)
})

test('stripFillWidth stays roomier than the reference', () => {
  // 1600px header, strip starts at 16, right controls at 1200 → plenty of room
  assert.equal(stripFillWidth(1200, 16, 1600), 1120)
  // cramped: room 260-16-40=204 still beats the minimum; below ~236 it clamps to 180
  assert.equal(stripFillWidth(260, 16, 1600), 204)
  assert.equal(stripFillWidth(200, 16, 1600), 180)
  // never exceeds 70% of header width
  assert.equal(stripFillWidth(2000, 0, 1000), 700)
})

test('stripRoomFor caps to the space before the shell controls', () => {
  // Nothing to the right of the bar: no cap at all (CSS 70vw still applies).
  assert.equal(stripRoomFor(Infinity, 16, 1600), 0)
  // Roomier than the reference: a 16px gutter, never past 70% of the header.
  assert.equal(stripRoomFor(1200, 16, 1600), 1120)
  // The narrow-window case seen in the GUI: 679px header, leading region at
  // 301, shell controls at 609. The old 100px reserve capped the bar at 208
  // and squeezed three chips into 118px; a real gutter gives it 292.
  assert.equal(stripRoomFor(609, 301, 679), 292)
  // Cramped row: the gutter wins over the 240px floor (available 224).
  assert.equal(stripRoomFor(240, 16, 1600), 208)
  // Degenerate measurement (controls left of the bar): no cap, never negative.
  assert.equal(stripRoomFor(300, 301, 679), 0)
})

test('DEFAULT_MAX_TABS is roomier than the reference cap', () => {
  assert.equal(DEFAULT_MAX_TABS, 20)
})

test('pushHistory dedupes, re-closes move to top with fresh time, and caps', () => {
  const base = [{ id: 'a', at: 100 }, { id: 'b', at: 200 }, { id: 'c', at: 300 }]
  // new close lands first, others keep their timestamps
  assert.deepEqual(pushHistory(base, ['d'], { now: 999 }), [
    { id: 'd', at: 999 }, { id: 'a', at: 100 }, { id: 'b', at: 200 }, { id: 'c', at: 300 },
  ])
  // re-closing 'a' moves it to the top with a fresh time; b/c untouched
  assert.deepEqual(pushHistory(base, ['a'], { now: 999 }), [
    { id: 'a', at: 999 }, { id: 'b', at: 200 }, { id: 'c', at: 300 },
  ])
  // duplicate ids inside one push collapse
  assert.deepEqual(pushHistory([], ['x', 'x'], { now: 5 }), [{ id: 'x', at: 5 }])
  // cap respected
  const many = Array.from({ length: DEFAULT_HISTORY_CAP + 10 }, (_, i) => ({ id: 's' + i, at: i }))
  assert.equal(pushHistory(many, [], { now: 0 }).length, DEFAULT_HISTORY_CAP)
  // invalid entries dropped
  assert.deepEqual(normalizeHistory([{ id: 'ok', at: 1 }, null, { at: 2 }, { id: 'dup', at: 3 }, { id: 'dup', at: 4 }]), [
    { id: 'ok', at: 1 }, { id: 'dup', at: 3 },
  ])
})

test('history persists through localStorage and notifies subscribers', () => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
  try {
    saveHistory(pushHistory([], ['a', 'b'], { now: 42 }))
    assert.deepEqual(historySnapshot(), [{ id: 'a', at: 42 }, { id: 'b', at: 42 }])
    assert.match(backing.get(HISTORY_KEY), /"id":"a"/)
    const seen = []
    const off = subscribeHistory((list) => seen.push(list.map((e) => e.id)))
    saveHistory(pushHistory(historySnapshot(), ['c'], { now: 50 }))
    assert.deepEqual(seen, [['c', 'a', 'b']]) // newest close first
    off()
    saveHistory([])
    assert.equal(seen.length, 1) // no notify after unsubscribe
    assert.deepEqual(historySnapshot(), [])
  } finally {
    delete globalThis.localStorage
  }
})
