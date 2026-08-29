// ---------------------------------------------------------------------------
// ui.js — rendering and the human side of the desk. Every action an agent can
// take through a tool is a function in this file, and it is the same function
// the buttons and inputs call. There is no separate agent code path.
// ---------------------------------------------------------------------------
import {
  FIELDS, FIELD_KEYS, INBOX, LANES, state, evaluate, findSubmission,
  openSubmission, resetRecord, fieldLabel, fieldWhy, isBlank, resolveConflict,
  DESK_USER, AGENT_LIMITS, fieldNeeded,
  MAX_EXPERIENCE_MOD, MAX_INCURRED, MIN_LOSS_RUN_YEARS,
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
// The signed-in human, named in the header. The agent has no identity here: it
// borrows this one, and every action it takes is logged against it.
function renderWho() {
  $('#who-name').textContent = `${DESK_USER.name} · ${DESK_USER.role}`;
  $('#who-meta').textContent = `${DESK_USER.license} · signed in ${DESK_USER.signedInAt}`;
}

function renderLimits() {
  const box = $('#limits');
  if (box.dataset.done) return;   // static content, render once
  box.dataset.done = '1';
  const lead = el('p', 'limits__lead',
    'It has no password and no login of its own. It works inside the session you opened, '
    + 'with your permissions, and everything it does is logged under your name.');
  box.append(lead);
  const ul = el('ul', 'limits__list');
  for (const line of AGENT_LIMITS) ul.append(el('li', null, line));
  box.append(ul);
}

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
    const empty = el('div', 'empty');
    empty.append(el('div', 'empty__h', 'Pick one of the three above to begin'));
    empty.append(el('p', 'empty__p',
      'Each one is a real submission that lands in a different place. Watch the agent read the '
      + 'email and the attached PDFs, fill this record, and stop when it needs you. '
      + 'You can also click a submission in the queue and work it yourself.'));
    pane.append(empty);
    return;
  }
  const head = el('div', 'email__head');
  head.append(el('div', 'email__subject', sub.subject));
  head.append(el('div', 'email__from', `${sub.from} · received ${sub.received}`));
  pane.append(head);
  const body = el('pre', 'email__body email__body--clipped', sub.body);
  pane.append(body);
  const toggle = el('button', 'email__more', 'Show the whole email');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    const clipped = body.classList.toggle('email__body--clipped');
    toggle.textContent = clipped ? 'Show the whole email' : 'Show less';
  });
  pane.append(toggle);

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

