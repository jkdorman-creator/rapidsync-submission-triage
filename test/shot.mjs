import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve('.');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;
const STUB = () => {
  const t = new Map();
  document.modelContext = {
    async registerTool(x){ t.set(x.name, x); },
    async getTools(){ return [...t.values()]; },
    async executeTool(n,i){ return t.get(n).execute(i||{}, { signal: new AbortController().signal }); },
    addEventListener(){},
  };
  window.__tools = t;
};
const browser = await chromium.launch();
for (const scheme of ['light','dark']) {
  const page = await browser.newPage({ viewport:{ width:1560, height:1180 }, colorScheme: scheme, deviceScaleFactor: 2 });
  await page.addInitScript(STUB);
  await page.goto(base, { waitUntil:'networkidle' });
  await page.waitForTimeout(500);
  const call = (n,i) => page.evaluate(([n,i]) => document.modelContext.executeTool(n,i), [n,i]);
  await call('open_submission', { submission_id: 'SUB-4502' });
  await call('read_attachment', { attachment_id: 'ATT-4502-A' });
  await call('read_attachment', { attachment_id: 'ATT-4502-B' });
  await call('update_submission', {
    named_insured:'Cascade Millwork Inc.', entity_type:'Corporation', state:'MI',
    years_in_business:19, effective_date:'10/01/2026', experience_mod:1.18,
    governing_class:'2802', class_description:'Carpentry shop - woodworking',
    annual_payroll:2692000, employee_count:55,
    losses_on_app:'no', loss_run_years:2, loss_run_claims:4, loss_run_incurred:92400,
  });
  await call('check_submission');
  await call('ask_underwriter', { field:'fein', question:'The application left the FEIN blank and the loss run does not show it either. Can you pull it from the prior policy?' });
  await call('propose_routing', { lane:'send_for_info', rationale:'The application says no prior losses, but the loss run shows four claims and $92,400 incurred. The FEIN is also missing. I would go back to Northbridge before this goes any further.' });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test/screens/desk-${scheme}.png`, fullPage: false });
  await page.close();
}
await browser.close(); server.close();
console.log('screenshots written');
