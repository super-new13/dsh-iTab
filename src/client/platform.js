/* dsh-iTab — platform boundary.
 *
 * The client bundle is loaded by the DSH module loader, which hands its
 * factory a `require` whose module table holds the DSH client baseline
 * (react, the store kit, ui primitives; see @deepseek-ai/dsh-client-web
 * seed.ts). Every binding the bundle needs is captured here, once, at
 * factory start — before any component or class that touches it is
 * defined (a class heritage evaluates at definition time, so a
 * module-level `class extends React.Component` would see a null React).
 */
const P = { React: null, E: null, storeKit: null }

function installPlatform(hostRequire) {
  P.React = hostRequire('react')
  P.E = P.React.createElement
  try {
    P.storeKit = hostRequire('@deepseek-ai/dsh-client-store')
  } catch {
    P.storeKit = null
  }
}
