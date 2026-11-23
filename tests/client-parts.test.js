import test from 'node:test'
import assert from 'node:assert/strict'

import { TIP_EDGE, pointInRect, placeTip } from '../src/client/tooltip.js'
import { normalizeGitBranch, createBranchCache, GitBranchRouteUnavailable, openWorkspacePathEnvelope, revealProjectFolder, openProjectInVscode } from '../src/client/gitbranch.js'
import { sessionStateOf } from '../src/client/helpers.js'
import { migrateViewStore } from '../src/client/store.js'

/* --------------------------- status classification --------------------------- */

test('sessionStateOf: pending wins, subagent running shows ongoing (sidebar parity)', () => {
  assert.equal(sessionStateOf({ pending: 'approval' }), 'warning')
  assert.equal(sessionStateOf({ pending: 'plan-review' }), 'warning')
  assert.equal(sessionStateOf({ pending: 'question' }), 'warning')
  // pending outranks running
  assert.equal(sessionStateOf({ pending: 'question', running: true }), 'warning')
  assert.equal(sessionStateOf({ running: true }), 'ongoing')
  // a parent whose subagents are still running shows ongoing even when idle
  assert.equal(sessionStateOf({ running: false, subagents: 2 }), 'ongoing')
  assert.equal(sessionStateOf({ subagents: 1, completed: true }), 'ongoing')
  // done only for non-current sessions with an unread completion
  assert.equal(sessionStateOf({ completed: true }), 'done')
  assert.equal(sessionStateOf({ completed: true }, true), null)
  assert.equal(sessionStateOf({}), null)
  assert.equal(sessionStateOf(null), null)
})

/* ------------------------------ store migration ------------------------------ */

test('migrateViewStore: v1→v2 re-defaults sidebarOpen and keeps other prefs', () => {
  const backing = new Map([['dsh.itab.view.v1', JSON.stringify({ prefs: { maxWidth: 300, statusPulse: true, sidebarOpen: 'replace' } })]])
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
  try {
    migrateViewStore()
    assert.equal(backing.has('dsh.itab.view.v1'), false, 'legacy key removed')
    const v2 = JSON.parse(backing.get('dsh.itab.view.v2'))
    assert.equal(v2.prefs.maxWidth, 300, 'unrelated prefs carried over')
    assert.equal(v2.prefs.statusPulse, true, 'unrelated prefs carried over')
    assert.equal('sidebarOpen' in v2.prefs, false, 'sidebarOpen re-defaults')
    // idempotent: a second run is a no-op (no v1 present)
    migrateViewStore()
    assert.equal(JSON.parse(backing.get('dsh.itab.view.v2')).prefs.maxWidth, 300)
  } finally {
    delete globalThis.localStorage
  }
})

test('migrateViewStore: corrupt v1 payload (no v2 yet) is left alone', () => {
  const backing = new Map([
    ['dsh.itab.view.v1', 'not json{{{'],
    ['dsh.itab.view.v2', JSON.stringify({ prefs: { sidebarOpen: 'replace' } })],
  ])
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
  try {
    // v2 already present: the stale v1 is dropped without parsing it
    migrateViewStore()
    assert.equal(backing.has('dsh.itab.view.v1'), false, 'stale v1 dropped when v2 exists')
    assert.equal(JSON.parse(backing.get('dsh.itab.view.v2')).prefs.sidebarOpen, 'replace', 'explicit v2 kept')
    // corrupt v1 with NO v2: the parse throws, nothing is written or removed
    backing.delete('dsh.itab.view.v2')
    backing.set('dsh.itab.view.v1', 'not json{{{')
    migrateViewStore()
    assert.equal(backing.has('dsh.itab.view.v1'), true, 'corrupt payload untouched')
    assert.equal(backing.has('dsh.itab.view.v2'), false, 'no v2 minted from garbage')
  } finally {
    delete globalThis.localStorage
  }
})

/* ------------------------------ placement ------------------------------ */

test('placeTip below: centred under the anchor, clamped to the edge', () => {
  const anchor = { left: 100, right: 200, top: 10, bottom: 30, width: 100, height: 20 }
  const size = { width: 80, height: 40 }
  const at = placeTip(anchor, size, { width: 1280, height: 800 }, 6, 'below')
  assert.equal(at.side, 'bottom')
  assert.equal(at.top, 36) // anchor.bottom + gap
  assert.equal(at.left, 110) // centred on the anchor
})

test('placeTip below: flips above when the bottom lacks room', () => {
  const anchor = { left: 100, right: 200, top: 760, bottom: 780, width: 100, height: 20 }
  const size = { width: 80, height: 60 }
  const at = placeTip(anchor, size, { width: 1280, height: 800 }, 6, 'below')
  assert.equal(at.side, 'top')
  assert.equal(at.top, 760 - 6 - 60) // above the anchor, gap away
})

test('placeTip below: never crosses the viewport edge', () => {
  const anchor = { left: 0, right: 40, top: 10, bottom: 30, width: 40, height: 20 }
  const size = { width: 300, height: 40 }
  const at = placeTip(anchor, size, { width: 500, height: 800 }, 6, 'below')
  assert.equal(at.left, TIP_EDGE) // centring would go negative
  // and the right side clamps too
  const right = { left: 480, right: 500, top: 10, bottom: 30, width: 20, height: 20 }
  const at2 = placeTip(right, size, { width: 500, height: 800 }, 6, 'below')
  assert.equal(at2.left, 500 - TIP_EDGE - 300)
})

