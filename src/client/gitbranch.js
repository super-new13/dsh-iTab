/**
 * Per-directory git branch cache + fetch + React binding (ported from
 * dsh-workspace-plus git-branch.ts / ui/branch.ts, MIT © KannaKuron/lsdt45).
 *
 * The chip bubble's meta line is derived at render time, so its branch
 * segment must be readable synchronously: this module keeps the last known
 * answer per directory and lets the UI subscribe for changes (the fetch
 * happens from the bubble's onShow / the hook's effect, never from render).
 *
 * Requests are shaped for a hover burst, not a single chip: every ensure()
 * call in the same microtask lands in ONE batch, paths already answered
 * inside the TTL and paths already in flight are skipped, and a host that
 * fails gets a short cooldown instead of a request on every hover. A host
 * half without the route is remembered forever — retrying a route that is
 * not mounted cannot succeed.
 *
 * Bundle note: no import statements — P is the shared platform binding that
 * platform.js installs earlier in the concatenated client bundle; P is only
 * touched inside useGitBranch, so importing this file as a real ESM module
 * for unit tests (the cache is pure) is safe.
 */

/** Route the host half serves (see src/index.js). */
export const GIT_BRANCH_ROUTE = '/dsh-itab/git-branch'

/** A host without the route: permanent, no request is ever attempted again. */
export function GitBranchRouteUnavailable(message) {
  const error = new Error(message)
  error.name = 'GitBranchRouteUnavailable'
  Object.setPrototypeOf(error, GitBranchRouteUnavailable.prototype)
  return error
}
GitBranchRouteUnavailable.prototype = Object.create(Error.prototype)

/**
 * A branch value as the cache keeps it: trimmed, and never the detached
 * placeholder. `git symbolic-ref` has no branch name on a detached work tree;
 * that must not be shown as one.
 */
export const normalizeGitBranch = (value) => {
  const branch = String(value === null || value === undefined ? '' : value).trim()
  return branch === 'HEAD' ? '' : branch
}

/** How long a stored answer is reused before a hover may refresh it. */
export const BRANCH_TTL_MS = 30_000

/** How long the cache stays quiet after a failed request. */
export const BRANCH_FAIL_COOLDOWN_MS = 30_000

/**
 * Only absolute paths are sent: the host resolves them on its own filesystem,
 * so a relative path would resolve against the host's working directory.
 */
const isAbsolutePath = (path) =>
  path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