export function resolveConflictByHand(code, choiceId, label, settled) {
  resolveConflict(code, choiceId, label, settled);
  logToolCall('(underwriter)', `${settled || label}`, 'human');
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
  focusField(field);
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

// --- The reply the agent writes and a person sends --------------------------
export function draftReply(subject, body) {
  state.reply = { subject, body, at: new Date() };
  state.replySent = null;
  render();
  $('#reply').scrollIntoView({ block: 'center', behavior: 'smooth' });
  return state.reply;
}

function sendReply() {
  if (!state.reply) return;
  state.replySent = new Date();
  logToolCall('(underwriter)', 'Sent the reply to the producer', 'human');
  render();
}

function renderReply() {
  const box = $('#reply');
  box.innerHTML = '';
  if (!state.reply) {
    box.append(el('p', 'muted', 'Nothing drafted yet.'));
    return;
  }
  const sub = openSubmission();
  box.append(el('div', 'reply__to', `To: ${sub ? sub.from : ''}`));
  box.append(el('div', 'reply__subject', state.reply.subject));
  box.append(el('pre', 'reply__body', state.reply.body));
  if (state.replySent) {
    box.append(el('div', 'reply__sent', `Sent by you at ${state.replySent.toLocaleTimeString()}`));
    return;
  }
  const actions = el('div', 'reply__actions');
  const send = el('button', 'btn btn--primary', 'Send it');
  send.type = 'button';
  send.addEventListener('click', sendReply);
  const edit = el('button', 'btn btn--ghost', 'Edit first');
  edit.type = 'button';
  edit.addEventListener('click', () => {
    const pre = box.querySelector('.reply__body');
    pre.contentEditable = 'true';
    pre.focus();
    pre.classList.add('reply__body--editing');
  });
  actions.append(send, edit);
  box.append(actions);
  box.append(el('p', 'reply__note', 'Your agent wrote this. It cannot send it.'));
}

// --- The risk, at a glance --------------------------------------------------
// An underwriter's first question is "what am I looking at". Seventeen text
// inputs do not answer it. These six numbers do, and watching them land while
// the agent reads is the clearest signal that anything is happening.
const money0 = v => {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? '$' + n.toLocaleString() : String(v);
};

function renderRisk() {
  const box = $('#risk');
  box.innerHTML = '';
  const r = state.openSubmissionId ? evaluate() : null;
  const rec = state.record;
  const has = k => !isBlank(rec[k]);

  const head = el('div', 'risk__head');
  const name = el('div', 'risk__name', has('named_insured') ? rec.named_insured : 'No submission open');
  if (!has('named_insured')) name.classList.add('risk__name--empty');
  head.append(name);
  if (r) {
    const chip = el('span', `risk__lane risk__lane--${r.lane}`, r.laneLabel);
    head.append(chip);
  }
  box.append(head);

  const sub = el('div', 'risk__sub');
  sub.textContent = has('governing_class')
    ? `Class ${rec.governing_class}${has('class_description') ? ' · ' + rec.class_description : ''}`
      + `${has('state') ? ' · ' + rec.state : ''}`
    : 'Class and operations not read yet';
  box.append(sub);

  const stats = el('div', 'risk__stats');
  const stat = (label, value, mods = '') => {
    const cell = el('div', 'stat' + mods);
    cell.append(el('div', 'stat__v', value));
    cell.append(el('div', 'stat__l', label));
    stats.append(cell);
  };
  stat('Annual payroll', has('annual_payroll') ? money0(rec.annual_payroll) : '—');
  stat('Employees', has('employee_count') ? rec.employee_count : '—');
  const mod = Number(rec.experience_mod);
  stat('Experience mod', has('experience_mod') ? Number(mod).toFixed(2) : '—',
    has('experience_mod') && mod > MAX_EXPERIENCE_MOD ? ' stat--bad' : '');
  stat('Incurred losses', has('loss_run_incurred') ? money0(rec.loss_run_incurred) : '—',
    has('loss_run_incurred') && Number(String(rec.loss_run_incurred).replace(/[$,]/g, '')) > MAX_INCURRED ? ' stat--bad' : '');
  stat('Loss run years', has('loss_run_years') ? `${rec.loss_run_years} of ${MIN_LOSS_RUN_YEARS}` : '—',
    has('loss_run_years') && Number(rec.loss_run_years) < MIN_LOSS_RUN_YEARS ? ' stat--soft' : '');
  stat('Effective', has('effective_date') ? rec.effective_date : '—');
  box.append(stats);
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
      if (f.needed === 'indicate' && isBlank(state.record[f.key])) wrap.classList.add('field--missing');
      if (f.needed === 'quote' && isBlank(state.record[f.key])) wrap.classList.add('field--toquote');

      const lab = el('label', 'field__label', f.label);
      lab.htmlFor = `f-${f.key}`;
      if (f.needed === 'indicate') lab.append(el('span', 'req', '*'));
      if (f.needed === 'quote') lab.append(el('span', 'req req--quote', '†'));
      wrap.append(lab);

      const asked = pending && pending.field === f.key;
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
        input.placeholder = asked ? `Type the ${f.label} here`
          : f.needed === 'indicate' ? 'needed to indicate'
          : f.needed === 'quote' ? 'needed to quote'
          : 'optional';
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

      // When the agent has asked for this one, say so at the field, not in a
      // panel somewhere else on the page.
      if (asked) {
        const note = el('div', 'fieldnote');
        const decision = evaluate().conflicts.some(c => c.fields.includes(f.key));
        note.append(el('div', 'fieldnote__head', decision
          ? 'Your agent needs you to decide this. The two documents are on the right.'
          : 'Your agent needs this. Type it in the box above.'));
        note.append(el('p', 'fieldnote__ask', pending.question));
        if (pending.why) note.append(el('p', 'fieldnote__why', pending.why));
        box.append(note);
      }
    }
    pane.append(box);
  }
}

