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
    "  return text;\n"
    "}\n"
))

# --- 4. Body markup, lifted from the real page ------------------------------
body_html = re.search(r"<body>\n(.*?)\n<script type=\"module\">", index, re.S).group(1)
body_html = body_html.replace(
    '<p class="demobar">\n  Demonstration only. Every business, producer, document and claim below is invented.\n'
    '  Ask your agent: <em>“Work the Cascade Millwork submission.”</em>\n</p>',
    PLAYER_BAR := """<div class="playerbar">
  <button id="play" type="button" class="btn btn--primary">Watch the agent work a submission</button>
  <span id="play-note" class="playerbar__note">
    Scripted replay of a real session. Every step below is an actual tool call.
    It will stop and wait for you partway through.
  </span>
  <button id="reset" type="button" class="btn btn--ghost">Reset</button>
</div>""")

# The agent transcript sits at the top of the triage column.
body_html = body_html.replace(
    '    <h2 class="col__title">Triage</h2>',
    '    <h2 class="col__title">Agent</h2>\n'
    '    <div id="transcript" class="card transcript"></div>\n\n'
    '    <h2 class="col__title col__title--spaced">Triage</h2>')

extra_css = """
/* ---- hosted preview only: the scripted agent -------------------------- */
.playerbar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 11px 22px; background: var(--panel); border-bottom: 1px solid var(--line);
}
.playerbar__note { color: var(--muted); font-size: 12.5px; max-width: 62ch; }
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

player_js = """
// ---------------------------------------------------------------------------
// Scripted agent, hosted preview only. It calls the registered tools exactly
// the way ChatGPT's browser does, waits where a real agent would wait, and
// hands control to you at the point the tools cannot resolve on their own.
// ---------------------------------------------------------------------------
const transcript = document.getElementById('transcript');
const playBtn = document.getElementById('play');
const resetBtn = document.getElementById('reset');
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
const run = (name, args) => document.modelContext.executeTool(
  { name }, args, {}).catch(() => TOOL_FALLBACK(name, args));

// The preview registers into a local map as well, so the script works whether
// or not a real WebMCP browser is attached.
function TOOL_FALLBACK(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  return tool.execute(args || {}, { signal: new AbortController().signal });
}

function resetAll() {
  transcript.innerHTML = '';
  state.openSubmissionId = null;
  state.log = [];
  resetRecord();
  render();
  say('you', 'Ready when you are.');
  playBtn.disabled = false;
  playBtn.textContent = 'Watch the agent work a submission';
  document.getElementById('question').classList.remove('waiting');
  running = false;
}

async function play() {
  if (running) return;
  running = true;
  playBtn.disabled = true;
  playBtn.textContent = 'Working…';
  transcript.innerHTML = '';

  say('you', 'Work the Cascade Millwork submission.');
  await wait(700);

  let t = say('agent', 'Looking at the queue…', true);
  await run('list_inbox'); await wait(650);
  t.remove(); say('agent', 'Found it — SUB-4502 from Northbridge Risk Partners. Opening it.');
  await run('open_submission', { submission_id: 'SUB-4502' }); await wait(800);

  t = say('agent', 'Two documents attached. Reading the application…', true);
  await run('read_attachment', { attachment_id: 'ATT-4502-A' }); await wait(500);
  t.remove(); t = say('agent', 'Now the loss run…', true);
  await run('read_attachment', { attachment_id: 'ATT-4502-B' }); await wait(600);
  t.remove(); say('agent', 'Both read. Writing what I found onto the record.');
  await wait(500);

  await run('update_submission', {
    named_insured: 'Cascade Millwork Inc.', entity_type: 'Corporation', state: 'MI',
    years_in_business: 19, effective_date: '10/01/2026', experience_mod: 1.18,
    governing_class: '2802', class_description: 'Carpentry shop - woodworking',
    annual_payroll: 2692000, employee_count: 55,
    losses_on_app: 'no', loss_run_years: 2, loss_run_claims: 4, loss_run_incurred: 92400,
  });
  await wait(1100);

  t = say('agent', 'Running your underwriting rules…', true);
  await run('check_submission'); await wait(800);
  t.remove();
  say('agent', 'Two problems. The application says no prior losses, but the loss run shows four claims and $92,400 incurred, including a finger amputation. And the FEIN was left blank.');
  await wait(1400);

  say('agent', 'I can read both documents but I cannot tell you which one is right. That is your call.');
  await wait(1000);

  await run('ask_underwriter', {
    field: 'fein',
    question: 'The application left the FEIN blank and the loss run does not carry it either. Can you pull it from the prior policy? And the loss disclosure on the application contradicts the loss run — which one should I trust?',
  });
  document.getElementById('question').classList.add('waiting');
  say('agent', 'Over to you — I have highlighted the FEIN field on the record. Fill it in, and set the loss disclosure to match whichever document you trust.');
  playBtn.disabled = false;
  playBtn.textContent = 'Continue once you have answered';
  playBtn.onclick = resume;
  running = false;
}

async function resume() {
  if (running) return;
  const r = evaluate();
  if (isBlank(state.record.fein)) {
    say('agent', 'Still waiting on the FEIN — it is the highlighted field on the record.');
    return;
  }
  if (r.conflicts.length) {
    say('agent', 'The loss disclosure still contradicts the loss run. Set "Losses disclosed on application" to whichever document you trust.');
    return;
  }
  running = true;
  playBtn.disabled = true;
  playBtn.textContent = 'Working…';
  document.getElementById('question').classList.remove('waiting');
  say('you', 'Done — FEIN is in, and the loss run is the one to trust.');
  await wait(700);

  let t = say('agent', 'Thanks. Re-running the rules…', true);
  await run('check_submission'); await wait(800);
  t.remove();
  say('agent', 'That clears the contradiction. What is left is the loss runs only cover two years, and you need three to firm up a quote — so this is an indication, not a quote.');
  await wait(1300);

  await run('propose_routing', {
    lane: 'indication',
    rationale: 'In appetite: class 2802, mod 1.18, $92,400 incurred — all inside the guidelines. The loss run only covers two policy years, so we can price a ballpark but cannot firm it up until the missing year comes in.',
  });
  say('agent', 'I have put Indication on screen with my reasoning. I am not routing it — approve or reject it and it is done.');
  playBtn.textContent = 'Start over';
  playBtn.disabled = false;
  playBtn.onclick = () => { playBtn.onclick = play; resetAll(); };
  running = false;
}

playBtn.onclick = play;
resetBtn.onclick = () => { playBtn.onclick = play; resetAll(); };
say('you', 'Ready when you are.');
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
