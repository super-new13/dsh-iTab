/* dsh-iTab — client entry tail.
 *
 * The factory body this file ends (see scripts/build.mjs) starts here:
 * capture the platform bindings FIRST, then build the cordis plugin the
 * loader receives back.
 *
 * Two seats, both wrapped in the quiet boundary so one failing
 * registration degrades only itself:
 *  - conversation.header.leading: the tab strip (root-scoped free seat
 *    at the left of the conversation header band).
 *  - plugins.bundle.config: this bundle's page under Settings → Plugins,
 *    keyed by the package name.
 * The store kit is optional: without it the strip still runs on
 * defaults, and the config page simply does not register. */
installPlatform(require)

function createItabPlugin() {
  function apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots || typeof slots.inject !== 'function') return
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    const uiWorkspace = ctx.get('uiWorkspace')

    if (ctx.locale && typeof ctx.locale.register === 'function') {
      ctx.effect(() => {
        try {
          return ctx.locale.register(NS, { zh, en })
        } catch (localeError) {
          console.warn('[dsh-itab] dictionary registration failed', localeError)
          return () => {}
        }
      }, 'itab: dictionaries')
    }

    const QuietBoundary = createQuietBoundary()
    const guarded = (slotKey, options, component) => () => {
      try {
        return slots.register(options, (props) => P.E(QuietBoundary, null, P.E(component, props)))
      } catch (registerError) {
        console.warn('[dsh-itab] register skipped for ' + slotKey, registerError)
        return undefined
      }
    }

    const viewStore = createViewStore()

    const openSessionCompat = (sessionId) => {
      if (uiWorkspace && typeof uiWorkspace.openSession === 'function') return uiWorkspace.openSession(sessionId)
      if (sessions && typeof sessions.open === 'function') return sessions.open(sessionId)
      return undefined
    }
    // The same entry point the workspace "+" and Ctrl+N use: no workspace
    // id, the shell targets the current workspace else the most recent.
    const newSession = () => {
      if (uiWorkspace && typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession()
    }
    // Chrome's "Duplicate tab": fork the session (a copy with a derived
    // title) and open it. The sessions service carries fork on installs the
    // sidebar also uses; a host without it simply greys the menu item out.
    const forkSession = (sessionId) => {
      if (!sessions || typeof sessions.fork !== 'function') return undefined
      return Promise.resolve(sessions.fork({ sessionId, increaseTitle: true }))
        .then((childId) => { if (childId) openSessionCompat(childId); return childId })
        .catch(() => undefined)
    }

    // priority: lower wins the single-kind seat (a dynamic entry shadows a
    // shipped one by landing BELOW it; ties keep registration order). -1
    // puts this strip ahead of another tabs plugin that registers at the
    // default 0 — e.g. dsh-workspace-plus — without disabling its other
    // seats (its own strip simply never renders, and its styles only mount
    // with it, so the header band is fully ours).
    slots.inject('conversation.header.leading', guarded(
      'conversation.header.leading',
      {
        name: 'conversation.header.leading',
        priority: -1,
        locale: NS,
        store: viewStore || undefined,
        inject: () => ({ open: openSessionCompat, newSession, fork: forkSession }),
      },
      TabsStrip,
    ))

    if (viewStore) {
      slots.inject('plugins.bundle.config', guarded(
        'plugins.bundle.config',
        { name: 'plugins.bundle.config', key: 'dsh-itab', locale: NS, store: viewStore },
        ItabBundleConfig,
      ))
    }
  }

  return {
    name: 'dsh-itab',
    inject: ['slots', 'sessions', 'workspaces', 'locale', 'uiWorkspace'],
    apply,
  }
}