/** POST one batch of absolute directories to the host route. */
export async function requestGitBranches(paths) {
  let response
  try {
    response = await fetch(GIT_BRANCH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
  } catch (reason) {
    // A transport error says nothing about the route existing: the cache
    // retries after its cooldown.
    throw new Error('git-branch request failed: ' + (reason && reason.message ? reason.message : String(reason)))
  }
  if (response.status === 404 || response.status === 405) {
    throw GitBranchRouteUnavailable('git-branch route missing (HTTP ' + response.status + ')')
  }
  const payload = await response.json().catch(() => null)
  // A mounted exact route always answers JSON; anything else is some other
  // server answering for this path.
  if (!payload || typeof payload !== 'object') {
    throw GitBranchRouteUnavailable('git-branch route answered non-JSON (HTTP ' + response.status + ')')
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error('git-branch request failed (HTTP ' + response.status + ')')
  }
  const branches = payload.branches
  return branches && typeof branches === 'object' ? branches : {}
}

/** One remembered answer; `at` is the clock reading when it landed. */
function BranchEntry(branch, at) {
  this.branch = branch
  this.at = at
}

/**
 * Create a branch cache (unit tests inject fetchBranches/now/ttl).
 *
 * Only one request is in flight per flush; the map records every requested
 * path — a directory that is not a git work tree is remembered as "no
 * branch" so hovering it again does not re-ask within the TTL.
 */
export function createBranchCache(options) {
  const opts = options || {}
  const fetchBranches = opts.fetchBranches
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : BRANCH_TTL_MS
  const failCooldownMs = typeof opts.failCooldownMs === 'number' ? opts.failCooldownMs : BRANCH_FAIL_COOLDOWN_MS
  const entries = new Map()
  const inFlight = new Set()
  const listeners = new Set()
  /** Paths collected for the next microtask batch. */
  const queued = new Set()
  let flushScheduled = false
  /** The route is not mounted: no request is ever attempted again. */
  let disabled = false
  /** Epoch until which a failed request suppresses new ones. */
  let cooldownUntil = 0

  if (typeof fetchBranches !== 'function') throw new Error('createBranchCache: fetchBranches is required')

  const notify = () => {
    for (const listener of Array.from(listeners)) listener()
  }

  /** Fold one batch's answer into the cache and wake every subscriber. */
  const applyBatch = (batch, branches) => {
    const at = now()
    for (const path of batch) {
      // A path the host omitted is not a git work tree (or it refused the
      // lookup): remembering it as empty keeps it quiet for the TTL.
      const branch = branches && typeof branches === 'object' ? normalizeGitBranch(branches[path]) : ''
      entries.set(path, new BranchEntry(branch, at))
    }
    cooldownUntil = 0
    notify()
  }

  /** Send the queued batch; failures only move the cooldown, never throw. */
  const flush = () => {
    flushScheduled = false
    if (queued.size === 0) return
    const batch = Array.from(queued)
    queued.clear()
    for (const path of batch) inFlight.add(path)
    fetchBranches(batch).then(
      (branches) => {
        for (const path of batch) inFlight.delete(path)
        applyBatch(batch, branches)
      },
      (reason) => {
        for (const path of batch) inFlight.delete(path)
        if (reason && reason.name === 'GitBranchRouteUnavailable') disabled = true
        else cooldownUntil = now() + failCooldownMs
      },
    )
  }

  const ensure = (paths) => {
    if (disabled) return
    const at = now()
    if (at < cooldownUntil) return
    for (const value of paths) {
      const path = typeof value === 'string' ? value.trim() : ''
      if (path === '' || !isAbsolutePath(path)) continue
      if (inFlight.has(path) || queued.has(path)) continue
      const entry = entries.get(path)
      if (entry && at - entry.at < ttlMs) continue
      queued.add(path)
    }
    if (queued.size === 0 || flushScheduled) return
    flushScheduled = true
    // One microtask hop is the whole batching window: a hover burst across
    // chips (and their mount effects) reaches the host as a single request.
    queueMicrotask(flush)
  }

  const branchOf = (path) => {
    const key = typeof path === 'string' ? path.trim() : ''
    if (key === '') return ''
    const entry = entries.get(key)
    return entry ? entry.branch : ''
  }

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  return { branchOf, ensure, subscribe }
}

/** The page-wide cache every chip shares (one batch per hover burst). */
export const branchCache = createBranchCache({ fetchBranches: requestGitBranches })

/**
 * Current git branch of one project directory, '' while unknown (or when the
 * directory is not a git work tree / the route is unavailable).
 *
 * Kept to useState/useEffect: reads the cache during render (a pure map
 * lookup) and asks for the directory's branch from an effect — never while
 * rendering.
 */
export function useGitBranch(cwd) {
  const React = P.React
  const path = typeof cwd === 'string' ? cwd.trim() : ''
  const [branch, setBranch] = React.useState(() => (path === '' ? '' : branchCache.branchOf(path)))
  React.useEffect(() => {
    if (path === '') {
      setBranch((previous) => (previous === '' ? previous : ''))
      return undefined
    }
    const read = () => {
      const next = branchCache.branchOf(path)
      setBranch((previous) => (previous === next ? previous : next))
    }
    // Adopt an answer the cache already has (another chip fetched it) before
    // the subscription starts, so the first paint of a subscriber is current.
    read()
    const unsubscribe = branchCache.subscribe(read)
    branchCache.ensure([path])
    return unsubscribe
  }, [path])
  return branch
}

/* ===================== reveal project folder ===================== */

/**
 * The shell's own client→host RPC that opens a directory in the OS file
 * manager (Finder / Explorer). Mirrors the reference plugin's envelope
 * byte-for-byte so the stock host route accepts it; kept as a pure builder
 * for unit tests.
 */
export function openWorkspacePathEnvelope(path, rpcId) {
  return {
    type: 'client-request',
    rpcId,
    method: 'session/openWorkspacePath',
    payload: { args: { request: { path } } },
  }
}

/**
 * Fire-and-forget reveal: resolves true only when the host confirms it
 * actually opened the directory. Never rejects — a menu action has no error
 * surface, so every failure path folds into `false`.
 */
export async function revealProjectFolder(path) {
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return false
  const rpcId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  let response
  try {
    response = await fetch('/api/session/openWorkspacePath', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(openWorkspacePathEnvelope(target, rpcId)),
    })
  } catch {
    return false
  }
  if (!response.ok) return false
  const envelope = await response.json().catch(() => null)
  const result = envelope && envelope.result
  return !!(result && result.ok === true && result.value && result.value.opened === true)
}

/* ===================== open project in VS Code ===================== */

/**
 * POST { path } → { ok, value: { opened } }. Boolean fold like the reveal
 * helper: a menu action has no error surface, every failure is `false`.
 */
export async function openProjectInVscode(path) {
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return false
  let response
  try {
    response = await fetch('/dsh-itab/open-in-vscode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
  } catch {
    return false
  }
  if (!response.ok) return false
  const payload = await response.json().catch(() => null)
  return !!(payload && payload.ok === true && payload.value && payload.value.opened === true)
}
