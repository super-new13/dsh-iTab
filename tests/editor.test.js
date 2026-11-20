import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OPEN_VSCODE_ROUTE,
  vscodeCandidates,
  buildOpenCommand,
  openInVscode,
} from '../src/index.js'

test('open-in-vscode route path is exact and namespaced', () => {
  assert.equal(OPEN_VSCODE_ROUTE, '/dsh-itab/open-in-vscode')
})

test('vscodeCandidates: darwin lists every well-known install before the PATH gamble', () => {
  assert.deepEqual(vscodeCandidates('darwin', {}), [
    '/opt/homebrew/bin/code',
    '/usr/local/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    'code',
  ])
})

test('vscodeCandidates: win32 covers per-user and per-machine installers', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\morgan\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
  assert.deepEqual(vscodeCandidates('win32', env), [
    'C:\\Users\\morgan\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
    'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
    'code',
  ])
  // A missing env var just drops that candidate instead of emitting junk.
  assert.deepEqual(vscodeCandidates('win32', {}), ['code'])
})

test('vscodeCandidates: linux covers distro, oss and snap layouts', () => {
  assert.deepEqual(vscodeCandidates('linux', {}), [
    '/usr/bin/code',
    '/usr/bin/code-oss',
    '/snap/bin/code',
    '/usr/local/bin/code',
    'code',
  ])
})

test('buildOpenCommand: posix is a direct spawn with the directory as argv', () => {
  const command = buildOpenCommand('darwin', {}, '/usr/local/bin/code', '/Users/m x/proj')
  assert.equal(command.file, '/usr/local/bin/code')
  assert.deepEqual(command.args, ['/Users/m x/proj'])
  assert.equal(command.options.stdio, 'ignore')
})

test('buildOpenCommand: win32 goes through cmd.exe /d /s /c with one verbatim quoted line', () => {
  const env = { comspec: 'C:\\Windows\\System32\\cmd.exe' }
  const command = buildOpenCommand('win32', env, 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd', 'D:\\my proj')
  assert.equal(command.file, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(command.args, ['/d', '/s', '/c', '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd" "D:\\my proj"'])
  assert.equal(command.options.windowsVerbatimArguments, true)
  // comspec missing falls back to cmd.exe from PATH.
  const fallback = buildOpenCommand('win32', {}, 'code', 'D:\\proj')
  assert.equal(fallback.file, 'cmd.exe')
})

/** A spawn stub that reports the given exit code, recording what ran. */
const fakeSpawn = (exitCode, log) => (file, args, options) => {
  log.push({ file, args, options })
  return {
    on: (event, handler) => {
      if (event === 'close') queueMicrotask(() => handler(exitCode))
    },
    kill: () => {},
  }
}

test('openInVscode: happy path resolves the first existing candidate and confirms exit 0', async () => {
  const spawned = []
  const existsProbes = []
  const ok = await openInVscode('/Users/morgan/proj', {
    platform: 'darwin',
    env: {},
    exists: (p) => { existsProbes.push(p); return p === '/usr/local/bin/code' },
    spawn: fakeSpawn(0, spawned),
    isDirectory: async () => true,
  })
  assert.equal(ok, true)
  assert.deepEqual(existsProbes, ['/opt/homebrew/bin/code', '/usr/local/bin/code'])
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].file, '/usr/local/bin/code')
  assert.deepEqual(spawned[0].args, ['/Users/morgan/proj'])
})

test('openInVscode: non-zero exit, missing editor, bad path all fold to false', async () => {
  const spawned = []
  // exit 1 → false
  assert.equal(await openInVscode('/p', {
    platform: 'darwin', env: {}, exists: () => false,
    spawn: fakeSpawn(1, spawned), isDirectory: async () => true,
  }), false)
  // nothing exists at all → bare 'code' PATH gamble also spawned, still false
  assert.equal(await openInVscode('/p', {
    platform: 'darwin', env: {}, exists: () => false,
    spawn: fakeSpawn(1, spawned), isDirectory: async () => true,
  }), false)
  // not a directory → never spawns
  assert.equal(await openInVscode('/p', {
    platform: 'darwin', env: {}, exists: () => true,
    spawn: fakeSpawn(0, spawned), isDirectory: async () => false,
  }), false)
  // relative path rejected before any probe
  assert.equal(await openInVscode('relative', {
    platform: 'darwin', env: {}, exists: () => true,
    spawn: fakeSpawn(0, spawned), isDirectory: async () => true,
  }), false)
  assert.equal(spawned.length, 2) // only the two darwin attempts above ran
})

test('openInVscode: a resolved candidate is cached — the second call stops probing the disk', async () => {
  const spawned = []
  let probes = 0
  const deps = {
    platform: 'linux', // distinct platform so this test has its own cache slot
    env: {},
    exists: (p) => { probes += 1; return p === '/usr/bin/code' },
    spawn: fakeSpawn(0, spawned),
    isDirectory: async () => true,
  }
  assert.equal(await openInVscode('/repo', deps), true)
  assert.equal(await openInVscode('/repo', deps), true)
  assert.equal(probes, 1) // '/usr/bin/code' found on the first pass only
  assert.equal(spawned.length, 2) // but each call still spawns the CLI
})

test('openInVscode: win32 spawns through cmd.exe with the verbatim recipe', async () => {
  const spawned = []
  const ok = await openInVscode('D:\\my proj', {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\l', ProgramFiles: 'C:\\pf' },
    exists: (p) => p === 'C:\\l\\Programs\\Microsoft VS Code\\bin\\code.cmd',
    spawn: fakeSpawn(0, spawned),
    isDirectory: async () => true,
  })
  assert.equal(ok, true)
  assert.equal(spawned[0].file, 'cmd.exe')
  assert.deepEqual(spawned[0].args, ['/d', '/s', '/c', '"C:\\l\\Programs\\Microsoft VS Code\\bin\\code.cmd" "D:\\my proj"'])
})