// --- Rules panel ------------------------------------------------------------
function renderRules() {
  const r = evaluate();
  $('#meter-fill').style.width = `${r.completeness}%`;
  $('#meter-label').textContent = r.requiredRemaining === 0
    ? `${r.completeness}% captured · nothing outstanding`
    : `${r.completeness}% captured · ${r.requiredRemaining} field${r.requiredRemaining === 1 ? '' : 's'} still to come from the producer`;

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
    box.append(el('div', 'conflict__title', 'These two documents disagree'));
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
      btn.addEventListener('click', () => resolveConflictByHand(c.code, choice.id, choice.label, choice.settled));
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
    settled.append(el('div', 'finding__title', 'You settled this'));
    const ul = el('ul');
    ul.append(el('li', null, `${res.settled}. Both answers stay on the file, so it is clear what each document said.`));
    settled.append(ul);
    findings.append(settled);
  }

  add('missing', 'Missing before we can even indicate', r.missingToIndicate.map(k => fieldLabel(k)));
  const toQuote = [
    ...r.missingToQuote.map(k => `${fieldLabel(k)} — ask the producer`),
    ...r.quoteNotes.map(n => n.message),
  ];
  add('note', 'Needed to turn the indication into a quote', toQuote);
  if (!findings.children.length && state.openSubmissionId) {
    findings.append(el('p', 'muted', 'No open items. Everything needed to quote is on the record.'));
  }

  // Question from the agent
  const qbox = $('#question');
  qbox.innerHTML = '';
  if (state.pendingQuestion) {
    const q = state.pendingQuestion;
    qbox.hidden = false;
    const isDecision = evaluate().conflicts.some(c => c.fields.includes(q.field));
    qbox.append(el('div', 'question__label', 'Your turn'));
    qbox.append(el('div', 'question__do',
      isDecision ? 'Pick which document to go with' : `Enter the ${fieldLabel(q.field)}`));
    qbox.append(el('p', 'question__text', q.question));
    if (q.why) {
      const why = el('div', 'question__why');
      why.append(el('span', 'question__whylabel', 'Why it is needed'));
      why.append(el('p', 'question__whytext', q.why));
      qbox.append(why);
    }
    const actions = el('div', 'question__actions');
    const go = el('button', 'btn btn--primary',
      isDecision ? 'Show me the two documents' : `Go to ${fieldLabel(q.field)}`);
    go.type = 'button';
    go.addEventListener('click', () => {
      if (isDecision) $('#findings').scrollIntoView({ block: 'center', behavior: 'smooth' });
      else focusField(q.field);
    });
    const dismiss = el('button', 'btn btn--ghost', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', clearQuestion);
    actions.append(go, dismiss);
    qbox.append(actions);
    qbox.append(el('p', 'question__pickup',
      'Type it into the record, or just tell your agent. Either way it picks the answer up on its next check.'));
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
// Stays on screen while you scroll, and names what is actually waiting rather
// than counting it. Each chip takes you to the thing.
function renderActionBar() {
  const bar = $('#actionbar');
  bar.innerHTML = '';
  if (!state.openSubmissionId) { bar.hidden = true; return; }

  const r = evaluate();
  const jobs = [];

  for (const c of r.conflicts) {
    jobs.push({
      text: 'Decide which document is right',
      go: () => $('#findings').scrollIntoView({ block: 'center', behavior: 'smooth' }),
    });
  }
  // If a conflict already claimed this field, its chip says it better.
  const claimed = r.conflicts.some(c => c.fields.includes(
    state.pendingQuestion ? state.pendingQuestion.field : null));
  if (state.pendingQuestion && !claimed) {
    jobs.push({
      text: `Enter the ${fieldLabel(state.pendingQuestion.field)}`,
      go: () => focusField(state.pendingQuestion.field),
    });
  }
  // Missing fields are deliberately NOT listed here. If a value is absent from
  // every document, the underwriter cannot supply it either - it goes on the
  // list the agent sends back to the producer.
  if (r.appetite.length) {
    jobs.push({
      text: 'Decline it, or override the appetite rule',
      go: () => $('#findings').scrollIntoView({ block: 'center', behavior: 'smooth' }),
    });
  }
  if (!jobs.length && state.proposal && !state.decision) {
    jobs.push({
      text: 'Approve or reject the routing',
      go: () => $('#routing').scrollIntoView({ block: 'center', behavior: 'smooth' }),
    });
  }
  if (!jobs.length && state.reply && !state.replySent) {
    jobs.push({
      text: 'Read and send the reply',
      go: () => $('#reply').scrollIntoView({ block: 'center', behavior: 'smooth' }),
    });
  }

  if (!jobs.length) {
    bar.hidden = false;
    bar.className = 'actionbar actionbar--clear';
    bar.append(el('span', 'actionbar__label', 'Nothing waiting on you'));
    return;
  }

  bar.hidden = false;
  bar.className = 'actionbar';
  bar.append(el('span', 'actionbar__label',
    jobs.length === 1 ? 'Your turn — 1 thing' : `Your turn — ${jobs.length} things`));
  for (const job of jobs.slice(0, 4)) {
    const chip = el('button', 'actionchip', job.text);
    chip.type = 'button';
    chip.addEventListener('click', job.go);
    bar.append(chip);
  }
}

function focusField(key) {
  const input = document.querySelector(`[data-field="${key}"] input, [data-field="${key}"] select`);
  if (!input) return;
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus();
}

export function render() {
  renderWho();
  renderLimits();
  renderActionBar();
  renderInbox();
  renderEmail();
  renderRisk();
  renderRecord();
  renderRules();
  renderReply();
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
