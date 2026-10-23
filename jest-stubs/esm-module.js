// Stub for ESM-only packages that Jest cannot load through ts-jest.
//
// integration.manager.ts imports every social provider, so touching anything
// that depends on it drags in packages shipped as ESM. The unit tests here
// never execute those providers, so an empty stub is enough and keeps the test
// config from having to transform node_modules.
//
// Every property resolves to the same no-op constructor, because providers
// call some of these at module scope (`new SimplePool()`), not just at runtime.
function Stub() {}
Stub.prototype = {};

module.exports = new Proxy(Stub, {
  get: (target, prop) => {
    if (prop in target) {
      return target[prop];
    }
    return Stub;
  },
});
