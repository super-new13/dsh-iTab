/**
 * dsh-iTab host half.
 *
 * Minimal on purpose: the tab strip lives entirely in the browser (see
 * src/client/). The only host-side duty is the git-branch lookup the chips'
 * hover bubbles ask for — the browser cannot run git, so one read-only exact
 * route answers "which branch is checked out in each of these directories?".
 *
 * Route design (ported from dsh-workspace-plus, MIT © KannaKuron/lsdt45):
 *  - `POST /dsh-itab/git-branch` { paths: string[] } → { ok, branches }
 *  - "not a repository" is a normal no-answer (path omitted), never an error;
 *  - a short TTL cache keeps repeat hovers from spawning git children while a
 *    checkout still becomes visible within ~20s;
 *  - every path is independent: one unreadable directory never fails the rest;
 *  - a fixed worker pool bounds concurrent git children per request;
 *  - same-origin JSON only, 64 KiB body cap, absolute paths only.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, posix, win32 } from 'node:path'

/** Plugin identity in cordis logs (deliberately not the package name). */
export const name = 'dsh-itab'

/* ---------------------------- git branch probe ---------------------------- */

/** Exact route the client half calls (and probes with GET → 405). */
export const GIT_BRANCH_ROUTE = '/dsh-itab/git-branch'

/** Hard ceiling on paths per request: the client only asks about its workspaces. */
const MAX_PATHS = 200
/** Longer strings are not plausible directory paths and are dropped unread. */
const MAX_PATH_LENGTH = 4096
/** git must answer inside this window, or the path counts as "no branch". */
const GIT_TIMEOUT_MS = 3_000
/** Concurrent git children per request: enough to hide latency, bounded. */
const DEFAULT_CONCURRENCY = 4
/** How long one answer (including "no branch") is reused. */
const DEFAULT_TTL_MS = 20_000
/** Cache ceiling so a long-lived host stays bounded. */
const DEFAULT_MAX_ENTRIES = 256
/** Request body cap: a branch probe is tiny, so anything bigger is noise. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Reduce `git symbolic-ref --short HEAD` output to a branch name: only the
 * first non-empty line counts, and the detached-HEAD placeholder ("HEAD")
 * must never come back as a branch called HEAD.
 */
export function parseBranchName(stdout) {
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    return trimmed === 'HEAD' ? '' : trimmed
  }
  return ''
}

/**
 * The branch checked out in `directory`, or '' when it has none.
 *
 * Never rejects: a directory outside any repository, a detached HEAD, a broken
 * git installation, a timeout and an invalid argument are all the same answer.
 * `-q` turns the detached-HEAD failure into a silent exit; GIT_OPTIONAL_LOCKS
 * keeps a read from taking the index lock; GIT_TERMINAL_PROMPT guarantees git
 * can never block waiting for credentials; `-C` carries the directory as one
 * argv entry, so no shell quoting is involved anywhere.
 */
export function readGitBranch(directory) {
  return new Promise((resolve) => {
    try {
      execFile(
        'git',
        ['-C', directory, 'symbolic-ref', '--short', '-q', 'HEAD'],
        {
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
          // A branch name is tiny; cap the buffer so a misbehaving git cannot
          // grow it without keeping the route waiting.
          maxBuffer: 64 * 1024,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
        },
        (error, stdout) => { resolve(error ? '' : parseBranchName(stdout)) },
      )
    } catch {
      // execFile can throw synchronously for an invalid argument shape; that
      // is still just "no branch", never a rejected route.
      resolve('')
    }
  })
}

/** Keep only plausible directory paths, deduplicated, in request order. */
function normalizePaths(paths) {
  if (!Array.isArray(paths)) return []
  const seen = new Set()
  const directories = []
  for (const candidate of paths) {
    if (directories.length >= MAX_PATHS) break
    if (typeof candidate !== 'string') continue
    if (candidate.length === 0 || candidate.length > MAX_PATH_LENGTH) continue
    if (!isAbsolute(candidate)) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    directories.push(candidate)
  }
  return directories
}

/** One cached answer; `branch` is '' for "no branch" too, so negatives age out. */
function CacheEntry(branch, expiresAt) {
  this.branch = branch
  this.expiresAt = expiresAt
}

