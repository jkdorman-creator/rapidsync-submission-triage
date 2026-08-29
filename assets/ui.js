// ---------------------------------------------------------------------------
// ui.js — rendering and the human side of the desk. Every action an agent can
// take through a tool is a function in this file, and it is the same function
// the buttons and inputs call. There is no separate agent code path.
// ---------------------------------------------------------------------------
import {
  FIELDS, FIELD_KEYS, INBOX, LANES, state, evaluate, findSubmission,
  openSubmission, resetRecord, fieldLabel, fieldWhy, isBlank, resolveConflict,
} from './state.js';

// Money reads better with separators. State keeps whatever was written; only
// the display is dressed up, and the rules parse through either form.
const asMoney = v => {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? '$' + n.toLocaleString() : String(v);
};

// PDF.js is vendored locally (assets/vendor) rather than pulled from a CDN, and
// it is loaded lazily the first time a document is opened. A slow or blocked
// library must never stop the tools from registering.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdf.min.mjs').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
      return mod;
    });
  }
  return pdfjsPromise;
}

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// --- Activity log -----------------------------------------------------------
export function logToolCall(name, detail, kind = 'call') {
  if (detail && detail.length > 90) detail = detail.slice(0, 87).replace(/,?\s*[^,]*$/, '') + '…';
  state.log.unshift({ name, detail, kind, at: new Date() });
  state.log = state.log.slice(0, 40);
  renderLog();
}

function renderLog() {
  const box = $('#activity');
  box.innerHTML = '';
  if (state.log.length === 0) {
    box.append(el('p', 'muted', 'No tool calls yet. Ask your agent to work the queue.'));
    return;
  }
  for (const entry of state.log) {
    const row = el('div', `logrow logrow--${entry.kind}`);
    row.append(el('code', 'logname', entry.name));
    row.append(el('span', 'logdetail', entry.detail));
    row.append(el('time', 'logtime', entry.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
    box.append(row);
  }
}

// --- Inbox ------------------------------------------------------------------
function renderInbox() {
  const list = $('#inbox');
  list.innerHTML = '';
  for (const sub of INBOX) {
    const item = el('button', 'mail' + (sub.id === state.openSubmissionId ? ' mail--open' : ''));
    item.type = 'button';
    const top = el('div', 'mail__top');
    top.append(el('span', 'mail__from', sub.agency));
    top.append(el('span', 'mail__id', sub.id));
    item.append(top);
    item.append(el('div', 'mail__subject', sub.subject));
    const meta = el('div', 'mail__meta');
    meta.append(el('span', null, `${sub.attachments.length} attachment${sub.attachments.length === 1 ? '' : 's'}`));
    meta.append(el('span', null, sub.received));
    item.append(meta);
    item.addEventListener('click', () => {
      openSubmissionById(sub.id);
      logToolCall('(underwriter)', `Opened ${sub.id} by hand`, 'human');
    });
    list.append(item);
  }
}

// --- Opening a submission ---------------------------------------------------
export function openSubmissionById(id) {
  const sub = findSubmission(id);
  if (!sub) return null;
  state.openSubmissionId = id;
  resetRecord();
  // The two facts the desk knows without reading anything.
  state.record.agency_name = sub.agency;
  state.record.agent_email = (sub.from.match(/<(.+)>/) || [null, sub.from])[1];
  state.provenance.agency_name = 'email header';
  state.provenance.agent_email = 'email header';
  render();
  return sub;
}

function renderEmail() {
  const pane = $('#email');
  const sub = openSubmission();
  pane.innerHTML = '';
  if (!sub) {
    pane.append(el('p', 'muted', 'Nothing open. Pick a submission from the queue, or ask your agent to.'));
    return;
  }
  const head = el('div', 'email__head');
  head.append(el('div', 'email__subject', sub.subject));
  head.append(el('div', 'email__from', `${sub.from} · received ${sub.received}`));
  pane.append(head);
  pane.append(el('pre', 'email__body', sub.body));

  const atts = el('div', 'atts');
  for (const a of sub.attachments) {
    const chip = el('button', 'att');
    chip.type = 'button';
    chip.append(el('span', 'att__name', a.name));
    chip.append(el('span', 'att__kind', a.kind));
    chip.addEventListener('click', async () => {
      chip.classList.add('att--busy');
      const text = await extractAttachment(a.id);
      chip.classList.remove('att--busy');
      logToolCall('(underwriter)', `Read ${a.name} by hand — ${text.length} characters`, 'human');
      showDocument(a.name, text);
    });
    atts.append(chip);
  }
  pane.append(atts);
}

function showDocument(name, text) {
  const dlg = $('#doc-modal');
  $('#doc-title').textContent = name;
  const body = $('#doc-body');
  body.className = 'modal__body';
  body.textContent = text;
  dlg.showModal();
}

// Both documents, side by side, so a contradiction can be checked against the
// source text instead of against our summary of it.
export function compareDocuments() {
  const docs = Object.values(state.documents);
  if (docs.length === 0) return false;
  const dlg = $('#doc-modal');
  $('#doc-title').textContent = 'The documents, side by side';
  const body = $('#doc-body');
  body.className = 'modal__body modal__body--compare';
  body.textContent = '';
  for (const doc of docs) {
    const col = el('div', 'compare__col');
    const head = el('div', 'compare__head');
    head.append(el('strong', null, doc.name));
    head.append(el('span', 'compare__kind', doc.kind));
    col.append(head);
    col.append(el('pre', 'compare__text', doc.text));
    body.append(col);
  }
  dlg.showModal();
  return true;
}

export function resolveConflictByHand(code, choiceId, label) {
  resolveConflict(code, choiceId, label);
  logToolCall('(underwriter)', `Settled the contradiction — ${label}`, 'human');
  state.proposal = null;
  state.decision = null;
  render();
}

// --- Reading a PDF. The page can do this; the agent cannot. -----------------
export async function extractAttachment(attachmentId) {
  const sub = openSubmission();
  if (!sub) throw new Error('no submission open');
  const att = sub.attachments.find(a => a.id === attachmentId);
  if (!att) throw new Error('no such attachment');
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument(att.url).promise;
  const chunks = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = [], lastY = null;
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { chunks.push(line.join(' ')); line = []; }
      line.push(item.str);
      lastY = y;
    }
    if (line.length) chunks.push(line.join(' '));
  }
  const text = chunks.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  state.documents[attachmentId] = { name: att.name, kind: att.kind, text };
  return text;
}

