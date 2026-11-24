/* dsh-iTab — stylesheet.
 *
 * Everything the bundle renders is styled here, scoped by the .itab-*
 * prefix. Header overrides (hiding the crumbs title, parking the
 * session chips over the view-nav row) are gated on
 * html:not([data-itab-off]) so the config page's master switch restores
 * the stock header exactly.
 *
 * Theming rides the shell's own CSS variables with literal fallbacks —
 * the same table the reference plugin proved on this shell.
 */
const ITAB_CSS = [
  /* ---- shell header overrides (only while the strip is enabled) ---- */
  'html:not([data-itab-off]) header[data-window-drag] [class*="_crumbs"]{display:none}',
  'html:not([data-itab-off]) header[data-window-drag]{position:relative}',
  'html:not([data-itab-off]) header[data-window-drag] [class*="_titleRow"]{z-index:7}',
  'html:not([data-itab-off]) header[data-window-drag] [class*="_tabs"]{-webkit-app-region:no-drag;app-region:no-drag}',
  'html:not([data-itab-off]) header[data-window-drag] [class*="_headerActions"]{position:absolute;left:auto;right:var(--itab-chips-right,12px);top:var(--itab-chips-top,auto);bottom:auto;margin:0;z-index:6;pointer-events:auto;-webkit-app-region:no-drag;app-region:no-drag}',
  'html:not([data-itab-off]) header[data-window-drag] [class*="_titleCluster"]{-webkit-mask-image:none;mask-image:none}',

  /* ---- the strip ---- */
  '.itab-tabbar{display:flex;align-items:center;gap:4px;min-width:0;max-width:70vw;-webkit-app-region:no-drag;app-region:no-drag}',
  /* min-width keeps room for two chips even if a measurement goes wrong: past
     that the strip scrolls with the wheel instead of squashing chips. */
  '.itab-strip{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:min(196px,100%);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-app-region:no-drag;app-region:no-drag}',
  '.itab-strip::-webkit-scrollbar{display:none}',
  '.itab-strip[data-itab-fade-right="1"]:not([data-itab-fade-left="1"]){-webkit-mask-image:linear-gradient(to left,transparent,#000 16px);mask-image:linear-gradient(to left,transparent,#000 16px)}',
  '.itab-strip[data-itab-fade-left="1"]:not([data-itab-fade-right="1"]){-webkit-mask-image:linear-gradient(to right,transparent,#000 16px);mask-image:linear-gradient(to right,transparent,#000 16px)}',
  '.itab-strip[data-itab-fade-left="1"][data-itab-fade-right="1"]{-webkit-mask-image:linear-gradient(to right,transparent,#000 16px,#000 calc(100% - 16px),transparent);mask-image:linear-gradient(to right,transparent,#000 16px,#000 calc(100% - 16px),transparent)}',
  /* Chips share the row exactly: (strip width / count) - gap, clamped to
     96px..--itab-tab-max. When every chip still fits at 96px nothing is cut
     off; when they do not, the strip scrolls with the wheel instead of
     shrinking chips below a readable width. */
  '.itab-tab{display:flex;align-items:center;gap:6px;flex:0 0 auto;box-sizing:border-box;width:clamp(96px,calc(100% / var(--itab-count,1) - 4px),var(--itab-tab-max,240px));min-width:96px;max-width:var(--itab-tab-max,240px);padding:6px 6px 6px 10px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary,#b8b8b8);background:transparent;white-space:nowrap;transition:background .12s ease,color .12s ease}',
  '.itab-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e6e6e6)}',
  '.itab-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6)}',
  '.itab-tab-dragging{opacity:.45}',
  '.itab-tab-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:18px}',
  '.itab-tab-active .itab-tab-label{font-weight:600}',
  '.itab-tab-close{flex:none;width:18px;height:18px;display:grid;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:.45}',
  '.itab-tab-close:hover{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));opacity:1}',
  '.itab-tab:hover .itab-tab-close,.itab-tab-active .itab-tab-close{opacity:.85}',
  '.itab-tab-dot{flex:none;width:6px;height:6px}',
  '.itab-state-dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%}',
  '.itab-new,.itab-more,.itab-history{flex:none;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8);cursor:pointer}',
  '.itab-new:hover,.itab-more:hover,.itab-history:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e6e6e6)}',
  '.itab-more-open,.itab-history-open{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e6e6e6)}',

  /* ---- menus (tab context menu + all-tabs panel share the surface) ---- */
  '.itab-menu-layer{position:fixed;inset:0;z-index:119;pointer-events:none;-webkit-app-region:no-drag;app-region:no-drag}',
  '.itab-menu-overlay{position:absolute;inset:0;pointer-events:auto}',
  '.itab-menu{position:fixed;z-index:120;display:flex;flex-direction:column;min-width:190px;max-width:min(340px,calc(100vw - 16px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,rgba(28,28,32,.92)));-webkit-backdrop-filter:var(--dsh-any-blur-card-panels,blur(12px) saturate(1.15));backdrop-filter:var(--dsh-any-blur-card-panels,blur(12px) saturate(1.15));box-shadow:0 8px 24px rgba(0,0,0,.35);outline:none;pointer-events:auto;-webkit-app-region:no-drag;app-region:no-drag}',
  '.itab-menu-item{display:flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border-radius:6px;border:0;background:transparent;width:100%;text-align:left;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12.5px;cursor:pointer;user-select:none;white-space:nowrap}',
  '.itab-menu-item:disabled{opacity:.4;cursor:default}',
  '.itab-menu-item:hover:not(:disabled),.itab-menu-item-cursor{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
  '.itab-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.3))}',
  '.itab-menu-head{flex:none;padding:4px 8px 5px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-quaternary,#8a8a8a);user-select:none}',
  '.itab-menu-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain}',
  '.itab-menu-row{display:flex;align-items:center;gap:8px;min-height:28px;padding:0 4px 0 8px;border-radius:6px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12.5px;cursor:pointer;user-select:none}',
  '.itab-menu-row:hover,.itab-menu-row-cursor{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
  '.itab-menu-row-active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8def) 12%,transparent)}',
  '.itab-menu-row-active .itab-menu-label{color:var(--dsw-alias-brand-primary,#5b8def);font-weight:600}',
  '.itab-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.itab-menu-dot{flex:none;width:6px;height:6px;border-radius:50%;background:transparent}',
  '.itab-menu-check{flex:none;display:grid;place-items:center;color:var(--dsw-alias-brand-primary,#5b8def)}',
  '.itab-menu-close{flex:none;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:.4}',
  '.itab-menu-row:hover .itab-menu-close,.itab-menu-row-cursor .itab-menu-close{opacity:1}',
  '.itab-menu-close:hover{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}',
  '.itab-menu-hint{flex:none;margin-top:4px;padding:5px 8px 3px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-size:11px;line-height:15px;color:var(--dsw-alias-label-quaternary,#8a8a8a);user-select:none;display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.itab-menu-empty{padding:14px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-quaternary,#8a8a8a)}',
  '.itab-menu-time{flex:none;font-size:11px;line-height:15px;color:var(--dsw-alias-label-quaternary,#8a8a8a)}',
  '.itab-menu-row-disabled{opacity:.45;cursor:default}',
  '.itab-menu-clear{padding:2px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-quaternary,#8a8a8a);font-size:11px;cursor:pointer;font-family:inherit}',
  '.itab-menu-clear:hover{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}',

  /* ---- config page (Settings → Plugins → dsh-iTab) ---- */
  '.itab-cfg{display:flex;flex-direction:column;gap:14px;padding:4px 0}',
  '.itab-cfg-row{display:flex;align-items:center;justify-content:space-between;gap:16px}',
  '.itab-cfg-main{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.itab-cfg-label{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6)}',
  '.itab-cfg-hint{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-quaternary,#8a8a8a)}',
  '.itab-switch{flex:none;position:relative;width:34px;height:20px;padding:0;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));cursor:pointer}',
  '.itab-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .12s ease}',
  '.itab-switch-on{background:var(--dsw-alias-brand-primary,#5b8def);border-color:transparent}',
  '.itab-switch-on::after{left:16px}',
  '.itab-seg{display:flex;gap:6px;flex-wrap:wrap}',
  '.itab-seg-btn{height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:12px;cursor:pointer;font-family:inherit}',
  '.itab-seg-btn:disabled{opacity:.45;cursor:default}',
  '.itab-seg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
  /* White text on the brand fill, hardcoded like the shell's own primary
   * buttons: a theme may define --dsw-alias-brand-text dark (the monochrome
   * light theme sets it to #0f1115, which is unreadable on the equally dark
   * brand fill). */
  '.itab-seg-btn-active{background:var(--dsw-alias-brand-primary,#5b8def);border-color:transparent;color:#fff;font-weight:600}',
  '.itab-seg-btn-active:hover{background:var(--dsw-alias-brand-primary,#5b8def)}',

  /* ---- hover bubble (ported from the reference's .bw-tip) ---- */
  '.itab-tip{display:inline-flex;align-items:center;gap:8px;position:fixed;z-index:100;width:max-content;max-width:50vw;padding:3px 7px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-tooltip-bg,rgba(24,24,28,.95));color:var(--dsw-static-neutral-bluish-00,#fff);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;animation:itab-tip-in 150ms var(--ds-ease-in-out,ease)}',
  '@keyframes itab-tip-in{from{opacity:0}}',
  '@media (prefers-reduced-motion:reduce){.itab-tip{animation:none}}',

  /* ---- status dot pulse (ported from the reference's .bw-pulse) ---- */
  '.itab-pulse{display:inline-flex;align-items:center;justify-content:center;animation:itab-breathe 1.8s ease-in-out infinite}',
  '@keyframes itab-breathe{0%,100%{filter:drop-shadow(0 0 1px var(--itab-pulse-color));opacity:.55}50%{filter:drop-shadow(0 0 6px var(--itab-pulse-color));opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.itab-pulse{animation:none}}',
].join('\n')

/** A <style> node rendered inside the strip's tree so the stylesheet's
 *  lifecycle follows the component's (no document.head surgery). */
function StyleNode() {
  return P.E('style', { key: 'itab-style' }, ITAB_CSS)
}
