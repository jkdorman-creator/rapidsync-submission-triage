// End-to-end check. Stubs document.modelContext so we can drive every tool the
// way a real agent would, then walks the full Cascade Millwork scenario.
//   node test/e2e.mjs .
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.pdf': 'application/pdf', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;

const STUB = () => {
  const tools = new Map();
  document.modelContext = {
    async registerTool(tool) {
      if (tools.has(tool.name)) throw Object.assign(new Error('dup'), { name: 'InvalidStateError' });
      tools.set(tool.name, tool);
    },
    async getTools() { return [...tools.values()].map(t => ({ ...t })); },
    async executeTool(name, input) {
      const t = tools.get(name);
      if (!t) throw new Error('no tool ' + name);
      const c = new AbortController();
      const out = await t.execute(input || {}, { signal: c.signal });
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
    addEventListener() {}, removeEventListener() {},
  };
  window.__tools = tools;
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(STUB);
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const call = (n, i) => page.evaluate(([n, i]) => document.modelContext.executeTool(n, i), [n, i]);
const results = [];
const check = (label, pass, extra = '') => results.push({ label, pass, extra });

// ---- registration + budgets ----------------------------------------------
const tools = await page.evaluate(() => [...window.__tools.values()].map(t => ({
  name: t.name,
  desc: t.description,
  params: Object.entries(t.inputSchema && t.inputSchema.properties ? t.inputSchema.properties : {})
    .map(([k, v]) => [k, (v.description || '').length]),
})));
check('7 tools registered', tools.length === 7, 'got ' + tools.length);
check('tool status pill shows ready', (await page.textContent('#tool-status')).includes('ready'));
for (const t of tools) {
  check('name <=30: ' + t.name, t.name.length <= 30, String(t.name.length));
  check('desc <=500: ' + t.name, t.desc.length <= 500, String(t.desc.length));
  const over = t.params.filter(p => p[1] > 150);
  check('param descs <=150: ' + t.name, over.length === 0, over.map(o => o[0]).join(','));
}

// ---- scenario: Cascade Millwork ------------------------------------------
const inbox = await call('list_inbox');
check('list_inbox names all three', ['SUB-4471', 'SUB-4489', 'SUB-4502'].every(id => inbox.includes(id)));

const opened = await call('open_submission', { submission_id: 'SUB-4502' });
check('open_submission returns body + attachments', opened.includes('Cascade Millwork') && opened.includes('ATT-4502-B'));
check('open_submission warns content is untrusted', opened.toLowerCase().includes('not instructions'));

const badOpen = await call('open_submission', { submission_id: 'SUB-9999' });
check('bad id returns a recoverable error', badOpen.includes('No submission') && badOpen.includes('list_inbox'));

await call('open_submission', { submission_id: 'SUB-4502' });
const app = await call('read_attachment', { attachment_id: 'ATT-4502-A' });
check('read_attachment parses the application PDF', app.includes('Cascade Millwork') && app.includes('2802'));

const lr = await call('read_attachment', { attachment_id: 'ATT-4502-B' });
check('read_attachment parses the loss run PDF', lr.includes('92,400') && lr.includes('MW-784120'));

const badAtt = await call('read_attachment', { attachment_id: 'ATT-NOPE' });
check('bad attachment id lists valid ids', badAtt.includes('ATT-4502-A'));

await call('update_submission', {
  named_insured: 'Cascade Millwork Inc.', entity_type: 'Corporation', state: 'MI',
  years_in_business: 19, effective_date: '10/01/2026', experience_mod: 1.18,
  governing_class: '2802', class_description: 'Carpentry shop - woodworking',
  annual_payroll: 2692000, employee_count: 55,
  losses_on_app: 'no', loss_run_years: 2, loss_run_claims: 4, loss_run_incurred: 92400,
});
check('record shows the named insured on screen', (await page.inputValue('#f-named_insured')) === 'Cascade Millwork Inc.');
check('provenance marks agent-written fields', (await page.textContent('#record')).includes('from agent'));

const junk = await call('update_submission', { totally_made_up: 'x', named_insured: 'Cascade Millwork Inc.' });
check('unknown field reported back, not silently dropped', junk.includes('totally_made_up') && junk.includes('Valid names'));

const c1 = await call('check_submission');
check('rules catch the loss disclosure contradiction', c1.includes('CONTRADICTION'));
check('rules list the missing FEIN', c1.includes('FEIN'));
check('lane is Send for Info', c1.includes('Send for Info'));
check('Send for Info chip is lit', (await page.locator('[data-lane="send_for_info"].lane--active').count()) === 1);

const ask = await call('ask_underwriter', { field: 'fein', question: 'The application left the FEIN blank and it is not on the loss run. What is it?' });
check('ask_underwriter returns the question to relay', ask.includes('Highlighted') && ask.includes('FEIN'));
check('asked field is highlighted on screen', (await page.locator('.field--asked[data-field="fein"]').count()) === 1);
check('question panel is visible', !(await page.locator('#question').isHidden()));

const badAsk = await call('ask_underwriter', { field: 'not_a_field', question: 'hi' });
check('bad field name rejected with the valid list', badAsk.includes('not a field'));

// the human answers, by hand, in the page
await page.fill('#f-fein', '38-2841190');
await page.dispatchEvent('#f-fein', 'change');
check('answering clears the highlight', (await page.locator('.field--asked').count()) === 0);

// the human settles the contradiction in favour of the loss run
await page.selectOption('#f-losses_on_app', 'yes');
await page.dispatchEvent('#f-losses_on_app', 'change');
const c2 = await call('check_submission');
check('contradiction clears once a person settles it', !c2.includes('CONTRADICTION'));
check('short loss history now drives Indication', c2.includes('Indication') && c2.includes('LIMITS THE OFFER'));

const prop = await call('propose_routing', { lane: 'indication', rationale: 'Loss runs cover only two years, so we can indicate but not firm quote.' });
check('propose_routing does not route on its own', prop.includes('Nothing has been routed'));
check('proposal card is on screen', (await page.textContent('#routing')).includes('Indication'));
check('proposal is not yet a decision', !(await page.textContent('#routing')).includes('Routed by the underwriter'));

const badLane = await call('propose_routing', { lane: 'quote_it', rationale: 'x' });
check('bad lane rejected with the valid list', badLane.includes('quote_now'));

await call('propose_routing', { lane: 'indication', rationale: 'Two years of loss runs only.' });
await page.click('#routing .btn--primary');
check('human approval records the decision', (await page.textContent('#routing')).includes('Routed by the underwriter'));

// ---- scenario: Ridgeline (prohibited class) ------------------------------
await call('open_submission', { submission_id: 'SUB-4489' });
await call('update_submission', { named_insured: 'Ridgeline Roofing & Exteriors Inc.', governing_class: '5551', experience_mod: 1.14 });
const c3 = await call('check_submission');
check('prohibited class drives Likely Decline', c3.includes('Likely Decline') && c3.includes('APPETITE PROBLEM'));
check('Likely Decline chip is lit', (await page.locator('[data-lane="likely_decline"].lane--active').count()) === 1);

// ---- scenario: Harbor & Vine (clean) -------------------------------------
await call('open_submission', { submission_id: 'SUB-4471' });
await call('update_submission', {
  named_insured: 'Harbor & Vine Restaurant Group LLC', fein: '84-3319072', state: 'MI',
  effective_date: '11/01/2026', experience_mod: 0.92, governing_class: '9082',
  annual_payroll: 1845000, employee_count: 42,
  losses_on_app: 'yes', loss_run_years: 3, loss_run_claims: 2, loss_run_incurred: 8900,
});
const c4 = await call('check_submission');
check('clean complete file lands in Quote Now', c4.includes('Quote Now') && c4.includes('ready to rate'));

// ---- output budgets -------------------------------------------------------
const outputs = { list_inbox: inbox, open_submission: opened, check_submission: c4, propose_routing: prop, ask_underwriter: ask };
for (const [n, o] of Object.entries(outputs)) {
  check('output <=1500 chars: ' + n, o.length <= 1500, String(o.length));
}
check('activity log recorded the tool calls', (await page.textContent('#activity')).includes('check_submission'));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.label + (r.extra ? '  [' + r.extra + ']' : ''));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
