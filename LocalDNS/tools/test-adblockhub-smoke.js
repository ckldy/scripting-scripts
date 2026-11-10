const fs = require('fs');
const vm = require('vm');

const P = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js';
const code = fs.readFileSync(P, 'utf8');

class FakeEventTarget {
  addEventListener() {}
  removeEventListener() {}
}
class FakeAnchor extends FakeEventTarget {
  constructor() { super(); this.href = 'https://example.com/'; }
  click() {}
}
function makeResponse() {}
makeResponse.prototype.json = function () { return Promise.resolve({}); };
makeResponse.prototype.text = function () { return Promise.resolve('{}'); };

const doc = {
  readyState: 'complete',
  head: null,
  documentElement: { appendChild() {} },
  body: null,
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { id: '', textContent: '', appendChild() {}, setAttribute() {} }; },
  addEventListener() {},
  removeEventListener() {},
};
doc.head = doc.documentElement;

const sandbox = {
  console,
  location: { hostname: 'news.example.com', href: 'https://news.example.com/a' },
  navigator: { userActivation: { isActive: false, hasBeenActive: false } },
  document: doc,
  EventTarget: FakeEventTarget,
  HTMLAnchorElement: FakeAnchor,
  Response: makeResponse,
  MutationObserver: class { observe() {} disconnect() {} },
  setInterval() { return 1; },
  setTimeout() { return 1; },
  clearInterval() {},
  URL,
  JSON,
  Object,
  Array,
  Math,
  String,
  Date,
  Promise,
  localStorage: { setItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.open = () => null;

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { timeout: 5000, filename: 'AdBlockHub.user.js' });
  console.log('TOP-LEVEL OK');
  console.log('blocked normal:', sandbox.isBlockedPopup ? sandbox.isBlockedPopup('https://example.com/x') : 'n/a');
} catch (e) {
  console.log('TOP-LEVEL ERROR:', e.message);
  process.exit(1);
}