test('pointInRect is inclusive on the edges', () => {
  const rect = { left: 0, right: 10, top: 0, bottom: 10 }
  assert.equal(pointInRect(rect, { x: 0, y: 10 }), true)
  assert.equal(pointInRect(rect, { x: 11, y: 5 }), false)
  assert.equal(pointInRect(null, { x: 0, y: 0 }), false)
})

/* ------------------------------ branch cache ------------------------------ */

test('normalizeGitBranch trims and rejects the detached placeholder', () => {
  assert.equal(normalizeGitBranch('  main '), 'main')
  assert.equal(normalizeGitBranch('HEAD'), '')
  assert.equal(normalizeGitBranch(undefined), '')
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('branchCache: one microtask batch, TTL reuse, cooldown after failure', async () => {
  let clock = 1_000
  const calls = []
  let failNext = false
  const cache = createBranchCache({
    ttlMs: 100,
    failCooldownMs: 50,
    now: () => clock,
    fetchBranches: async (paths) => {
      calls.push([...paths])
      if (failNext) throw new Error('host hiccup')
      const answer = {}
      for (const p of paths) answer[p] = p.slice(1)
      return answer
    },
  })
  // Same microtask → one batched request for both paths.
  cache.ensure(['/a', '/b'])
  cache.ensure(['/b', '/c'])
  await flush()
  assert.deepEqual(calls, [['/a', '/b', '/c']])
  assert.equal(cache.branchOf('/a'), 'a')
  assert.equal(cache.branchOf('/missing-in-answer'), '') // host omitted → no branch

  // Within the TTL: quiet.
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 1)

  // Past the TTL: re-asked (and answered → cooldown cleared).
  clock += 101
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 2)

  // A failed request quiets the cache for the cooldown window.
  failNext = true
  clock += 101
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 3)
  clock += 1 // still inside the 50ms cooldown
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 3)
  clock += 60 // cooldown over → retried
  failNext = false
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 4)
})

test('branchCache: a missing route disables the cache permanently', async () => {
  let clock = 1_000
  const calls = []
  const cache = createBranchCache({
    ttlMs: 100,
    now: () => clock,
    fetchBranches: async (paths) => { calls.push([...paths]); throw GitBranchRouteUnavailable('route missing') },
  })
  cache.ensure(['/a'])
  await flush()
  assert.equal(calls.length, 1)
  clock += 1000
  cache.ensure(['/a'])
  await flush() // never retried: the route is not mounted
  assert.equal(calls.length, 1)
})

test('branchCache: relative paths are never sent', async () => {
  const calls = []
  const cache = createBranchCache({ fetchBranches: async (paths) => { calls.push([...paths]); return {} } })
  cache.ensure(['relative', '', null, undefined, '/abs'])
  await flush()
  assert.deepEqual(calls, [['/abs']])
})

test('branchCache: subscribers hear answers and can unsubscribe', async () => {
  const cache = createBranchCache({ fetchBranches: async (paths) => ({ '/a': 'main' }) })
  const seen = []
  const off = cache.subscribe(() => seen.push(cache.branchOf('/a')))
  cache.ensure(['/a'])
  await flush()
  assert.deepEqual(seen, ['main'])
  off()
  cache.ensure(['/a']) // within TTL: no fetch, no notify
  await flush()
  assert.deepEqual(seen, ['main'])
})

/* ------------------------------ reveal folder ------------------------------ */

test('openWorkspacePathEnvelope mirrors the shell client-request shape', () => {
  const envelope = openWorkspacePathEnvelope('/tmp/x', 'rpc-1')
  assert.deepEqual(envelope, {
    type: 'client-request',
    rpcId: 'rpc-1',
    method: 'session/openWorkspacePath',
    payload: { args: { request: { path: '/tmp/x' } } },
  })
})

test('revealProjectFolder: confirms only on opened:true; folds failures into false', async () => {
  const replies = []
  const ok = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async () => replies.shift()
  replies.push(ok({ result: { ok: true, value: { opened: true } } }))
  assert.equal(await revealProjectFolder('/a'), true)
  // host answered but did not open (e.g. path gone)
  replies.push(ok({ result: { ok: true, value: { opened: false } } }))
  assert.equal(await revealProjectFolder('/a'), false)
  // RPC error envelope
  replies.push(ok({ result: { ok: false, error: { message: 'nope' } } }))
  assert.equal(await revealProjectFolder('/a'), false)
  // transport-level rejection and HTTP error
  replies.push(Promise.reject(new Error('network')))
  assert.equal(await revealProjectFolder('/a'), false)
  replies.push({ ok: false, json: async () => ({}) })
  assert.equal(await revealProjectFolder('/a'), false)
  // empty path never fetches
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return ok({}) }
  assert.equal(await revealProjectFolder('   '), false)
  assert.equal(fetched, false)
})

test('openProjectInVscode: confirms only on opened:true; folds every failure into false', async () => {
  const ok = (body) => ({ ok: true, json: async () => body })
  const replies = []
  globalThis.fetch = async () => replies.shift()
  replies.push(ok({ ok: true, value: { opened: true } }))
  assert.equal(await openProjectInVscode('/a'), true)
  // route answered but the editor never opened
  replies.push(ok({ ok: false, error: 'open-failed' }))
  assert.equal(await openProjectInVscode('/a'), false)
  // route missing entirely (plugin host half older than the feature)
  replies.push({ ok: false, status: 404, json: async () => ({}) })
  assert.equal(await openProjectInVscode('/a'), false)
  // transport failure
  replies.push(Promise.reject(new Error('network')))
  assert.equal(await openProjectInVscode('/a'), false)
  // empty path never fetches
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return ok({}) }
  assert.equal(await openProjectInVscode('  '), false)
  assert.equal(fetched, false)
})
