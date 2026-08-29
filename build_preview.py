#!/usr/bin/env python3
"""Assembles the hosted single-file preview from the real app sources.

The preview is the same code as the deployed app, with two differences:
  * PDF.js is not shipped; read_attachment returns the text PDF.js produced at
    build time (captured by test/dump-text.mjs), so the tool output is
    byte-identical to the real thing.
  * A scripted agent is added, so the page can be watched without an agent
    attached. It calls the same tools, in the same order, through the same
    registration path.

Everything else - the rules, the record, the tools, the human handoff - is the
production code, inlined.
"""
import json
import re
import pathlib

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "preview" / "triage-desk-preview.html"
OUT.parent.mkdir(exist_ok=True)

css = (ROOT / "assets/app.css").read_text()
state_js = (ROOT / "assets/state.js").read_text()
ui_js = (ROOT / "assets/ui.js").read_text()
webmcp_js = (ROOT / "assets/webmcp.js").read_text()
index = (ROOT / "index.html").read_text()
extracted = json.loads((ROOT / "test/extracted-text.json").read_text())

# --- 1. CSS: give the dark tokens all three selector forms the host needs ----
m = re.search(r"@media \(prefers-color-scheme: dark\) \{\n  :root \{\n(.*?)\n  \}\n\}\n", css, re.S)
assert m, "could not find the dark token block"
dark_tokens = m.group(1)
css = css.replace(m.group(0), (
    "@media (prefers-color-scheme: dark) {\n"
    "  :root:not([data-theme=\"light\"]) {\n" + dark_tokens + "\n  }\n}\n"
    ":root[data-theme=\"dark\"] {\n" + dark_tokens + "\n}\n"
))

# --- 2. JS: strip module syntax so the three files become one script --------
def demodule(src):
    src = re.sub(r"^import[\s\S]*?from\s+'[^']+';\s*$", "", src, flags=re.M)
    src = re.sub(r"^import\s+'[^']+';\s*$", "", src, flags=re.M)
    src = re.sub(r"^export\s+(?=(const|let|function|async function|class))", "", src, flags=re.M)
    src = re.sub(r"^export\s+\{[^}]*\};\s*$", "", src, flags=re.M)
    return src

state_js = demodule(state_js)
ui_js = demodule(ui_js)
webmcp_js = demodule(webmcp_js)

# --- 3. Swap live PDF parsing for the text PDF.js produced at build time ----
lazy_loader = re.search(r"// PDF\.js is vendored locally[\s\S]*?\n\}\n", ui_js)
assert lazy_loader, "could not find the pdf.js loader block"
ui_js = ui_js.replace(lazy_loader.group(0), (
    "// HOSTED PREVIEW: the deployed app parses the PDF in the browser with a\n"
    "// vendored copy of PDF.js. This preview ships the text that parser produced\n"
    "// at build time instead, so tool output is identical without the 1.7MB\n"
    "// library. See assets/ui.js in the repository for the real extractor.\n"
    "const EXTRACTED = " + json.dumps(extracted, indent=2) + ";\n"
))
body = re.search(
    r"async function extractAttachment\(attachmentId\) \{[\s\S]*?\n\}\n", ui_js)
assert body, "could not find extractAttachment"
ui_js = ui_js.replace(body.group(0), (
    "async function extractAttachment(attachmentId) {\n"
    "  const sub = openSubmission();\n"
    "  if (!sub) throw new Error('no submission open');\n"
    "  const att = sub.attachments.find(a => a.id === attachmentId);\n"
    "  if (!att) throw new Error('no such attachment');\n"
    "  await new Promise(r => setTimeout(r, 260));   // the real parse is not instant either\n"
    "  const text = EXTRACTED[attachmentId];\n"
    "  if (!text) throw new Error('no text captured for ' + attachmentId);\n"
    "  state.documents[attachmentId] = { name: att.name, kind: att.kind, text };\n"
    "  return text;\n"
    "}\n"
))