// Exposed so the build step can capture exactly what PDF.js produces.
if (typeof window !== 'undefined') window.__extractForBuild = extractAttachment;

// --- Writing to the record --------------------------------------------------
export function setFields(values, source = 'agent') {
  const applied = [];
  const rejected = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (!FIELD_KEYS.includes(key)) { rejected.push(key); continue; }
    if (value === null || value === undefined || String(value).trim() === '') continue;
    state.record[key] = String(value).trim();
    state.provenance[key] = source;
    applied.push(key);
  }
  if (applied.length) {
    state.proposal = null;   // any new fact invalidates a pending proposal
    state.decision = null;
  }
  render();
  flash(applied);
  return { applied, rejected };
}

function flash(keys) {
  for (const k of keys) {
    const node = document.querySelector(`[data-field="${k}"]`);
    if (!node) continue;
    node.classList.remove('field--flash');
    void node.offsetWidth;
    node.classList.add('field--flash');
  }
}

// --- Asking the human -------------------------------------------------------
export function askUnderwriter(field, question, why) {
  state.pendingQuestion = { field, question, why: why || fieldWhy(field) };
  render();
  const input = document.querySelector(`[data-field="${field}"] input, [data-field="${field}"] select`);
  if (input) {
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus();
  }
  return true;
}

export function clearQuestion() {
  state.pendingQuestion = null;
  render();
}

