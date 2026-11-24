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
  return {
    beginRender() { cursor = 0 },
    useEffect(fn, deps) {
      const at = cursor++
      const prev = slots[at]
      const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, i) => d !== prev.deps[i])
      slots[at] = { deps }
      if (changed) fn()
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
  const ctx = { P, localStorage: storage.stub }
  vm.createContext(ctx)
  vm.runInContext(source + '\nthis.__useTabSync = useTabSync; this.__resetLastCurrent = () => { lastCurrentId = "" }', ctx)
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

test('useTabSync: deleting the last session (nothing on screen) still prunes, without history', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['x'], 'x')
  env.ctx.__useTabSync(snapshotWith('ready', {}, null), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), [])
  assert.equal(model.tabsActive(), '')
  assert.deepEqual(model.historySnapshot(), [], 'deletion is not a close: nothing to reopen')
})

test('useTabSync: a list that is not ready never prunes, even with an empty byId and no current', (t) => {
  const env = makeEnv()
  t.after(env.restore)
  env.ctx.__resetLastCurrent()
  model.saveTabs(['a', 'b'], 'b')
  env.ctx.__useTabSync(snapshotWith('pending', {}, null), noWorkspaces, prefs)
  assert.deepEqual(model.tabsSnapshot(), ['a', 'b'])
})
