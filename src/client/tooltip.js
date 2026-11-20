/**
 * Plugin-owned hover tooltip for the tab chips (ported from
 * dsh-workspace-plus ui/tooltip.ts, MIT © KannaKuron/lsdt45).
 *
 * Why not the host primitives Tooltip: that bubble is withdrawn from the
 * anchor's mouseleave alone; every hover exit the browser cannot attribute to
 * a connected anchor (a keyed reorder moving the hovered chip, the chip being
 * removed, the window losing focus) strands it until the same chip is hovered
 * again. This module derives visibility from the pointer's REAL position
 * against the anchor rect, so the bubble drops whenever the chip moves away,
 * the strip scrolls, the window blurs, the pointer presses elsewhere or
 * Escape is hit — and while open it re-fits to the chip, so it follows the
 * row instead of freezing at stale coordinates.
 *
 * Bundle note: no import statements — P is the shared platform binding that
 * platform.js installs earlier in the concatenated client bundle; the module
 * only touches P inside function bodies, so importing this file as a real
 * ESM module for unit tests (placeTip/pointInRect are pure) is safe.
 */

/** Viewport margin the bubble keeps on every edge. */
export const TIP_EDGE = 12

/** How often an open bubble re-checks the pointer against its anchor. */
const TIP_TICK_MS = 120

/** Inclusive containment test: a pointer exactly on an edge still counts as inside. */
export const pointInRect = (rect, point) => !!rect && !!point
  && point.x >= rect.left && point.x <= rect.right
  && point.y >= rect.top && point.y <= rect.bottom

/**
 * Place the bubble: chips ask for it directly under the strip (`prefer:
 * 'below'`), centred on the anchor, flipping above when the bottom lacks
 * room; both placements clamp to the viewport edge. `left`/`top` are the
 * bubble's top-left corner; the CSS adds no transform.
 */
export const placeTip = (anchor, size, viewport, gap = 8, prefer) => {
  if (prefer === 'below') {
    const below = anchor.bottom + gap
    const above = anchor.top - gap - size.height
    const fitsBelow = below + size.height <= viewport.height - TIP_EDGE
    const fitsAbove = above >= TIP_EDGE
    if (!fitsBelow && fitsAbove) {
      return { left: Math.max(TIP_EDGE, Math.min(anchor.left, viewport.width - TIP_EDGE - size.width)), top: above, side: 'top' }
    }
    const centred = anchor.left + anchor.width / 2 - size.width / 2
    const x = Math.max(TIP_EDGE, Math.min(centred, viewport.width - TIP_EDGE - size.width))
    return { left: x, top: Math.max(TIP_EDGE, below), side: 'bottom' }
  }
  const top = Math.max(TIP_EDGE, Math.min(
    anchor.top + anchor.height / 2 - size.height / 2,
    Math.max(TIP_EDGE, viewport.height - TIP_EDGE - size.height),
  ))
  const right = anchor.right + gap
  if (right + size.width <= viewport.width - TIP_EDGE) return { left: right, top, side: 'right' }
  const left = anchor.left - gap - size.width
  if (left >= TIP_EDGE) return { left, top, side: 'left' }
  const centred = anchor.left + anchor.width / 2 - size.width / 2
  const x = Math.max(TIP_EDGE, Math.min(centred, viewport.width - TIP_EDGE - size.width))
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.height
  const fitsBelow = below + size.height <= viewport.height - TIP_EDGE
  const fitsAbove = above >= TIP_EDGE
  const flipped = !fitsBelow && fitsAbove
  return { left: x, top: flipped ? above : below, side: flipped ? 'top' : 'bottom' }
}

/**
 * Hover tooltip state for one anchor element.
 *
 * @param options.label - bubble text, or a resolver evaluated only while the
 *   bubble is visible; null/undefined disables the tip.
 * @param options.delayMs - hover delay in ms; 0 shows immediately.
 * @param options.gap - anchor-to-bubble distance in px.
 * @param options.maxWidth - bubble width cap in px.
 * @param options.prefer - 'below' pins the bubble under the anchor (chips).
 * @param options.onShow - called once each time the bubble actually opens;
 *   the label resolver runs during render, so anything that fetches what the
 *   label shows (the git branch) hangs off this instead.
 * @returns { attach, bubble } — attach carries the anchor ref + enter/leave
 *   handlers; bubble is the element to render last (or null).
 */
