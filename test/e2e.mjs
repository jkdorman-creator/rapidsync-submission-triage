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
// Webfonts are progressive enhancement — a blocked font host must not fail the
// run, and the fallback stack covers it. Anything else is a real error.
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|Failed to load resource/;
page.on('console', m => { if (m.type() === 'error' && !FONT_NOISE.test(m.text())) errors.push('console: ' + m.text()); });
page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push('request failed: ' + r.url()); });
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
check('8 tools registered', tools.length === 8, 'got ' + tools.length);
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
  losses_on_app: 'no', source_document: 'ATT-4502-A',
});
await call('update_submission', {
  loss_run_years: 2, loss_run_claims: 4, loss_run_incurred: 92400, source_document: 'ATT-4502-B',
});
check('record shows the named insured on screen', (await page.inputValue('#f-named_insured')) === 'Cascade Millwork Inc.');
check('record credits the document each fact came from',
  (await page.textContent('#record')).includes('from cascade-application.pdf')
  && (await page.textContent('#record')).includes('from cascade-loss-run.pdf'));

const badSrc = await call('update_submission', { named_insured: 'X', source_document: 'ATT-NOPE' });
check('bad source document is rejected with the valid ids', badSrc.includes('ATT-4502-A'));

const junk = await call('update_submission', { totally_made_up: 'x', named_insured: 'Cascade Millwork Inc.' });
check('unknown field reported back, not silently dropped', junk.includes('totally_made_up') && junk.includes('Valid names'));

const c1 = await call('check_submission');
check('rules catch the loss disclosure contradiction', c1.includes('CONTRADICTION'));
check('the FEIN is listed as a producer request, not a desk task', c1.includes('come from the producer'));
check('the FEIN is named as needed to quote', c1.includes('FEIN'));
check('the action bar does not ask the desk to type a missing value',
  !(await page.textContent('#actionbar')).includes('Enter the FEIN'));
check('lane is Send for Info', c1.includes('Send for Info'));
check('Send for Info chip is lit', (await page.locator('[data-lane="send_for_info"].lane--active').count()) === 1);

// Asking the underwriter for a value that is blank in every document is the
// wrong move: they do not have it either. The tool refuses and redirects.
const wrongAsk = await call('ask_underwriter', { field: 'fein', question: 'What is the FEIN?' });
check('asking the underwriter for a missing value is refused', wrongAsk.includes('blank in every document'));
check('the refusal redirects to the producer', wrongAsk.includes('draft_reply'));
check('no question panel was opened by the refused ask', await page.locator('#question').isHidden());

// A genuine judgment call is what ask_underwriter is for.
// The agent must not be able to dissolve the contradiction by overwriting the
// fields it rests on. While it is open, they are locked.
const sneak = await call('update_submission', { losses_on_app: 'yes' });
check('overwriting the disputed answer is locked', sneak.includes('LOCKED'));
check('the lock names who can settle it', sneak.includes('Only the underwriter'));
check('the record kept the application answer', (await page.inputValue('#f-losses_on_app')) === 'no');
const still = await call('check_submission');
check('the contradiction survives the attempt', still.includes('CONTRADICTION'));

const ask = await call('ask_underwriter', { field: 'losses_on_app', question: 'Which document should I go with on the losses?' });
check('ask_underwriter returns the words to say', ask.includes('Say this to the user'));
check('ask_underwriter supplies the reason without being told', ask.includes('stays on the file'));
check('question panel frames a decision as a decision', (await page.textContent('#question')).includes('Pick which document to go with'));
check('action bar names the jobs, not a count',
  (await page.textContent('#actionbar')).includes('Decide which document is right'));
check('the action bar does not duplicate the same job twice',
  !(await page.textContent('#actionbar')).includes('Enter the Losses'));
check('question panel explains why it matters', (await page.textContent('#question')).includes('stays on the file'));
check('question panel offers a jump to the evidence', (await page.textContent('#question')).includes('Show me the two documents'));
check('asked field is highlighted on screen', (await page.locator('.field--asked[data-field="losses_on_app"]').count()) === 1);
check('question panel is visible', !(await page.locator('#question').isHidden()));

const badAsk = await call('ask_underwriter', { field: 'not_a_field', question: 'hi' });
check('bad field name rejected with the valid list', badAsk.includes('not a field'));


// the contradiction card shows the actual line from each document
const conflictText = await page.textContent('.conflict');
check('conflict card quotes the application', conflictText.includes('cascade-application.pdf'));
check('conflict card quotes the loss run', conflictText.includes('cascade-loss-run.pdf'));
check('conflict card offers both readings', (await page.locator('.conflict .btn--choice').count()) === 2);
check('conflict card offers a side-by-side check', conflictText.includes('side by side'));
check('conflict wording is plain', conflictText.includes('Use the loss run') && !conflictText.includes('governs'));
check('action bar is visible while something is open', !(await page.locator('#actionbar').isHidden()));
check('header is sticky', (await page.evaluate(() => getComputedStyle(document.querySelector('.stickytop')).position)) === 'sticky');

