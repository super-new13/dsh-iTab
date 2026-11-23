/* dsh-iTab — session helpers and small shared components.
 *
 * The session projections mirror the shapes the shell's stores publish
 * (summaries keyed by id; mainView retention marks the session on
 * screen). All of them degrade to null/'' on missing data. */

/** The session currently on screen (mainView retention), if any. */
function currentSessionIdOf(list) {
  const byId = list && list.byId
  if (!byId) return null
  for (const summary of Object.values(byId)) {
    if (!summary || !summary.retainedBy) continue
    if ((summary.retainedBy.mainView || 0) > 0) return String(summary.id)
  }
  return null
}

/** Chip label: localized "New session" for blanks, else the title. */
function sessionTitleOf(summary, t) {
  if (!summary) return ''
  if (summary.blank) return t('session.new')
  return String(summary.displayTitle || summary.title || '')
}

/** Status classification shared by chips and menus. `subagents` is the
 *  count of running child sessions (shell sidebar parity: a parent whose
 *  subagents are still running shows ongoing even when it is idle). */
export function sessionStateOf(row, current) {
  if (!row) return null
  if (row.pending === 'approval' || row.pending === 'plan-review' || row.pending === 'question') return 'warning'
  if (row.running || (row.subagents || 0) > 0) return 'ongoing'
  if (row.completed && current !== true) return 'done'
  return null
}

const PULSE_COLORS = { warning: '#d29922', ongoing: '#ff9f45', done: '#3fb950' }

/** The status dot all three states render (same geometry as the
 *  spacer so idle and active chips align). `pulse` wraps the dot in a
 *  breathing glow keyed off the same colour table (config: 状态点脉冲). */
function StatusDot({ state, label, pulse }) {
  const dot = P.E('span', {
    className: 'itab-state-dot',
    role: label ? 'img' : undefined,
    'aria-label': label,
    style: { background: PULSE_COLORS[state] || PULSE_COLORS.ongoing },
  })
  if (pulse !== true) return dot
  return P.E('span', {
    className: 'itab-pulse',
    'aria-hidden': 'true',
    style: { '--itab-pulse-color': PULSE_COLORS[state] || PULSE_COLORS.ongoing },
  }, dot)
}

/* ------------------------------ icons -------------------------------- */

/** Lucide-style stroke icon (the reference shell's own icon recipe). */
function lucideSvg(size, className, paths) {
  return P.E('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', className,
  }, paths)
}

const PlusIcon = ({ size }) => lucideSvg(size, null, [P.E('path', { key: 'v', d: 'M12 5v14' }), P.E('path', { key: 'h', d: 'M5 12h14' })])
const ChevronDownIcon = ({ size }) => lucideSvg(size, null, [P.E('path', { key: 'c', d: 'm6 9 6 6 6-6' })])
const CheckIcon = ({ size }) => lucideSvg(size, null, [P.E('path', { key: 'k', d: 'M20 6 9 17l-5-5' })])
const ClockIcon = ({ size }) => lucideSvg(size, null, [
  P.E('circle', { key: 'f', cx: 12, cy: 12, r: 10 }),
  P.E('polyline', { key: 'h', points: '12 6 12 12 16 14' }),
])

/** Localized "x minutes ago" for history rows. */
function relativeTime(at, now, t) {
  const diff = Math.max(0, now - Number(at || 0))
  const MINUTE = 60e3
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  if (diff < MINUTE) return t('history.justNow')
  if (diff < HOUR) return t('history.minAgo', { n: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t('history.hourAgo', { n: Math.floor(diff / HOUR) })
  return t('history.dayAgo', { n: Math.floor(diff / DAY) })
}

/* --------------------------- error boundary --------------------------- */

/** Error boundary factory: the class heritage evaluates when DEFINED, so
 *  it must be created after installPlatform captured React. A failed
 *  seat degrades to empty instead of taking the header down. */
function createQuietBoundary() {
  const React = P.React
  return class Boundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { failed: false }
    }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    componentDidCatch(error, info) {
      console.error('[dsh-itab] render error (region degraded to empty)', String(error && error.message ? error.message : error), error && error.stack, info)
    }
    render() {
      return this.state.failed ? null : this.props.children
    }
  }
}

/** classnames helper. */
function cls() {
  const out = []
  for (const part of arguments) {
    if (!part) continue
    if (typeof part === 'string') out.push(part)
  }
  return out.join(' ')
}
