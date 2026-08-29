// ---------------------------------------------------------------------------
// demo.js — three scripted replays, so this page can be watched by anyone.
//
// These are a demo aid, not a second implementation. Each replay calls the same
// eight tools registered in webmcp.js, in the same order, through the same
// entry point an agent would use. In a WebMCP browser they go through
// document.modelContext; anywhere else they fall back to the same tool objects
// directly, so a judge without a WebMCP browser still sees exactly what the
// agent does.
// ---------------------------------------------------------------------------
import { state, evaluate, resetRecord, isBlank } from './state.js';
import { render } from './ui.js';
import { TOOLS } from './webmcp.js';

// ---------------------------------------------------------------------------
// Scripted agent, hosted preview only. Three replays, one per lane. Each calls
// the registered tools exactly the way ChatGPT's browser does, and each one
// stops at the point a person has to decide. Nothing advances until you act.
// ---------------------------------------------------------------------------
const transcript = document.getElementById('transcript');
const resetBtn = document.getElementById('reset');
const playButtons = [...document.querySelectorAll('[data-play]')];
let running = false;

function say(who, text, pending = false) {
  const turn = document.createElement('div');
  turn.className = 'turn turn--' + who + (pending ? ' turn--pending' : '');
  const w = document.createElement('span');
  w.className = 'turn__who';
  w.textContent = who === 'agent' ? 'Agent' : 'You';
  const t = document.createElement('span');
  t.className = 'turn__text';
  t.textContent = text;
  turn.append(w, t);
  transcript.append(turn);
  transcript.scrollTop = transcript.scrollHeight;
  return turn;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// Waits for the person to actually do the thing, and says something if they
// look stuck. This is the whole point of the demo, so it never times out.
function waitFor(done, nudge) {
  return new Promise(resolve => {
    if (done()) return resolve();
    let nudged = false;
    const started = Date.now();
    const tick = setInterval(() => {
      if (done()) { clearInterval(tick); return resolve(); }
      if (!nudged && nudge && Date.now() - started > 9000) {
        nudged = true;
        say('agent', nudge);
      }
    }, 250);
  });
}

const run = (name, args) => document.modelContext.executeTool(
  { name }, args, {}).catch(() => TOOL_FALLBACK(name, args));

function TOOL_FALLBACK(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  return tool.execute(args || {}, { signal: new AbortController().signal });
}

const approved = () => Boolean(state.decision);

function setBusy(on, activeKey) {
  running = on;
  for (const b of playButtons) {
    b.disabled = on;
    b.setAttribute('aria-pressed', String(!on && b.dataset.play === activeKey));
  }
}

function resetAll() {
  transcript.innerHTML = '';
  state.openSubmissionId = null;
  state.log = [];
  resetRecord();
  render();
  say('you', 'Ready when you are. Pick one of the three above.');
  setBusy(false, null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// 1. Clean submission. Nothing to argue about — it still stops for approval.
// ---------------------------------------------------------------------------
async function playClean() {
  say('you', 'Work the Harbor and Vine submission.');
  await wait(600);
  let t = say('agent', 'Opening it…', true);
  await run('list_inbox');
  await run('open_submission', { submission_id: 'SUB-4471' });
  await wait(700); t.remove();

  t = say('agent', 'Reading the application and the loss run…', true);
  await run('read_attachment', { attachment_id: 'ATT-4471-A' });
  await run('read_attachment', { attachment_id: 'ATT-4471-B' });
  await wait(500); t.remove();

  say('agent', 'Restaurant group, 42 employees, class 9082. Writing it down.');
  await run('update_submission', {
    named_insured: 'Harbor & Vine Restaurant Group LLC', fein: '84-3319072',
    entity_type: 'Limited Liability Company', state: 'MI', years_in_business: 11,
    effective_date: '11/01/2026', experience_mod: 0.92,
    governing_class: '9082', class_description: 'Restaurant - full service',
    annual_payroll: 1845000, employee_count: 42, losses_on_app: 'yes',
    source_document: 'ATT-4471-A',
  });
  await wait(800);
  await run('update_submission', {
    loss_run_years: 3, loss_run_claims: 2, loss_run_incurred: 8900,
    source_document: 'ATT-4471-B',
  });
  await wait(900);

  t = say('agent', 'Running your rules…', true);
  await run('check_submission');
  await wait(800); t.remove();
  say('agent', 'Nothing open. Three full years of loss runs, $8,900 incurred, mod 0.92, class 9082 is in appetite. This one is ready to rate.');
  await wait(1100);

  await run('propose_routing', {
    lane: 'quote_now',
    rationale: 'Complete, in appetite and clean. Three years of loss runs with two medical-only claims totalling $8,900, mod 0.92, no open claims. Nothing to go back to the producer for.',
  });
  say('agent', 'Quote Now is on screen. Even on an easy one I do not route it — approve it and I will write to Dana.');
  await waitFor(approved, 'Still waiting on you. Approve and route is on the Routing decision card.');
  await wait(600);

  t = say('agent', 'Writing to Dana…', true);
  await run('draft_reply', {
    subject: 'Harbor & Vine Restaurant Group LLC — 11/1 effective — we are quoting',
    body: `Hi Dana,

Thanks for this one. Everything we need is here, so we are working up terms for the 11/1 effective date.

For the file: three years of loss runs, two medical-only claims totalling $8,900, nothing open, mod 0.92. Class 9082 with the clerical split as shown.

Nothing needed from you. We will have numbers back shortly.

Justin`,
  });
  await wait(600); t.remove();
  say('agent', 'Draft is below. Read it and send it — I cannot.');
}

// ---------------------------------------------------------------------------
// 2. The one with a problem. Two documents disagree and a field is blank.
// ---------------------------------------------------------------------------
async function playProblem() {
  say('you', 'Work the Cascade Millwork submission.');
  await wait(650);
  let t = say('agent', 'Looking at the queue…', true);
  await run('list_inbox');
  await wait(500); t.remove();
  say('agent', 'Found it — SUB-4502 from Northbridge Risk Partners. Opening it.');
  await run('open_submission', { submission_id: 'SUB-4502' });
  await wait(800);

  t = say('agent', 'Two documents attached. Reading the application…', true);
  await run('read_attachment', { attachment_id: 'ATT-4502-A' });
  await wait(450); t.remove();
  t = say('agent', 'Now the loss run…', true);
  await run('read_attachment', { attachment_id: 'ATT-4502-B' });
  await wait(550); t.remove();
  say('agent', 'Both read. Writing what the application says onto the record.');
  await wait(500);

  await run('update_submission', {
    named_insured: 'Cascade Millwork Inc.', entity_type: 'Corporation', state: 'MI',
    years_in_business: 19, effective_date: '10/01/2026', experience_mod: 1.18,
    governing_class: '2802', class_description: 'Carpentry shop - woodworking',
    annual_payroll: 2692000, employee_count: 55, losses_on_app: 'no',
    source_document: 'ATT-4502-A',
  });
  await wait(900);
  say('agent', 'And the loss run figures, kept separate so you can see which document each fact came from.');
  await run('update_submission', {
    loss_run_years: 2, loss_run_claims: 4, loss_run_incurred: 92400,
    source_document: 'ATT-4502-B',
  });
  await wait(1000);

  t = say('agent', 'Running your rules…', true);
  await run('check_submission');
  await wait(800); t.remove();
  say('agent', 'Two problems. The application says no prior losses, but the loss run shows four claims and $92,400 incurred, including a finger amputation. And the FEIN was left blank.');
  await wait(1500);
  say('agent', 'I can read both documents, but I cannot tell you which one is right. That is your call. I have put the exact line from each one on screen with the two buttons that settle it.');
  await wait(1300);

  await run('ask_underwriter', {
    field: 'losses_on_app',
    question: 'Which document should I go with on the losses — the application, or the loss run from Midwest Indemnity?',
  });
  say('agent', 'The FEIN is a different kind of problem. It is blank in both documents, so you cannot supply it either — I will ask Priya for it in the reply. This one is yours: pick which document to go with.');

  await waitFor(
    () => evaluate().conflicts.length === 0,
    'Still waiting on you. Read the two quotes on the Contradiction card and press either Use the loss run or Use the application.',
  );

  const settled = Object.values(state.resolutions)[0];
  say('you', settled ? `I went with the ${settled.trusted === 'loss_run' ? 'loss run' : 'application'}.` : 'Settled.');
  await wait(700);

  t = say('agent', 'Thanks. Re-running the rules…', true);
  await run('check_submission');
  await wait(800); t.remove();
  say('agent', 'That settles it, and both answers stay on the file so it is clear what each document said. Two things are still missing and neither is on this page — the FEIN, and the third year of loss runs. So we can indicate, not quote.');
  await wait(1600);

  await run('propose_routing', {
    lane: 'indication',
    rationale: 'In appetite: class 2802, mod 1.18, $92,400 incurred — all inside the guidelines. Missing the FEIN and the third year of loss runs, both of which have to come from the producer, so we can price a ballpark but not firm it up yet.',
  });
  say('agent', 'Indication is on screen with my reasoning. Approve it and I will write to Priya for the two things we need.');
  await waitFor(approved, 'Still waiting on you. Approve and route is on the Routing decision card.');
  await wait(600);

  t = say('agent', 'Writing the reply to Priya so you do not have to…', true);
  await run('draft_reply', {
    subject: 'Cascade Millwork Inc. — 10/1 effective — indication, and one item needed to quote',
    body: `Hi Priya,

Thanks for sending Cascade Millwork over. We can put an indication together now, and there are two things to sort out before we can firm it into a quote.

WHAT WE CAN DO NOW
Indication only, based on class 2802, $2,692,000 payroll, mod 1.18 and the loss experience shown below.

WHAT WE NEED FROM YOU TO QUOTE
1. The FEIN. The application left it blank and it is not on the loss run. We cannot rate or file without it, and we do not want to guess and issue against the wrong entity.

2. The third year of loss runs — 10/01/2023 to 10/01/2024 — valued within the last 90 days. Midwest Indemnity should be able to pull it.

WORTH FLAGGING TO THE INSURED
3. The application answers "no losses in the past 3 years." The attached Midwest Indemnity loss run shows 4 claims and $92,400 incurred for 10/01/2024 to 07/15/2026, including a lost-time amputation. We are going with the loss run. Worth correcting on their end so the next application is right.

Send those two over and we will turn this around quickly.

Justin`,
  });
  await wait(650); t.remove();
  say('agent', 'Draft is below — the indication, and the two things I need from Priya to make it a quote. Read it, change anything, and send it. I cannot send it myself.');
}

// ---------------------------------------------------------------------------
// 3. Out of appetite. The point is how fast it gets out of the way.
// ---------------------------------------------------------------------------
async function playDecline() {
  say('you', 'Work the Ridgeline Roofing submission.');
  await wait(600);
  let t = say('agent', 'Opening it…', true);
  await run('list_inbox');
  await run('open_submission', { submission_id: 'SUB-4489' });
  await wait(750); t.remove();
  say('agent', 'The email is pushing hard for a Friday turnaround and says the mod is good for the trade. Reading the application before I take any of that at face value.');
  await wait(1200);

  t = say('agent', 'Reading the application…', true);
  await run('read_attachment', { attachment_id: 'ATT-4489-A' });
  await wait(600); t.remove();

  await run('update_submission', {
    named_insured: 'Ridgeline Roofing & Exteriors Inc.', fein: '47-2210558',
    entity_type: 'Corporation', state: 'MI, IN, OH', years_in_business: 6,
    effective_date: '10/15/2026', experience_mod: 1.14,
    governing_class: '5551', class_description: 'Roofing - all kinds & drivers',
    annual_payroll: 2370000, employee_count: 32,
    source_document: 'ATT-4489-A',
  });
  await wait(900);

  t = say('agent', 'Running your rules…', true);
  await run('check_submission');
  await wait(800); t.remove();
  say('agent', 'Governing class is 5551, roofing. That is on your prohibited list, so the answer is no regardless of the mod or the deadline.');
  await wait(1300);
  say('agent', 'No loss runs were attached, and I am not going to chase them. There is no point gathering data on a risk you will never write.');
  await wait(1300);

  await run('propose_routing', {
    lane: 'likely_decline',
    rationale: 'Governing class 5551, roofing, is on the prohibited list — 70% of work above two stories on the applicant\'s own account. Mod 1.14 and the Friday deadline do not change that. Decline quickly so the producer can place it elsewhere in time.',
  });
  say('agent', 'Likely Decline is on screen. Approve it and I will write Marcus a straight answer today rather than leaving him hanging until Friday.');
  await waitFor(approved, 'Still waiting on you. Approve and route is on the Routing decision card.');
  await wait(600);

  t = say('agent', 'Writing the decline…', true);
  await run('draft_reply', {
    subject: 'Ridgeline Roofing & Exteriors Inc. — 10/15 effective — we have to pass',
    body: `Hi Marcus,

Thanks for thinking of us on Ridgeline, and sorry to come back with a no.

Governing class 5551 — roofing, all kinds and drivers — is outside our appetite, so this is not one we can work on regardless of the loss experience. The 1.14 mod is genuinely reasonable for the trade and the operations detail reads well; the class is simply not one we write.

I am sending this today rather than sitting on it so you have the week to place it elsewhere. Happy to look at anything they have on the clerical or carpentry side.

Justin`,
  });
  await wait(650); t.remove();
  say('agent', 'Draft is below. Twenty seconds instead of an afternoon, and Marcus gets a real answer while he can still do something with it.');
}

const SCENARIOS = { clean: playClean, problem: playProblem, decline: playDecline };

async function play(key) {
  if (running) return;
  setBusy(true, key);
  transcript.innerHTML = '';
  state.log = [];
  resetRecord();
  render();
  try {
    await SCENARIOS[key]();
  } finally {
    setBusy(false, key);
  }
}

for (const btn of playButtons) {
  btn.addEventListener('click', () => play(btn.dataset.play));
}
resetBtn.addEventListener('click', resetAll);
say('you', 'Ready when you are. Pick one of the three above.');
