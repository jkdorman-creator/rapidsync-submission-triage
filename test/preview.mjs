// Drives the hosted preview the way a viewer would: press play, answer the
// question it stops on, press continue, and check where it lands.
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
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);

  check(`[${scheme}] page renders the queue`, (await page.locator('.mail').count()) === 3);
  check(`[${scheme}] tools registered`, (await page.textContent('#tool-status')).includes('ready'));

  await page.click('#play');
  await page.waitForSelector('.field--asked[data-field="fein"]', { timeout: 25000 });
  check(`[${scheme}] agent stops and highlights the FEIN`, true);
  check(`[${scheme}] record filled from the documents`, (await page.inputValue('#f-named_insured')) === 'Cascade Millwork Inc.');
  check(`[${scheme}] payroll shown with separators`, (await page.inputValue('#f-annual_payroll')) === '$2,692,000');
  check(`[${scheme}] contradiction is on screen with the receipts`,
    (await page.textContent('.conflict')).includes('cascade-loss-run.pdf'));
  check(`[${scheme}] both readings are offered as buttons`, (await page.locator('.btn--choice').count()) === 2);
  check(`[${scheme}] the loss run quote is legible, not a bare column`,
    /total incurred/i.test(await page.textContent('.evidence__item--loss_run')));

  // the underwriter can check the source text before deciding
  await page.click('.conflict .btn--ghost');
  await page.waitForTimeout(250);
  const compare = await page.textContent('#doc-modal');
  check(`[${scheme}] side-by-side view shows both documents`,
    compare.includes('cascade-application.pdf') && compare.includes('cascade-loss-run.pdf')
    && compare.includes('MW-784120'));
  await page.click('#doc-close');
  await page.waitForTimeout(150);
  check(`[${scheme}] question panel explains why the FEIN matters`,
    (await page.textContent('#question')).includes('rating bureau'));
  check(`[${scheme}] the FEIN field itself carries the ask`,
    (await page.textContent('#record')).includes('Type it in the box above'));
  check(`[${scheme}] action bar names both jobs`,
    (await page.textContent('#actionbar')).includes('Enter the FEIN')
    && (await page.textContent('#actionbar')).includes('Decide which document is right'));
  check(`[${scheme}] lane is Send for Info`, (await page.locator('[data-lane="send_for_info"].lane--active').count()) === 1);
  check(`[${scheme}] button invites you to continue`, (await page.textContent('#play')).includes('Continue'));

  if (scheme === 'light') {
    await page.evaluate(() => document.querySelector('[data-field="fein"]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test/screens/preview-handoff.png' });
  }

  // nudging it before answering should be refused
  await page.click('#play');
  await page.waitForTimeout(300);
  check(`[${scheme}] pressing continue early is refused`, (await page.textContent('#transcript')).includes('Still waiting on the FEIN'));

  await page.fill('#f-fein', '38-2841190');
  await page.dispatchEvent('#f-fein', 'change');
  await page.click('#play');
  await page.waitForTimeout(400);
  check(`[${scheme}] still refuses while the contradiction stands`, (await page.textContent('#transcript')).includes('Still waiting on the losses'));
  // "Governing class code" is real WC terminology and stays. What must not
  // appear is the stiff phrasing nobody says out loud.
  check(`[${scheme}] no document "governs" phrasing`,
    !/(document|loss run|application)s?\s+governs?/i.test(await page.textContent('body')));

  await page.click('.btn--choice');
  await page.waitForTimeout(200);
  check(`[${scheme}] settling it leaves a trail`, (await page.textContent('#findings')).includes('You settled this'));
  await page.click('#play');
  await page.waitForSelector('#routing .btn--primary', { timeout: 25000 });
  check(`[${scheme}] resumes to a routing proposal`, (await page.textContent('#routing')).includes('Indication'));
  check(`[${scheme}] nothing routed yet`, !(await page.textContent('#routing')).includes('Routed by the underwriter'));

  await page.click('#routing .btn--primary');
  await page.waitForTimeout(300);
  check(`[${scheme}] human approval completes it`, (await page.textContent('#routing')).includes('Routed by the underwriter'));
  check(`[${scheme}] no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));

  if (scheme === 'dark') {
    await page.screenshot({ path: 'test/screens/preview-done-dark.png' });
  }
  await page.close();
}
await browser.close(); server.close();
const bad = results.filter(r => !r.p);
for (const r of results) console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.l + (r.e ? '  [' + r.e + ']' : ''));
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
process.exit(bad.length ? 1 : 0);
