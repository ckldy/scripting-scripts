const fs = require('fs');
const vm = require('vm');

const P = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-safari-extension/userscripts/AdBlockHub.user.js';
const src = fs.readFileSync(P, 'utf8');
const start = src.indexOf('const AD_HOST_SUFFIXES');
const end = src.indexOf('try {', src.indexOf('function isBlockedPopup'));
const snippet = src.slice(start, end);

const ctx = {
  location: { hostname: 'news.example.com', href: 'https://news.example.com/a' },
  URL,
  console,
};
vm.createContext(ctx);
vm.runInContext(snippet + '\n;this.__fn = isBlockedPopup;', ctx);
const fn = ctx.__fn;

const cases = [
  ['', false],
  ['about:blank', false],
  ['/relative/path', false],
  ['https://news.example.com/popup', false],
  ['https://www.google.com/search?q=chat', false],
  ['https://chat.openai.com/', false],
  ['https://example.com/affiliate/program', false],
  ['https://example.com/download?id=1&cid=2', false],
  ['https://example.com/clk/123', false],
  ['https://magsrv.com/x', true],
  ['https://a.realsrv.com/x', true],
  ['https://doubleclick.net/x', true],
  ['https://ads.example.com/?popunder=1', true],
  ['https://cdn.example.com/popunder/x', true],
];

let fail = 0;
for (const [url, expect] of cases) {
  const got = fn(url);
  const ok = got === expect;
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(url), '=>', got, 'expect', expect);
}
console.log(fail ? `${fail} failed` : 'ALL PASS');
process.exit(fail ? 1 : 0);