/** The reusable probe behind the route (unit tests inject the probes + clock). */
export function createBranchResolver(options = {}) {
  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS)
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const readBranch = options.readBranch ?? readGitBranch
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  /** Insertion order doubles as the eviction queue (oldest first). */
  const cache = new Map()

  const cachedBranch = (directory) => {
    const entry = cache.get(directory)
    if (entry === undefined) return undefined
    if (now() >= entry.expiresAt) {
      cache.delete(directory)
      return undefined
    }
    return entry.branch
  }

  const remember = (directory, branch) => {
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next()
      if (oldest.done === true) break
      cache.delete(oldest.value)
    }
    cache.set(directory, new CacheEntry(branch, now() + ttlMs))
  }

  /** Resolve one path, turning every failure into "no branch" for that path. */
  const probe = async (directory) => {
    const hit = cachedBranch(directory)
    if (hit !== undefined) return hit
    let branch = ''
    try {
      if (await isDirectory(directory)) branch = await readBranch(directory)
    } catch {
      // A probe that throws is exactly the "no answer" case; it must not fail
      // the other paths in the same request.
      branch = ''
    }
    remember(directory, branch)
    return branch
  }

  return {
    async resolve(paths) {
      const directories = normalizePaths(paths)
      const branches = {}
      // A fixed worker pool rather than Promise.all: 200 paths must not spawn
      // 200 git children at once on the host.
      let next = 0
      const worker = async () => {
        while (next < directories.length) {
          const directory = directories[next]
          next += 1
          const branch = await probe(directory)
          if (branch !== '') branches[directory] = branch
        }
      }
      const workers = []
      for (let index = 0; index < Math.min(concurrency, directories.length); index += 1) {
        workers.push(worker())
      }
      await Promise.all(workers)
      return branches
    },
  }
}

/** The default directory probe: anything unreadable is simply not a directory. */
async function defaultIsDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
}

/* ------------------------------ open in VS Code ------------------------------ */

/** Exact route the client half calls (probed with GET → 405 like git-branch). */
export const OPEN_VSCODE_ROUTE = '/dsh-itab/open-in-vscode'

/** The `code` CLI hands off to the GUI and exits; 10s is a generous bound. */
const VSCODE_TIMEOUT_MS = 10_000

/**
 * Ordered CLI candidates per platform. GUI-launched hosts inherit a minimal
 * PATH (no shell profile), so every well-known install location comes before
 * the bare `code` name, which only resolves when PATH already carries it.
 * Windows ships two installer layouts (per-user LOCALAPPDATA, per-machine
 * ProgramFiles); `code` there is a .cmd shim that cmd.exe must interpret.
 */
export function vscodeCandidates(platform, env) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ? env.LOCALAPPDATA + '\\Programs\\Microsoft VS Code\\bin\\code.cmd' : ''
    const machine = env.ProgramFiles ? env.ProgramFiles + '\\Microsoft VS Code\\bin\\code.cmd' : ''
    return [local, machine, 'code'].filter(Boolean)
  }
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin/code', // Apple Silicon brew
      '/usr/local/bin/code', // Intel brew + the "Install code in PATH" symlink
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', // bundled CLI
      'code',
    ]
  }
  return ['/usr/bin/code', '/usr/bin/code-oss', '/snap/bin/code', '/usr/local/bin/code', 'code']
}

/**
 * Assemble the spawn for one candidate. darwin/linux is a plain execFile-style
 * spawn; win32 routes through cmd.exe because Node (CVE-2024-27980) refuses
 * to exec .cmd shims directly and because bare `code` needs PATHEXT lookup.
 * The `/d /s /c "…"` + windowsVerbatimArguments recipe passes BOTH paths as
 * one pre-quoted verbatim line, so spaces survive and nothing is re-parsed.
 */
export function buildOpenCommand(platform, env, candidate, directory) {
  if (platform === 'win32') {
    const shell = env.comspec || env.ComSpec || 'cmd.exe'
    return {
      file: shell,
      args: ['/d', '/s', '/c', '"' + candidate + '" "' + directory + '"'],
      options: { windowsVerbatimArguments: true, stdio: 'ignore' },
    }
  }
  return { file: candidate, args: [directory], options: { stdio: 'ignore' } }
}

/** Resolve the first candidate that exists on disk; a bare name is the PATH gamble. */
function resolveVscodeCandidate(candidates, exists) {
  for (const candidate of candidates) {
    // Only absolute candidates can be probed; the bare name defers to PATH.
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (exists(candidate)) return candidate
    } else {
      return candidate
    }
  }
  return ''
}

let cachedVscode = null

/** Absolute-path check honouring the TARGET platform (a D:\ path is valid on win32, not on posix). */
function absoluteOn(platform, value) {
  return platform === 'win32' ? win32.isAbsolute(value) : posix.isAbsolute(value)
}

/**
 * Open a directory in VS Code. Every failure (missing editor, non-zero exit,
 * timeout, unreadable path) folds into `false`; the route layer maps that to
 * an ok:false envelope so the menu action needs no error surface.
 */
