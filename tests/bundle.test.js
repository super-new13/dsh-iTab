/* Bundle smoke test: runs the GENERATED bundle in a fresh vm context
 * with stubbed loader/require, drives the factory, and verifies the
 * plugin object, both seat registrations, and that the seats render
 * without throwing on minimal props. Run `npm run build` first — the
 * test reads src/client.bundle.js. */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert'
import vm from 'node:vm'

const bundle = readFileSync(new URL('../src/client.bundle.js', import.meta.url), 'utf8')

function makeEnv() {
  const seats = []
  const window = {
    __ModuleLoader__: {
      load(candidate) { window.__registration = candidate },
    },
  }
  const ReactStub = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    Component: class Component { constructor(props) { this.props = props } },
  }
  const storeStub = {
    defineStore(options) {
      const state = options.init()
      return {
        useStore(selector) { return selector ? selector(state) : state },
        actions: options.actions,
      }
    },
  }
  const requireStub = (spec) => {
    if (spec === 'react') return ReactStub
    if (spec === '@deepseek-ai/dsh-client-store') return storeStub
    throw new Error('unexpected require: ' + spec)
  }
  const slots = {
    inject(name, injector) { seats.push({ name, injector }) },
    register(options, render) { return { options, render } },
  }
  return { window, requireStub, slots, seats }
}

test('bundle wraps the module-loader registration', () => {
  assert.match(bundle, /window\.__ModuleLoader__\.load\(/)
  assert.match(bundle, /id: 'dsh-itab'/)
  assert.doesNotMatch(bundle, /^export /m)
})

test('factory produces the cordis plugin and registers both seats', () => {
  const env = makeEnv()
  vm.runInNewContext(bundle, { window: env.window, console })
  const registration = env.window.__registration
  assert.equal(registration.id, 'dsh-itab')
  assert.equal(typeof registration.factory, 'function')

  const plugin = registration.factory(env.requireStub)
  assert.equal(plugin.name, 'dsh-itab')
  assert.deepEqual(plugin.inject, ['slots', 'sessions', 'workspaces', 'locale', 'uiWorkspace'])
  assert.equal(typeof plugin.apply, 'function')

  const ctx = {
    get: (name) => (name === 'slots' ? env.slots : undefined),
    effect: () => () => {},
    locale: { register: () => () => {} },
  }
  plugin.apply(ctx)
  const names = env.seats.map((seat) => seat.injector && seat.name && seat).filter(Boolean).map((seat) => seat.name)
  assert.ok(names.indexOf('conversation.header.leading') >= 0, 'header seat registered')
  assert.ok(names.indexOf('plugins.bundle.config') >= 0, 'config seat registered')

  // Each guarded injector returns a registration whose render is a
  // quiet-boundary wrapper.
  for (const seat of env.seats) {
    const registrationForSeat = seat.injector()
    assert.ok(registrationForSeat, 'seat ' + seat.name + ' registered')
    assert.equal(typeof registrationForSeat.render, 'function')
  }

  // The header seat renders the strip inside the quiet boundary (the
  // stub createElement builds trees without instantiating the class, so
  // the assertion checks the wiring, not React's bail-outs).
  const headerSeat = env.seats.find((seat) => seat.name === 'conversation.header.leading')
  const strip = headerSeat.injector()
  const t = (key) => key
  const rendered = strip.render({ t, useSessions: () => null, newSession: () => {} })
  assert.ok(rendered, 'strip seat renders')
  assert.equal(rendered.children[0].type.name, 'TabsStrip')
  assert.equal(rendered.children[0].props.t, t)

  // The config seat renders the settings page for view 'page' and the
  // summary view bails inside the component (stub shows the wiring).
  const configSeat = env.seats.find((seat) => seat.name === 'plugins.bundle.config')
  const page = configSeat.injector()
  const configSummary = page.render({ view: 'summary', t })
  assert.equal(configSummary.children[0].type.name, 'ItabBundleConfig')
  assert.equal(configSummary.children[0].props.view, 'summary')
  const config = page.render({ view: 'page', useStore: (selector) => selector({ prefs: {} }), actions: { setPref: () => {} }, t })
  assert.equal(config.children[0].props.view, 'page')
})