// --- Routing ----------------------------------------------------------------
export function proposeRoute(lane, rationale) {
  state.proposal = { lane, rationale, at: new Date() };
  state.decision = null;
  render();
  $('#routing').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function confirmRoute() {
  if (!state.proposal) return null;
  state.decision = { lane: state.proposal.lane, at: new Date() };
  logToolCall('(underwriter)', `Approved routing to ${LANES[state.proposal.lane].label}`, 'human');
  render();
  return state.decision;
}

export function rejectRoute() {
  if (!state.proposal) return;
  logToolCall('(underwriter)', `Rejected routing to ${LANES[state.proposal.lane].label}`, 'human');
  state.proposal = null;
  render();
}

// --- Record form ------------------------------------------------------------
function renderRecord() {
  const pane = $('#record');
  pane.innerHTML = '';
  const groups = [...new Set(FIELDS.map(f => f.group))];
  const pending = state.pendingQuestion;

  for (const group of groups) {
    const box = el('section', 'group');
    box.append(el('h3', 'group__title', group));
    for (const f of FIELDS.filter(x => x.group === group)) {
      const wrap = el('div', 'field');
      wrap.dataset.field = f.key;
      if (pending && pending.field === f.key) wrap.classList.add('field--asked');
      if (f.required && isBlank(state.record[f.key])) wrap.classList.add('field--missing');

      const lab = el('label', 'field__label', f.label);
      lab.htmlFor = `f-${f.key}`;
      if (f.required) lab.append(el('span', 'req', '*'));
      wrap.append(lab);

      let input;
      if (f.type === 'yesno') {
        input = el('select', 'field__input');
        for (const [v, t] of [['', '—'], ['yes', 'Yes'], ['no', 'No']]) {
          const o = el('option', null, t); o.value = v; input.append(o);
        }
        input.value = state.record[f.key] || '';
      } else {
        input = el('input', 'field__input');
        input.type = 'text';
        const raw = state.record[f.key];
        input.value = isBlank(raw) ? '' : (f.type === 'money' ? asMoney(raw) : raw);
        input.placeholder = f.required ? 'required' : 'optional';
      }
      input.id = `f-${f.key}`;
      input.addEventListener('change', () => {
        state.record[f.key] = input.value.trim() === '' ? null : input.value.trim();
        state.provenance[f.key] = 'underwriter';
        state.proposal = null;
        state.decision = null;
        if (pending && pending.field === f.key) state.pendingQuestion = null;
        logToolCall('(underwriter)', `Set ${f.label} by hand`, 'human');
        render();
      });
      wrap.append(input);

      const src = state.provenance[f.key];
      if (src) wrap.append(el('span', 'field__src', src === 'underwriter' ? 'entered by you' : `from ${src}`));
      box.append(wrap);
    }
    pane.append(box);
  }
}

// --- Rules panel ------------------------------------------------------------
function renderRules() {
  const r = evaluate();
  $('#meter-fill').style.width = `${r.completeness}%`;
  $('#meter-label').textContent = `${r.completeness}% captured · ${r.requiredRemaining} required field${r.requiredRemaining === 1 ? '' : 's'} still open`;

  for (const key of Object.keys(LANES)) {
    const chip = document.querySelector(`[data-lane="${key}"]`);
    chip.classList.toggle('lane--active', key === r.lane && state.openSubmissionId !== null);
  }

  const findings = $('#findings');
  findings.innerHTML = '';
  const add = (cls, title, items) => {
    if (!items.length) return;
    const b = el('div', `finding finding--${cls}`);
    b.append(el('div', 'finding__title', title));
    const ul = el('ul');
    for (const i of items) ul.append(el('li', null, typeof i === 'string' ? i : i.message));
    b.append(ul);
    findings.append(b);
  };
  add('stop', 'Appetite', r.appetite);

  // A contradiction is not a bullet point. Show what each document actually
  // says, and give the underwriter the two buttons that settle it.
  for (const c of r.conflicts) {
    const box = el('div', 'conflict');
    box.append(el('div', 'conflict__title', 'Contradiction — only you can settle this'));
    box.append(el('p', 'conflict__message', c.message));

    if (c.evidence && c.evidence.length) {
      const ev = el('div', 'evidence');
      for (const e of c.evidence) {
        const card = el('div', `evidence__item evidence__item--${e.side}`);
        card.append(el('div', 'evidence__source', e.source));
        card.append(el('q', 'evidence__quote', e.quote));
        ev.append(card);
      }
      box.append(ev);
    } else {
      box.append(el('p', 'conflict__hint',
        'Read both documents to see the wording each one uses.'));
    }

    const actions = el('div', 'conflict__actions');
    for (const choice of c.choices || []) {
      const btn = el('button', 'btn btn--choice');
      btn.type = 'button';
      btn.append(el('span', 'btn__label', choice.label));
      btn.append(el('span', 'btn__detail', choice.detail));
      btn.addEventListener('click', () => resolveConflictByHand(c.code, choice.id, choice.label));
      actions.append(btn);
    }
    box.append(actions);

    if (Object.keys(state.documents).length) {
      const compare = el('button', 'btn btn--ghost btn--wide', 'Check both documents side by side');
      compare.type = 'button';
      compare.addEventListener('click', compareDocuments);
      box.append(compare);
    }
    findings.append(box);
  }

  // Once settled, say so and leave the trail.
  for (const [code, res] of Object.entries(state.resolutions)) {
    const settled = el('div', 'finding finding--settled');
    settled.append(el('div', 'finding__title', 'Contradiction settled by you'));
    const ul = el('ul');
    ul.append(el('li', null, `${res.label}. Both readings stay on the record.`));
    settled.append(ul);
    findings.append(settled);
  }

  add('missing', 'Missing to quote', r.missing.map(k => fieldLabel(k)));
  add('note', 'Limits what we can offer', r.notes);
  if (!findings.children.length && state.openSubmissionId) {
    findings.append(el('p', 'muted', 'No open items. Everything needed to quote is on the record.'));
  }

  // Question from the agent
  const qbox = $('#question');
  qbox.innerHTML = '';
  if (state.pendingQuestion) {
    const q = state.pendingQuestion;
    qbox.hidden = false;
    qbox.append(el('div', 'question__label', 'Action needed from you'));
    qbox.append(el('div', 'question__do', `Enter the ${fieldLabel(q.field).toLowerCase()}`));
    qbox.append(el('p', 'question__text', q.question));
    if (q.why) {
      const why = el('div', 'question__why');
      why.append(el('span', 'question__whylabel', 'Why it is needed'));
      why.append(el('p', 'question__whytext', q.why));
      qbox.append(why);
    }
    const actions = el('div', 'question__actions');
    const go = el('button', 'btn btn--primary', `Go to ${fieldLabel(q.field)}`);
    go.type = 'button';
    go.addEventListener('click', () => {
      const input = document.querySelector(`[data-field="${q.field}"] input, [data-field="${q.field}"] select`);
      if (input) { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus(); }
    });
    const dismiss = el('button', 'btn btn--ghost', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', clearQuestion);
    actions.append(go, dismiss);
    qbox.append(actions);
    qbox.append(el('p', 'question__pickup',
      'Type it into the record and your agent picks it up the next time it checks. You can also just tell the agent.'));
  } else {
    qbox.hidden = true;
  }

  // Routing
  const routing = $('#routing');
  routing.innerHTML = '';
  if (state.decision) {
    const done = el('div', 'decision');
    done.append(el('div', 'decision__lane', LANES[state.decision.lane].label));
    done.append(el('div', 'decision__meta', `Routed by the underwriter at ${state.decision.at.toLocaleTimeString()}`));
    routing.append(done);
  } else if (state.proposal) {
    const card = el('div', 'proposal');
    card.append(el('div', 'proposal__head', 'Your agent proposes'));
    card.append(el('div', 'proposal__lane', LANES[state.proposal.lane].label));
    card.append(el('p', 'proposal__why', state.proposal.rationale));
    const actions = el('div', 'proposal__actions');
    const yes = el('button', 'btn btn--primary', 'Approve and route');
    yes.type = 'button';
    yes.addEventListener('click', confirmRoute);
    const no = el('button', 'btn btn--ghost', 'Reject');
    no.type = 'button';
    no.addEventListener('click', rejectRoute);
    actions.append(yes, no);
    card.append(actions);
    card.append(el('p', 'proposal__note', 'Nothing is routed until you click. The agent cannot make this call.'));
    routing.append(card);
  } else {
    routing.append(el('p', 'muted', 'No routing proposed yet.'));
  }
}

// --- Top-level render -------------------------------------------------------
function renderAlert() {
  const r = evaluate();
  const needs = (state.pendingQuestion ? 1 : 0) + r.conflicts.length;
  const pill = $('#needs-you');
  if (!state.openSubmissionId || needs === 0) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.textContent = needs === 1 ? '1 thing needs you' : `${needs} things need you`;
  pill.onclick = () => {
    const target = state.pendingQuestion ? $('#question') : $('#findings');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
}

export function render() {
  renderAlert();
  renderInbox();
  renderEmail();
  renderRecord();
  renderRules();
}

export function setToolStatus(text, ok = true) {
  const pill = $('#tool-status');
  pill.textContent = text;
  pill.classList.toggle('pill--ok', ok);
  pill.classList.toggle('pill--off', !ok);
}

$('#doc-close').addEventListener('click', () => $('#doc-modal').close());
render();
renderLog();