export async function openInVscode(directory, deps = {}) {
  const platform = deps.platform || process.platform
  const env = deps.env || process.env
  const exists = deps.exists || existsSync
  const spawnFn = deps.spawn || spawn
  const isDirectory = deps.isDirectory || defaultIsDirectory
  const target = typeof directory === 'string' ? directory.trim() : ''
  if (target === '' || !absoluteOn(platform, target)) return false
  if (!(await isDirectory(target))) return false

  let candidate
  if (cachedVscode && cachedVscode.platform === platform && cachedVscode.candidate) {
    candidate = cachedVscode.candidate
  } else {
    candidate = resolveVscodeCandidate(vscodeCandidates(platform, env), exists)
    cachedVscode = { platform, candidate }
  }
  if (candidate === '') return false

  const command = buildOpenCommand(platform, env, candidate, target)
  return new Promise((resolve) => {
    let settled = false
    const done = (result) => { if (!settled) { settled = true; resolve(result) } }
    let child
    try {
      child = spawnFn(command.file, command.args, command.options)
    } catch {
      done(false)
      return
    }
    const timer = setTimeout(() => {
      if (child && typeof child.kill === 'function') child.kill()
      done(false)
    }, VSCODE_TIMEOUT_MS)
    child.on('error', () => { clearTimeout(timer); done(false) })
    child.on('close', (code) => { clearTimeout(timer); done(code === 0) })
  })
}

/* ------------------------------ route helpers ------------------------------ */

function respond(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = ''
    request.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('request body too large'))
      }
    })
    request.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { reject(new Error('invalid JSON body')) }
    })
    request.on('error', reject)
  })
}

/** The route is same-origin JSON only: a cross-origin page must not probe git. */
function isSameOriginJsonRequest(request) {
  const contentType = request.headers?.['content-type'] || ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { ok: false, status: 415, error: 'unsupported-media-type' }
  const origin = request.headers?.origin
  const host = request.headers?.host
  if (origin && host) {
    let sameOrigin = false
    try { sameOrigin = new URL(origin).host === host } catch { /* malformed origin falls through */ }
    if (!sameOrigin) return { ok: false, status: 403, error: 'cross-origin-request' }
  }
  return { ok: true }
}

/** Register the exact git-branch route; returns its disposer. */
function registerGitBranchRoute(ctx) {
  const resolver = createBranchResolver()
  return ctx.webServer.register({
    kind: 'exact',
    path: GIT_BRANCH_ROUTE,
    handler: async (request, response) => {
      // The client probes availability with GET and expects exactly this 405.
      if (request.method !== 'POST') return respond(response, 405, { ok: false, error: 'method-not-allowed' })
      const validation = isSameOriginJsonRequest(request)
      if (!validation.ok) return respond(response, validation.status, { ok: false, error: validation.error })
      let body
      try { body = await readJsonBody(request) } catch { return respond(response, 400, { ok: false, error: 'bad-request' }) }
      try {
        return respond(response, 200, { ok: true, branches: await resolver.resolve(body?.paths) })
      } catch (error) {
        if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[dsh-itab] failed to resolve git branches:', error)
        respond(response, 500, { ok: false, error: 'branch-resolve-failed' })
      }
    },
  })
}

/** Register the exact open-in-vscode route; returns its disposer. */
function registerOpenEditorRoute(ctx) {
  return ctx.webServer.register({
    kind: 'exact',
    path: OPEN_VSCODE_ROUTE,
    handler: async (request, response) => {
      if (request.method !== 'POST') return respond(response, 405, { ok: false, error: 'method-not-allowed' })
      const validation = isSameOriginJsonRequest(request)
      if (!validation.ok) return respond(response, validation.status, { ok: false, error: validation.error })
      let body
      try { body = await readJsonBody(request) } catch { return respond(response, 400, { ok: false, error: 'bad-request' }) }
      const opened = await openInVscode(typeof body?.path === 'string' ? body.path : '')
      if (opened) return respond(response, 200, { ok: true, value: { opened: true } })
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[dsh-itab] open-in-vscode failed for', body?.path)
      return respond(response, 200, { ok: false, error: 'open-failed' })
    },
  })
}

/* --------------------------------- plugin --------------------------------- */

export function apply(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return
  // Git branch lookup for the chips' hover bubbles. Read-only and
  // webServer-only: a host without git (or a workspace outside any repo)
  // degrades to an empty map instead of refusing to load the plugin.
  ctx.inject(['webServer'], (sctx) => {
    const disposers = [
      registerGitBranchRoute(sctx),
      registerOpenEditorRoute(sctx),
    ]
    const dispose = () => { for (const run of disposers) run() }
    if (typeof sctx.effect === 'function') sctx.effect(() => dispose, 'dsh-itab host routes')
    return dispose
  })
}
