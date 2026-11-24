/* Drives useTabSync (src/client/hooks.js) in a vm context with a minimal
 * React stub so the effect body actually runs: the strip's reconcile is
 * what closes the tab of a session deleted from the sidebar. hooks.js is a
 * bundle part (no ESM exports; it resolves model/helpers through the shared
 * P scope), so the test concatenates the same parts the build does. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import * as model from '../src/client/model.js'

const part = (name) => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8').replace(/^export /gm, '')
const source = ['model.js', 'store.js', 'helpers.js', 'hooks.js'].map(part).join('\n')

/** Minimal React: effects run synchronously after each render, hooks keep
 *  their slots per-render-call order (useTabSync uses exactly one). */
function makeReact() {
  const slots = []
  let cursor = 0
  const runEffect = (fn, deps) => {
    const at = cursor++
    const prev = slots[at]
    const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, i) => d !== prev.deps[i])
    slots[at] = { deps }
    if (changed) fn()
  }
  return {
    beginRender() { cursor = 0 },
    useEffect: runEffect,
    useLayoutEffect: runEffect,
    useState(initial) {
      const at = cursor++
      if (!slots[at] || !('value' in slots[at])) slots[at] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[at]
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
    },
  }
}

/** The strip stores its tabs through localStorage; the test drives the
 *  REAL model (imported here) and the REAL hook (evaluated in the vm), so
 *  both sides share one in-memory backing map. */
function makeStorage() {
  const backing = new Map()
  return {
    backing,
    stub: {
      getItem: (k) => (backing.has(k) ? backing.get(k) : null),
      setItem: (k, v) => backing.set(k, String(v)),
      removeItem: (k) => backing.delete(k),
    },
  }
}

function makeEnv() {
  const storage = makeStorage()
  globalThis.localStorage = storage.stub
  const P = { React: makeReact() }
  const ctx = { P, localStorage: storage.stub, window: { addEventListener() {}, removeEventListener() {} } }
  vm.createContext(ctx)
  vm.runInContext(source + '\nthis.__useTabSync = useTabSync; this.__useStripOverflow = useStripOverflow; this.__resetLastCurrent = () => { lastCurrentId = ""; fallbackFrom = "" }', ctx)
  return { ctx, restore: () => { delete globalThis.localStorage } }
}

const snapshotWith = (phase, byId, mainView) => ({
  phase,
  byId: Object.fromEntries(Object.entries(byId).map(([id, blank]) => [id, {
    id, blank, retainedBy: { mainView: id === mainView ? 1 : 0 },
  }])),
})
const noWorkspaces = () => null
const prefs = {}

const fakeStrip = (scrollWidth, clientWidth, scrollLeft) => {
  const el = { scrollWidth, clientWidth, scrollLeft, children: [], addEventListener() {}, removeEventListener() {} }
  return { current: el }
}

test('useStripOverflow: a strip that fits always renders from offset 0', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  // Offset left over from an earlier overflow (or a session switch that shrank
  // the chips): with everything fitting, it must snap back — otherwise the
  // first chip looks indented for the rest of that session.
  const fits = fakeStrip(667, 667, 37)
  env.ctx.__useStripOverflow(fits, [])
  assert.equal(fits.current.scrollLeft, 0)
})

test('useStripOverflow: a genuinely overflowing strip keeps its offset', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  const wide = fakeStrip(900, 600, 250)
  env.ctx.__useStripOverflow(wide, [])
  assert.equal(wide.current.scrollLeft, 250, 'scrolled chips stay put')
})

test('useTabSync: pending list (empty byId) never wipes the persisted tabs', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  model.saveTabs(['a', 'b', 'c'], 'c')
  env.ctx.__useTabSync(snapshotWith('pending', { c: false }, 'c'), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a', 'b', 'c'], 'cold start keeps every chip')
})

test('useTabSync: a session deleted from the sidebar closes its tab by itself', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'c')
  // b was deleted while a different session (c) is on screen
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, c: false }, 'c'), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a', 'c'])
  assert.equal(model.tabsActive(), 'c', 'active untouched while it still exists')
})

test('useTabSync: deleting the on-screen session prunes its chip and clears the stale active', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b'], 'b')
  // b (on screen, active) is gone and the host moved to a
  env.ctx.__useTabSync(snapshotWith('ready', { a: false }, 'a'), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a'])
  assert.equal(model.tabsActive(), 'a')
})

