// Drives the hosted preview the way a viewer would: play each of the three
// replays, do the thing each one stops for, and check where it lands.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve('preview');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, 'triage-desk-preview.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;

const results = [];
const check = (l, p, e = '') => results.push({ l, p, e });
const browser = await chromium.launch();

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1200 }, colorScheme: scheme, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(t) && !/Failed to load resource/.test(t)) errs.push(t);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const tag = s => `[${scheme}] ${s}`;

  check(tag('page renders the queue'), (await page.locator('.mail').count()) === 3);
  check(tag('8 tools registered'), (await page.textContent('#tool-status')).includes('8 site tools'));
  check(tag('three replays are offered'), (await page.locator('[data-play]').count()) === 3);
  check(tag('the trust model is on the page'), (await page.textContent('#limits')).includes('no password and no login'));
  check(tag('the page says why the job is hard'), (await page.textContent('.playerbar')).includes('retype fifteen numbers'));

  // ---- 1. the clean one -> Quote Now ------------------------------------
  await page.click('[data-play="clean"]');
  await page.waitForSelector('#routing .btn--primary', { timeout: 30000 });
  check(tag('clean submission reaches Quote Now'), (await page.textContent('#routing')).includes('Quote Now'));
  check(tag('clean one still waits for approval'), !(await page.textContent('#routing')).includes('Routed by the underwriter'));
  check(tag('clean one lit the Quote Now lane'), (await page.locator('[data-lane="quote_now"].lane--active').count()) === 1);
  await page.click('#routing .btn--primary');
  await page.waitForSelector('#reply .btn--primary', { timeout: 30000 });
  const cleanReply = await page.textContent('#reply');
  check(tag('clean one drafts a we-are-quoting reply'), /we are quoting/i.test(cleanReply));
  check(tag('clean reply asks for nothing'), /Nothing needed from you/i.test(cleanReply));
  check(tag('clean reply is unsent'), !cleanReply.includes('Sent by you'));

  // ---- 2. the one we cannot write -> Likely Decline ----------------------
  await page.click('[data-play="decline"]');
  await page.waitForSelector('#routing .btn--primary', { timeout: 30000 });
  check(tag('roofing reaches Likely Decline'), (await page.textContent('#routing')).includes('Likely Decline'));
  check(tag('appetite rule names the class'), (await page.textContent('#findings')).includes('5551'));
  check(tag('deadline pressure did not change the answer'), (await page.textContent('#transcript')).includes('regardless of the mod or the deadline'));
  await page.click('#routing .btn--primary');
  await page.waitForSelector('#reply .btn--primary', { timeout: 30000 });
  const declineReply = await page.textContent('#reply');
  check(tag('decline drafts a real decline letter'), /outside our appetite/i.test(declineReply));
  check(tag('decline reply is unsent'), !declineReply.includes('Sent by you'));

  // ---- 3. the one with a problem -> Send for Info -> Indication ----------
  await page.click('[data-play="problem"]');
  await page.waitForSelector('.field--asked[data-field="fein"]', { timeout: 30000 });
  check(tag('agent stops and highlights the FEIN'), true);
  check(tag('record filled from the documents'), (await page.inputValue('#f-named_insured')) === 'Cascade Millwork Inc.');
  check(tag('payroll shown with separators'), (await page.inputValue('#f-annual_payroll')) === '$2,692,000');
  check(tag('facts credited to each document'),
    (await page.textContent('#record')).includes('from cascade-application.pdf')
    && (await page.textContent('#record')).includes('from cascade-loss-run.pdf'));
  check(tag('contradiction shows the receipts'), (await page.textContent('.conflict')).includes('cascade-loss-run.pdf'));
  check(tag('both readings are offered as buttons'), (await page.locator('.btn--choice').count()) === 2);
  check(tag('the loss run quote is legible'), /total incurred/i.test(await page.textContent('.evidence__item--loss_run')));
  check(tag('lane is Send for Info'), (await page.locator('[data-lane="send_for_info"].lane--active').count()) === 1);
  check(tag('the FEIN field itself carries the ask'), (await page.textContent('#record')).includes('Type it in the box above'));
  check(tag('question panel explains why the FEIN matters'), (await page.textContent('#question')).includes('rating bureau'));
  check(tag('action bar names both jobs'),
    (await page.textContent('#actionbar')).includes('Enter the FEIN')
    && (await page.textContent('#actionbar')).includes('Decide which document is right'));
  check(tag('no document "governs" phrasing'),
    !/(document|loss run|application)s?\s+governs?/i.test(await page.textContent('body')));

  // the underwriter checks the source text before deciding
  await page.click('.conflict .btn--ghost');
  await page.waitForTimeout(250);
  const compare = await page.textContent('#doc-modal');
  check(tag('side-by-side shows both documents'),
    compare.includes('cascade-application.pdf') && compare.includes('MW-784120'));
  await page.click('#doc-close');
  await page.waitForTimeout(150);

  if (scheme === 'light') {
    await page.evaluate(() => document.querySelector('[data-field="fein"]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test/screens/preview-handoff.png' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test/screens/preview-top.png' });
  }

  // it should still be waiting, because we have not answered
  check(tag('it is still waiting before we answer'), !(await page.textContent('#routing')).includes('Indication'));

  await page.fill('#f-fein', '38-2841190');
  await page.dispatchEvent('#f-fein', 'change');
  await page.waitForTimeout(500);
  check(tag('half an answer is not enough'), !(await page.textContent('#routing')).includes('Indication'));

  await page.click('.btn--choice');
  check(tag('settling it leaves a trail'), (await page.textContent('#findings')).includes('You settled this'));

  // answering is what advances it — no Continue button
  await page.waitForSelector('#routing .btn--primary', { timeout: 30000 });
  check(tag('answering resumes the run on its own'), (await page.textContent('#routing')).includes('Indication'));
  check(tag('nothing routed yet'), !(await page.textContent('#routing')).includes('Routed by the underwriter'));
  await page.click('#routing .btn--primary');
  check(tag('human approval completes it'), (await page.textContent('#routing')).includes('Routed by the underwriter'));

  await page.waitForSelector('#reply .btn--primary', { timeout: 30000 });
  const reply = await page.textContent('#reply');
  check(tag('reply separates what we can do now'), /WHAT WE CAN DO NOW/.test(reply));
  check(tag('reply lists what is needed to quote'), /WHAT WE NEED TO QUOTE/.test(reply));
  check(tag('reply names the missing loss run year'), reply.includes('10/01/2023'));
  check(tag('reply flags the contradiction to the producer'), /no losses in the past 3 years/i.test(reply));
  check(tag('the page says the agent cannot send it'), reply.includes('cannot send it'));
  await page.click('#reply .btn--primary');
  await page.waitForTimeout(200);
  check(tag('a person sends it'), (await page.textContent('#reply')).includes('Sent by you'));
  check(tag('no page errors'), errs.length === 0, errs.slice(0, 2).join(' | '));

  if (scheme === 'dark') await page.screenshot({ path: 'test/screens/preview-done-dark.png' });
  await page.close();
}
await browser.close(); server.close();
const bad = results.filter(r => !r.p);
for (const r of results) console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.l + (r.e ? '  [' + r.e + ']' : ''));
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
process.exit(bad.length ? 1 : 0);
