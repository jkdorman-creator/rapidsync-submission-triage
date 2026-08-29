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
_UNUSED_PLAYER_BAR = """<div class="playerbar">
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
assert 'data-play="problem"' in body_html, "index.html should carry the player bar"

extra_css = """
/* ---- hosted preview only ---------------------------------------------- */
.waiting { outline: 2px solid var(--ask); outline-offset: 3px; border-radius: 12px; }
"""

demo_js = demodule((ROOT / "assets/demo.js").read_text())

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
{state_js}
{ui_js}
{webmcp_js}
await registerAll();
{demo_js}
</script>
"""

OUT.write_text(html)
print(f"wrote {OUT} ({len(html):,} bytes)")