// the human settles it with one click, in favour of the loss run
await page.click('.conflict .btn--choice');
await page.waitForTimeout(200);
const c2 = await call('check_submission');
check('contradiction clears once a person settles it', !c2.includes('CONTRADICTION'));
check('agent is told what the person decided', c2.includes('THE UNDERWRITER DECIDED: You went with the loss run'));
check('the application answer is left as written', (await page.inputValue('#f-losses_on_app')) === 'no');
check('settled note stays on screen', (await page.textContent('#findings')).includes('You settled this'));
check('missing producer items drive Indication', c2.includes('Indication'));
check('they are listed as needed to quote', c2.includes('NEEDED TO TURN THE INDICATION INTO A QUOTE'));
check('the FEIN is one of them', c2.includes('FEIN'));
check('the short loss history is the other', c2.includes('3 are needed for a firm quote'));
check('the record still shows the FEIN blank', (await page.inputValue('#f-fein')) === '');

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
  entity_type: 'Limited Liability Company',
  effective_date: '11/01/2026', experience_mod: 0.92, governing_class: '9082',
  annual_payroll: 1845000, employee_count: 42,
  losses_on_app: 'yes', loss_run_years: 3, loss_run_claims: 2, loss_run_incurred: 8900,
});
const c4 = await call('check_submission');
check('clean complete file lands in Quote Now', c4.includes('Quote Now') && c4.includes('ready to rate'));

// ---- the agent drafts, a person sends ------------------------------------
const draft = await call('draft_reply', { subject: 'Need one more year of loss runs', body: 'Hi Dana,\n\nPlease send the third year.\n\nJustin' });
check('draft_reply says plainly it did not send', draft.includes('NOT been sent'));
check('the draft is on screen', (await page.textContent('#reply')).includes('Please send the third year'));
check('the draft names who it goes to', (await page.textContent('#reply')).includes('dwhitfield@prairiestate.example'));
check('sending is a button, not a tool', (await page.textContent('#reply')).includes('Send it'));
check('not sent until a person clicks', !(await page.textContent('#reply')).includes('Sent by you'));
await page.click('#reply .btn--primary');
await page.waitForTimeout(150);
check('a person can send it', (await page.textContent('#reply')).includes('Sent by you'));

const emptyDraft = await call('draft_reply', { subject: '', body: '' });
check('an empty draft is refused', emptyDraft.includes('both a subject and a body'));

// ---- the trust model is stated on the page -------------------------------
check('the signed-in person is named in the header', (await page.textContent('.who')).includes('J. Dorman'));
check('the page says the agent has no login', (await page.textContent('#limits')).includes('no password and no login'));
check('the page lists what the agent cannot do', (await page.textContent('#limits')).includes('Route a submission'));
check('the page says why the job is hard', (await page.textContent('.playerbar')).includes('retype'));
check('the deployed page carries the replays too', (await page.locator('[data-play]').count()) === 3);

// ---- output budgets -------------------------------------------------------
const outputs = { list_inbox: inbox, open_submission: opened, check_submission: c4, propose_routing: prop, ask_underwriter: ask };
for (const [n, o] of Object.entries(outputs)) {
  check('output <=1500 chars: ' + n, o.length <= 1500, String(o.length));
}
check('activity log recorded the tool calls', (await page.textContent('#activity')).includes('check_submission'));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// ---- the Codex case: execute() called with no options argument ------------
// Seen live: Codex invokes tool callbacks with only the input object. Every
// tool must survive that — especially read_attachment, which is the only one
// that touches the second parameter.
{
  const oneArg = await page.evaluate(async () => {
    const out = {};
    await window.__tools.get('open_submission').execute({ submission_id: 'SUB-4502' });
    out.read = await window.__tools.get('read_attachment').execute({ attachment_id: 'ATT-4502-B' });
    out.check = await window.__tools.get('check_submission').execute({});
    return out;
  });
  check('read_attachment survives a one-argument call', oneArg.read.includes('92,400'));
  check('the rest of the loop follows', oneArg.check.includes('lane'));
}

// ---- the Codex case: a pane that blocks the PDF engine --------------------
// Seen live in ChatGPT/Codex's browser pane: PDF.js cannot start its worker.
// read_attachment must still return the documents via the build-time text.
{
  const p2 = await browser.newPage();
  await p2.route('**/vendor/pdf*', route => route.abort());
  await p2.addInitScript(STUB);
  await p2.goto(base, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(800);
  const call2 = (n, i) => p2.evaluate(([n, i]) => document.modelContext.executeTool(n, i), [n, i]);
  await call2('open_submission', { submission_id: 'SUB-4502' });
  const blockedRead = await call2('read_attachment', { attachment_id: 'ATT-4502-B' });
  check('PDF-blocked pane still reads the loss run', blockedRead.includes('92,400') && blockedRead.includes('MW-784120'));
  check('the fallback is disclosed in the activity log',
    (await p2.textContent('#activity')).includes('PDF engine blocked'));
  await call2('read_attachment', { attachment_id: 'ATT-4502-A' });
  await call2('update_submission', { losses_on_app: 'no', loss_run_claims: 4, source_document: 'ATT-4502-B' });
  const blockedCheck = await call2('check_submission');
  check('the contradiction still fires without the PDF engine', blockedCheck.includes('CONTRADICTION'));
  await p2.close();
}

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.label + (r.extra ? '  [' + r.extra + ']' : ''));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