export function useHoverTip(options) {
  const opts = options || {}
  const label = opts.label === undefined ? null : opts.label
  const delayMs = opts.delayMs === undefined ? 300 : opts.delayMs
  const gap = opts.gap === undefined ? 8 : opts.gap
  const maxWidth = opts.maxWidth === undefined ? 320 : opts.maxWidth
  const prefer = opts.prefer
  const onShow = opts.onShow
  const React = P.React
  const E = P.E
  const anchorRef = React.useRef(null)
  const pointerRef = React.useRef(null)
  const timerRef = React.useRef(null)
  const bubbleRef = React.useRef(null)
  // Arms the browser-hover predicate below on the first tick that sees it true.
  const hoverAwareRef = React.useRef(false)
  // Mirrors the open state for the event handlers (their closures are created
  // in an older render than the setAnchor that opened the bubble), so onShow
  // fires once per opening instead of once per show() call.
  const openRef = React.useRef(false)
  const [anchor, setAnchor] = React.useState(null)
  const [size, setSize] = React.useState(null)
  const open = anchor !== null

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const hide = () => {
    clearTimer()
    pointerRef.current = null
    openRef.current = false
    setAnchor(null)
    setSize(null)
  }
  const measure = () => {
    const el = anchorRef.current
    if (!el || el.isConnected === false) return null
    const rect = el.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  const show = () => {
    clearTimer()
    const rect = measure()
    if (!rect) return
    setAnchor(rect)
    if (openRef.current) return
    openRef.current = true
    if (typeof onShow === 'function') onShow()
  }
  const attach = {
    ref: anchorRef,
    onMouseEnter: (event) => {
      if (label === null) return
      pointerRef.current = { x: event.clientX, y: event.clientY }
      clearTimer()
      if (delayMs > 0) timerRef.current = setTimeout(() => { timerRef.current = null; show() }, delayMs)
      else show()
    },
    onMouseLeave: () => hide(),
  }

  // While open, the pointer's real position decides — never an exit event.
  // A chip that re-sorted away (insertBefore hands hover to the chip now
  // under the cursor with NO boundary event) keeps a bubble no event can
  // clear otherwise. Two independent predicates run on every tick and every
  // pointer move: the browser's own :hover state (authoritative) and the
  // recorded pointer position against the re-measured rect. The same pass
  // re-fits a chip that merely moved, so the bubble never freezes.
  React.useEffect(() => {
    if (!open) return undefined
    const step = () => {
      const el = anchorRef.current
      if (!el || el.isConnected === false) { hide(); return }
      if (typeof el.matches === 'function') {
        if (el.matches(':hover')) hoverAwareRef.current = true
        else if (hoverAwareRef.current) { hide(); return }
      }
      const point = pointerRef.current
      if (!point) { hide(); return }
      const rect = el.getBoundingClientRect()
      if (!pointInRect({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, point)) { hide(); return }
      setAnchor((prev) => (prev && prev.left === rect.left && prev.top === rect.top && prev.right === rect.right && prev.bottom === rect.bottom)
        ? prev
        : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })
    }
    const onMove = (event) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
      step()
    }
    const onKey = (event) => { if (event.key === 'Escape') hide() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') hide() }
    // A pointer that leaves the window (relatedTarget null) or the document
    // itself must not leave the bubble behind.
    const onWindowOut = (event) => { if (!event.relatedTarget) hide() }
    const passive = { capture: true, passive: true }
    const tick = setInterval(step, TIP_TICK_MS)
    document.addEventListener('pointermove', onMove, passive)
    document.addEventListener('mousemove', onMove, passive)
    document.addEventListener('scroll', step, passive)
    document.addEventListener('mouseout', onWindowOut, passive)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('pointercancel', hide, true)
    document.addEventListener('dragstart', hide, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('mouseleave', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearInterval(tick)
      document.removeEventListener('pointermove', onMove, passive)
      document.removeEventListener('mousemove', onMove, passive)
      document.removeEventListener('scroll', step, passive)
      document.removeEventListener('mouseout', onWindowOut, passive)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('pointercancel', hide, true)
      document.removeEventListener('dragstart', hide, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('mouseleave', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [open])

  // Measure the bubble once it is in the DOM; its size decides placement.
  React.useEffect(() => {
    if (!open) { setSize(null); return }
    const el = bubbleRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize((prev) => (prev && prev.width === rect.width && prev.height === rect.height) ? prev : { width: rect.width, height: rect.height })
  }, [open, anchor, label])

  const text = open && label !== null
    ? (typeof label === 'function' ? label() : String(label))
    : null
  let bubble = null
  if (text) {
    const placement = anchor && size
      ? placeTip(anchor, size, { width: window.innerWidth, height: window.innerHeight }, gap, prefer)
      : { left: 0, top: 0, side: 'bottom' }
    bubble = E('span', {
      ref: bubbleRef,
      className: 'itab-tip',
      'data-side': placement.side,
      role: 'tooltip',
      style: { left: placement.left, top: placement.top, visibility: size ? 'visible' : 'hidden', maxWidth },
    }, text)
  }
  return { attach, bubble }
}
