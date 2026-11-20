import test from 'node:test'
import assert from 'node:assert/strict'

import {
  name,
  parseBranchName,
  createBranchResolver,
  GIT_BRANCH_ROUTE,
} from '../src/index.js'

test('plugin identity stays stable (cordis logs key on it)', () => {
  assert.equal(name, 'dsh-itab')
  assert.equal(GIT_BRANCH_ROUTE, '/dsh-itab/git-branch')
})

test('parseBranchName: first non-empty line only, HEAD means detached', () => {
  assert.equal(parseBranchName('main\n'), 'main')
  assert.equal(parseBranchName('\n\n  feature/x  \nother'), 'feature/x')
  assert.equal(parseBranchName('HEAD'), '') // detached work tree is no branch
  assert.equal(parseBranchName(''), '')
})

const dir = (p) => p.startsWith('/')

test('createBranchResolver: answers, omits empty branches, drops noise', async () => {
  const reads = []
  const resolver = createBranchResolver({
    ttlMs: 60_000,
    isDirectory: async () => true,
    readBranch: async (d) => { reads.push(d); return d === '/no-branch' ? '' : parseBranchName(d.split('/').pop()) },
  })
  const branches = await resolver.resolve(['/main', '/no-branch', 'relative', 42, '/main'])
  assert.deepEqual(branches, { '/main': 'main' }) // empty branch omitted, dupes/nonsense dropped
  assert.deepEqual(reads, ['/main', '/no-branch'])

  // Cache: the same paths inside the TTL cost no further probes.
  await resolver.resolve(['/main', '/no-branch'])
  assert.equal(reads.length, 2)
})

test('createBranchResolver: ttl expiry re-probes', async () => {
  let clock = 1_000
  const reads = []
  const resolver = createBranchResolver({
    ttlMs: 10,
    now: () => clock,
    isDirectory: async () => true,
    readBranch: async (d) => { reads.push(d); return 'dev' },
  })
  await resolver.resolve(['/repo'])
  clock += 11 // past the TTL
  await resolver.resolve(['/repo'])
  assert.equal(reads.length, 2)
})

test('createBranchResolver: an unreadable directory is cached as no-branch', async () => {
  let clock = 1_000
  const reads = []
  const resolver = createBranchResolver({
    ttlMs: 60_000,
    now: () => clock,
    isDirectory: async () => false,
    readBranch: async (d) => { reads.push(d); return 'never' },
  })
  const branches = await resolver.resolve(['/gone'])
  assert.deepEqual(branches, {}) // not a directory → no answer, and…
  await resolver.resolve(['/gone']) // …remembered, so no probe happened
  assert.deepEqual(reads, [])
})

test('createBranchResolver: a throwing probe is a per-path no-answer', async () => {
  const resolver = createBranchResolver({
    ttlMs: 60_000,
    isDirectory: async (d) => { if (d === '/boom') throw new Error('stat failed'); return true },
    readBranch: async () => 'main',
  })
  const branches = await resolver.resolve(['/ok', '/boom'])
  assert.deepEqual(branches, { '/ok': 'main' })
})
