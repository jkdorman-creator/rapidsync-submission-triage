// Dumps the text PDF.js actually produces for each attachment, so the hosted
// preview can ship byte-identical extraction output without shipping PDF.js.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve('.');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  const t = new Map();
  document.modelContext = {
    async registerTool(x) { t.set(x.name, x); },
    async getTools() { return [...t.values()]; },
    async executeTool(n, i) { return t.get(n).execute(i || {}, { signal: new AbortController().signal }); },
    addEventListener() {},
  };
});
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const out = {};
for (const [sub, atts] of [['SUB-4471', ['ATT-4471-A', 'ATT-4471-B']],
                           ['SUB-4489', ['ATT-4489-A']],
                           ['SUB-4502', ['ATT-4502-A', 'ATT-4502-B']]]) {
  await page.evaluate(id => document.modelContext.executeTool('open_submission', { submission_id: id }), sub);
  for (const att of atts) {
    out[att] = await page.evaluate(id => window.__extractForBuild(id), att);
  }
}
fs.writeFileSync('test/extracted-text.json', JSON.stringify(out, null, 2));
await browser.close(); server.close();
console.log('dumped', Object.keys(out).length, 'documents');