# --- 4. Body markup, lifted from the real page ------------------------------
body_html = re.search(r"<body>\n(.*?)\n<script type=\"module\">", index, re.S).group(1)
PLAYER_BAR = """<div class="playerbar">
  <div class="playerbar__row">
    <span class="playerbar__label">Pick one to watch</span>
    <button type="button" class="btn btn--choice btn--play" data-play="clean">
      <span class="btn__label">A clean one</span>
      <span class="btn__detail">Everything is there. It still asks before it acts.</span>
    </button>
    <button type="button" class="btn btn--choice btn--play" data-play="problem">
      <span class="btn__label">One with a problem</span>
      <span class="btn__detail">Two documents disagree. Only you can settle it.</span>
    </button>
    <button type="button" class="btn btn--choice btn--play" data-play="decline">
      <span class="btn__label">One we cannot write</span>
      <span class="btn__detail">Out of appetite. Out in twenty seconds.</span>
    </button>
    <button type="button" class="btn btn--ghost" id="reset">Reset</button>
  </div>
  <p class="playerbar__note">
    <strong>The job:</strong> read the email, open the attachments, retype fifteen numbers, decide what
    happens to it. Forty times a week. This hands the typing to an AI agent and keeps every decision.
    Each replay is real tool calls, and each one stops and waits for you to make the call.
  </p>
</div>"""

# Swap the whole demobar element for the player, matching the element rather
# than its wording so copy edits upstream cannot silently break this build.
body_html, n = re.subn(r'<p class="demobar">.*?</p>', PLAYER_BAR, body_html, flags=re.S)
assert n == 1, f"expected one demobar, found {n}"

# The agent transcript sits at the top of the triage column.
body_html = body_html.replace(
    '    <h2 class="col__title">Triage</h2>',
    '    <h2 class="col__title">Agent</h2>\n'
    '    <div id="transcript" class="card transcript"></div>\n\n'
    '    <h2 class="col__title col__title--spaced">Triage</h2>')

extra_css = """
/* ---- hosted preview only: the scripted agent -------------------------- */
.playerbar {
  padding: 11px 22px; background: var(--panel); border-bottom: 1px solid var(--line);
}
.playerbar__row { display: flex; align-items: stretch; gap: 9px; flex-wrap: wrap; }
.btn--play { flex: 0 1 250px; }
.btn--play:hover { border-color: var(--accent); }
.btn--play[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.playerbar__label { align-self: center; }
.playerbar__label {
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  font-weight: 650; color: var(--muted); margin-right: 3px;
}
.playerbar__note {
  color: var(--muted); font-size: 12.5px; max-width: 96ch; margin: 8px 0 0;
}
.playerbar__note strong { color: var(--ink); font-weight: 600; }
.btn[data-play][aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn[disabled] { opacity: .45; cursor: default; }
.transcript { display: flex; flex-direction: column; gap: 9px; font-size: 13px; line-height: 1.55; max-height: 300px; overflow-y: auto; }
.turn { display: grid; grid-template-columns: 54px 1fr; gap: 10px; align-items: baseline; }
.turn__who {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em;
  font-weight: 600; padding-top: 2px;
}
.turn--agent .turn__who { color: var(--accent); }
.turn--you .turn__who { color: var(--ask); }
.turn__text { min-width: 0; }
.turn--pending .turn__text::after {
  content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 5px;
  border-radius: 50%; background: var(--muted); animation: blink 1.1s steps(2) infinite;
  vertical-align: middle;
}
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .turn--pending .turn__text::after { animation: none; }
  .field--flash { animation: none; }
  .meter__fill { transition: none; }
}
.waiting { outline: 2px solid var(--ask); outline-offset: 3px; border-radius: 12px; }
"""

player_js = r"""
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
"""

# The preview needs executeTool even when no WebMCP browser is present.
shim = """
// If no WebMCP browser is attached, stand up a local registry so the preview
// still works. When one IS attached, the real document.modelContext wins and
// the same tools are handed to it.
if (!('modelContext' in document)) {
  const registry = new Map();
  document.modelContext = {
    async registerTool(tool) { registry.set(tool.name, tool); },
    async getTools() { return [...registry.values()]; },
    async executeTool(tool, input) {
      const t = registry.get(typeof tool === 'string' ? tool : tool.name);
      if (!t) throw new Error('no such tool');
      const out = await t.execute(input || {}, { signal: new AbortController().signal });
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
    addEventListener() {}, removeEventListener() {},
  };
  document.documentElement.dataset.previewShim = 'local';
}
"""

html = f"""<title>Submission Triage Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;450;500;600&display=swap">
<style>
{css}
{extra_css}
</style>

{body_html}

<script type="module">
{shim}
{state_js}
{ui_js}
{webmcp_js}
registerAll();
{player_js}
</script>
"""

OUT.write_text(html)
print(f"wrote {OUT} ({len(html):,} bytes)")