test('useTabSync: deleting the last session prunes its chip, without history', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['x'], 'x')
  // the host created a fresh blank session after the deletion, so the list is
  // non-empty: absence there IS evidence of a deletion
  env.ctx.__useTabSync(snapshotWith('ready', { fresh: true }, null), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), [])
  assert.equal(model.tabsActive(), '')
  assert.deepEqual(model.historySnapshot(), [], 'deletion is not a close: nothing to reopen')
})

test('useTabSync: an empty ready list is a transient, never a reason to wipe the chips', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'c')
  // reconnect / list reload publishes { byId: {} } while phase is already 'ready';
  // closing one tab used to wipe all three through this frame
  const opened = []
  env.ctx.__useTabSync(snapshotWith('ready', {}, 'c'), noWorkspaces, prefs, (id) => opened.push(id))
  assert.deepEqual(model.tabsSnapshot(), ['a', 'b', 'c'], 'no chip is dropped')
  assert.deepEqual(opened, [], 'and no fallback navigation is triggered')
  // the real list comes back: everything survives untouched
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, b: false, c: false }, 'c'), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a', 'b', 'c'])
  assert.equal(model.tabsActive(), 'c')
})

test('useTabSync: a list that is not ready never prunes, even with an empty byId and no current', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b'], 'b')
  env.ctx.__useTabSync(snapshotWith('pending', {}, null), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a', 'b'])
})

test('useTabSync: deleting the on-screen session lands on the last surviving tab, not on the blank landing', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'b')
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, b: false, c: false }, 'b'), noWorkspaces, prefs)
  assert.equal(model.tabsActive(), 'b')
  // b (on screen) is gone; the host moved to a fresh blank session 'new'
  const opened = []
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, c: false, new: true }, 'new'), noWorkspaces, prefs, (id) => opened.push(id))
  assert.deepEqual(model.tabsSnapshot(), ['a', 'c'], 'no chip is minted for the blind landing')
  assert.equal(model.tabsActive(), 'c', 'active follows the fallback tab')
  assert.deepEqual(opened, ['c'], 'the strip navigates to the last surviving tab')
  assert.deepEqual(model.historySnapshot(), [], 'deletion is not a close: nothing to reopen')
})

test('useTabSync: the fallback redirect fires once, even if the store ticks before the host lands', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'b')
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, b: false, c: false }, 'b'), noWorkspaces, prefs)
  const landed = snapshotWith('ready', { a: false, c: false, new: true }, 'new')
  const opened = []
  const open = (id) => opened.push(id)
  env.ctx.__useTabSync(landed, noWorkspaces, prefs, open)
  env.ctx.__useTabSync(landed, noWorkspaces, prefs, open)
  assert.deepEqual(opened, ['c'])
  assert.deepEqual(model.tabsSnapshot(), ['a', 'c'])
  assert.equal(model.tabsActive(), 'c')
})

test('useTabSync: once the fallback tab is on screen it stays put and nothing new opens', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'b')
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, b: false, c: false }, 'b'), noWorkspaces, prefs)
  // the host settled on c, which already owns a chip
  const opened = []
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, c: false }, 'c'), noWorkspaces, prefs, (id) => opened.push(id))
  assert.deepEqual(opened, [])
  assert.deepEqual(model.tabsSnapshot(), ['a', 'c'])
  assert.equal(model.tabsActive(), 'c')
})

test('useTabSync: deleting the on-screen session with nothing left keeps the blank landing chip', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['x'], 'x')
  env.ctx.__useTabSync(snapshotWith('ready', { x: false }, 'x'), noWorkspaces, prefs)
  const opened = []
  env.ctx.__useTabSync(snapshotWith('ready', { fresh: true }, 'fresh'), noWorkspaces, prefs, (id) => opened.push(id))
  assert.deepEqual(model.tabsSnapshot(), ['fresh'], 'an empty strip would be a dead end')
  assert.equal(model.tabsActive(), 'fresh')
  assert.deepEqual(opened, [])
})

test('useTabSync: deleting the on-screen session when the host lands nowhere still goes to the last tab', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b', 'c'], 'b')
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, b: false, c: false }, 'b'), noWorkspaces, prefs)
  const opened = []
  env.ctx.__useTabSync(snapshotWith('ready', { a: false, c: false }, null), noWorkspaces, prefs, (id) => opened.push(id))
  assert.deepEqual(model.tabsSnapshot(), ['a', 'c'])
  assert.equal(model.tabsActive(), 'c')
  assert.deepEqual(opened, ['c'])
})
