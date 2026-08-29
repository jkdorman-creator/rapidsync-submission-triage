// ---------------------------------------------------------------------------
// state.js — the submission record, the seeded queue, and the underwriting
// rules. Everything here is deterministic. No model judgment lives in this
// file: the agent gathers facts, this code decides what they mean.
// ---------------------------------------------------------------------------

export const FIELDS = [
  { key: 'named_insured',      label: 'Named insured',        group: 'Applicant', needed: 'indicate', type: 'text',
    why: 'The policy is issued in this exact legal name. A quote in the wrong name has to be reissued.' },
  { key: 'fein',               label: 'FEIN',                 group: 'Applicant', needed: 'quote',    type: 'text',
    why: 'Carriers bind and file the policy on the FEIN, and it is how the experience mod is verified with the rating bureau. Without it this cannot be rated, and a quote issued against the wrong entity has to be pulled.' },
  { key: 'entity_type',        label: 'Entity type',          group: 'Applicant', needed: 'quote',    type: 'text',
    why: 'Decides how owners and officers are included or excluded, which changes the payroll we rate on.' },
  { key: 'state',              label: 'State(s) of operation',group: 'Applicant', needed: 'indicate', type: 'text',
    why: 'Rates, forms and the governing rating bureau all change by state.' },
  { key: 'years_in_business',  label: 'Years in business',    group: 'Applicant', needed: null,       type: 'number' },

  { key: 'effective_date',     label: 'Effective date',       group: 'Coverage',  needed: 'indicate', type: 'text',
    why: 'Sets which rate filing applies, and whether we can even meet the date.' },
  { key: 'experience_mod',     label: 'Experience mod',       group: 'Coverage',  needed: 'indicate', type: 'number',
    why: 'Multiplies the manual premium, and it is the first appetite test. Guessing at it produces a quote we cannot stand behind.' },

  { key: 'governing_class',    label: 'Governing class code', group: 'Exposure',  needed: 'indicate', type: 'text',
    why: 'The class carrying the most payroll decides the base rate and whether the risk is in appetite at all.' },
  { key: 'class_description',  label: 'Class description',    group: 'Exposure',  needed: null,       type: 'text' },
  { key: 'annual_payroll',     label: 'Total annual payroll', group: 'Exposure',  needed: 'indicate', type: 'money',
    why: 'Premium is rated per $100 of payroll. No payroll, no premium.' },
  { key: 'employee_count',     label: 'Employee count',       group: 'Exposure',  needed: 'indicate', type: 'number',
    why: 'Sanity-checks the payroll and drives which carriers will look at it.' },

  { key: 'losses_on_app',      label: 'Losses disclosed on application', group: 'Loss history', needed: 'indicate', type: 'yesno',
    why: 'What the application itself says about past losses. We leave it as written even when a loss run disagrees, so the disagreement stays on the file.' },
  { key: 'loss_run_years',     label: 'Years of loss runs provided',     group: 'Loss history', needed: 'indicate', type: 'number',
    why: 'Three years is the minimum to firm up a quote. Fewer means an indication at best.' },
  { key: 'loss_run_claims',    label: 'Claims shown on loss runs',       group: 'Loss history', needed: null,       type: 'number' },
  { key: 'loss_run_incurred',  label: 'Total incurred on loss runs',     group: 'Loss history', needed: null,       type: 'money' },

  { key: 'agency_name',        label: 'Producing agency',     group: 'Producer',  needed: null,       type: 'text' },
  { key: 'agent_email',        label: 'Producer email',       group: 'Producer',  needed: null,       type: 'text' },
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
const byKey = Object.fromEntries(FIELDS.map(f => [f.key, f]));
export const fieldLabel = k => (byKey[k] ? byKey[k].label : k);
export const fieldType  = k => (byKey[k] ? byKey[k].type : 'text');
export const fieldWhy   = k => (byKey[k] ? byKey[k].why : null);
export const fieldNeeded = k => (byKey[k] ? byKey[k].needed : null);

// --- RapidSync WC appetite. Deterministic, and visible to the underwriter. ---
export const PROHIBITED_CLASSES = {
  '5551': 'Roofing',
  '5057': 'Iron or steel erection',
  '6217': 'Excavation',
  '7219': 'Trucking - long haul',
  '9534': 'Mobile crane operation',
};
export const MAX_EXPERIENCE_MOD = 1.35;
export const MAX_INCURRED = 150000;
export const MIN_LOSS_RUN_YEARS = 3;

export const LANES = {
  quote_now:     { label: 'Quote Now',     blurb: 'Everything checks out. Send it to rating.' },
  indication:    { label: 'Indication',    blurb: 'Enough to price a ballpark. Ask the producer for the rest.' },
  send_for_info: { label: 'Send for Info', blurb: 'Go back to the producer before anything else.' },
  likely_decline:{ label: 'Likely Decline',blurb: 'Outside appetite. Decline politely and fast.' },
};

// --- Live state -------------------------------------------------------------
// The person at the desk. They signed in; the agent did not, and cannot.
export const DESK_USER = {
  name: 'J. Dorman',
  role: 'Underwriter',
  license: 'MI producer #0847213',
  signedInAt: '7:52 AM',
};

// What the agent is structurally unable to do here. Shown to the user, because
// the honest answer to "what is this thing allowed to do" should be on screen.
export const AGENT_LIMITS = [
  'Sign in, or see your password. You signed in; it works inside that session.',
  'Route a submission. It proposes a lane; you approve it.',
  'Settle a disagreement between two documents. There is no tool for that.',
  'Send anything to a producer or a carrier. It drafts; you send.',
  'Reach any other site or tab. Its tools exist only on this page.',
];

export const state = {
  openSubmissionId: null,
  record: Object.fromEntries(FIELD_KEYS.map(k => [k, null])),
  provenance: {},        // field -> where the value came from
  proposal: null,        // { lane, rationale, decidedBy }
  decision: null,        // { lane, at } once a human confirms
  pendingQuestion: null, // { field, question, why }
  documents: {},         // attachmentId -> { name, kind, text } once read
  reply: null,           // { subject, body, at } drafted by the agent, sent by a person
  replySent: null,
  resolutions: {},       // conflict code -> { trusted, label, at, by }
  log: [],               // tool-call activity
};

export function resetRecord() {
  state.record = Object.fromEntries(FIELD_KEYS.map(k => [k, null]));
  state.provenance = {};
  state.proposal = null;
  state.decision = null;
  state.pendingQuestion = null;
  state.documents = {};
  state.resolutions = {};
  state.reply = null;
  state.replySent = null;
}

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// --- The rules engine -------------------------------------------------------
export function evaluate(record = state.record) {
  // Two thresholds, not one. You can price a ballpark on less than you need to
  // put a firm number in writing, and telling those apart is what lets the desk
  // answer today instead of going quiet until every box is filled.
  const missingToIndicate = FIELDS
    .filter(f => f.needed === 'indicate' && isBlank(record[f.key])).map(f => f.key);
  const missingToQuote = FIELDS
    .filter(f => f.needed === 'quote' && isBlank(record[f.key])).map(f => f.key);

  const conflicts = [];
  const appetite = [];
  const quoteNotes = [];

  const cls = record.governing_class ? String(record.governing_class).trim() : null;
  if (cls && PROHIBITED_CLASSES[cls]) {
    appetite.push({
      code: 'PROHIBITED_CLASS',
      message: `Class ${cls} (${PROHIBITED_CLASSES[cls]}) is on the prohibited list.`,
      fields: ['governing_class'],
    });
  }

  const incurred = num(record.loss_run_incurred);
  const mod = num(record.experience_mod);
  if (mod !== null && mod > MAX_EXPERIENCE_MOD) {
    appetite.push({
      code: 'HIGH_MOD',
      message: `Experience mod ${mod.toFixed(2)} is above the ${MAX_EXPERIENCE_MOD} maximum.`,
      fields: ['experience_mod'],
    });
  }
  if (incurred !== null && incurred > MAX_INCURRED) {
    appetite.push({
      code: 'LOSS_SEVERITY',
      message: `Total incurred of $${incurred.toLocaleString()} exceeds the $${MAX_INCURRED.toLocaleString()} threshold.`,
      fields: ['loss_run_incurred'],
    });
  }

  // The contradiction the agent cannot resolve on its own. It stays open until a
  // person picks the document that governs - and we keep both readings on the
  // record either way, so the disagreement never disappears quietly.
  const claims = num(record.loss_run_claims);
  if (record.losses_on_app === 'no' && claims !== null && claims > 0
      && !state.resolutions.LOSS_DISCLOSURE_MISMATCH) {
    conflicts.push({
      code: 'LOSS_DISCLOSURE_MISMATCH',
      message: `The application says there were no losses. The loss run shows ${claims} claim${claims === 1 ? '' : 's'}${incurred !== null ? `, $${incurred.toLocaleString()} paid and reserved` : ''}. They cannot both be right. Pick the one to go with.`,
      fields: ['losses_on_app', 'loss_run_claims'],
      evidence: evidenceForLossMismatch(),
      choices: [
        { id: 'loss_run', label: 'Use the loss run',
          detail: 'The application answer is wrong or out of date. Price the claims in.',
          settled: 'You went with the loss run' },
        { id: 'application', label: 'Use the application',
          detail: 'The loss run is for a different company or a different period. Leave the claims out.',
          settled: 'You went with the application' },
      ],
    });
  }

  const yearsProvided = num(record.loss_run_years);
  if (yearsProvided !== null && yearsProvided < MIN_LOSS_RUN_YEARS) {
    quoteNotes.push({
      code: 'SHORT_LOSS_HISTORY',
      message: `Only ${yearsProvided} year${yearsProvided === 1 ? '' : 's'} of loss runs. ${MIN_LOSS_RUN_YEARS} are needed for a firm quote.`,
      fields: ['loss_run_years'],
    });
  }

  // Order matters: get out of the way of risks you will never write, then stop
  // on anything a person has to settle, then decide how firm an answer we owe.
  let lane;
  if (appetite.length) lane = 'likely_decline';
  else if (conflicts.length) lane = 'send_for_info';
  else if (missingToIndicate.length) lane = 'send_for_info';
  else if (missingToQuote.length || quoteNotes.length) lane = 'indication';
  else lane = 'quote_now';

  const filled = FIELD_KEYS.filter(k => !isBlank(record[k])).length;
  // Everything standing between here and a firm quote, in one list the reply
  // can be written from.
  const neededToQuote = [
    ...missingToIndicate.map(k => ({ code: 'MISSING', field: k, message: fieldLabel(k) })),
    ...missingToQuote.map(k => ({ code: 'MISSING', field: k, message: fieldLabel(k) })),
    ...quoteNotes,
  ];

  return {
    lane,
    laneLabel: LANES[lane].label,
    missingToIndicate,
    missingToQuote,
    quoteNotes,
    neededToQuote,
    conflicts,
    appetite,
    completeness: Math.round((filled / FIELD_KEYS.length) * 100),
    requiredRemaining: missingToIndicate.length + missingToQuote.length,
  };
}

// Finds the line in each document that speaks to the loss question, so the
// underwriter is deciding against the source text and not a summary of it.
function evidenceForLossMismatch() {
  const out = [];
  // Up to two matching lines, so a bare column of figures arrives with the
  // line that explains it.
  const grab = (doc, patterns) => {
    if (!doc || !doc.text) return null;
    const lines = doc.text.split('\n');
    const hits = [];
    for (const re of patterns) {
      const hit = lines.find(l => re.test(l) && !hits.includes(l.trim()));
      if (hit) hits.push(hit.trim());
      if (hits.length === 2) break;
    }
    return hits.length ? hits.join('  ·  ') : null;
  };
  for (const doc of Object.values(state.documents)) {
    if (/application/i.test(doc.kind)) {
      const quote = grab(doc, [/losses in past/i, /claims reported/i, /number of claims/i]);
      if (quote) out.push({ side: 'application', source: doc.name, quote });
    }
    if (/loss run/i.test(doc.kind)) {
      const quote = grab(doc, [/total incurred/i, /TOTAL\s*[-–]\s*\d+\s*claims?/i, /open claims/i]);
      if (quote) out.push({ side: 'loss_run', source: doc.name, quote });
    }
  }
  return out;
}

export function resolveConflict(code, choiceId, label, settled) {
  state.resolutions[code] = { trusted: choiceId, label, settled: settled || label, at: new Date(), by: 'underwriter' };
  return state.resolutions[code];
}

export function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// --- The seeded queue -------------------------------------------------------
export const INBOX = [
  {
    id: 'SUB-4471',
    from: 'Dana Whitfield <dwhitfield@prairiestate.example>',
    agency: 'Prairie State Insurance Group',
    received: '2026-08-27 09:14',
    subject: 'New WC submission - Harbor & Vine Restaurant Group - 11/1 effective',
    body: `Good morning,

Attaching a new workers comp submission for Harbor & Vine Restaurant Group LLC out of Traverse City. Full service restaurant group, two locations, 42 total employees.

Current carrier is Great Lakes Mutual and they are looking to market it this year. Loss runs are attached, three full years, and they are clean - a couple of medical only claims and nothing open. Mod is 0.92.

Effective 11/1/2026. Let me know if you need anything else.

Thanks,
Dana Whitfield
Prairie State Insurance Group
dwhitfield@prairiestate.example`,
    attachments: [
      { id: 'ATT-4471-A', name: 'harbor-vine-application.pdf', kind: 'WC application', url: 'docs/harbor-vine-application.pdf' },
      { id: 'ATT-4471-B', name: 'harbor-vine-loss-run.pdf',    kind: 'Loss run',       url: 'docs/harbor-vine-loss-run.pdf' },
    ],
  },
  {
    id: 'SUB-4489',
    from: 'Marcus Feld <mfeld@copperridge.example>',
    agency: 'Copper Ridge Agency',
    received: '2026-08-27 15:41',
    subject: 'Ridgeline Roofing - WC - need a quote by Friday',
    body: `Hi team,

I have a good one for you. Ridgeline Roofing & Exteriors, six years in business, growing fast, owner is very safety focused. $2.37M payroll across MI, IN and OH.

They got hit hard in the assigned risk pool and are desperate to get out. Mod is 1.14 which is not bad at all for the trade. I really need something back by Friday, the incumbent is quoting Monday.

Application attached. I can get loss runs over tomorrow if you want to look at it.

Marcus Feld
Copper Ridge Agency`,
    attachments: [
      { id: 'ATT-4489-A', name: 'ridgeline-application.pdf', kind: 'WC application', url: 'docs/ridgeline-application.pdf' },
    ],
  },
  {
    id: 'SUB-4502',
    from: 'Priya Raman <praman@northbridgerisk.example>',
    agency: 'Northbridge Risk Partners',
    received: '2026-08-28 08:02',
    subject: 'Cascade Millwork - WC renewal submission - 10/1',
    body: `Morning,

Sending over Cascade Millwork for a 10/1 effective date. Custom architectural millwork shop in Grand Rapids, been around 19 years, 55 employees, about $2.7M in payroll.

Application and loss runs are attached. The shop has a real safety program - written manual, monthly toolbox talks, quarterly machine guarding inspections, and a return to work program.

Their office manager filled out the application and I have not had a chance to go through it line by line, so shout if something looks off.

Priya Raman
Northbridge Risk Partners
praman@northbridgerisk.example`,
    attachments: [
      { id: 'ATT-4502-A', name: 'cascade-application.pdf', kind: 'WC application', url: 'docs/cascade-application.pdf' },
      { id: 'ATT-4502-B', name: 'cascade-loss-run.pdf',    kind: 'Loss run',       url: 'docs/cascade-loss-run.pdf' },
    ],
  },
];

export const findSubmission = id => INBOX.find(s => s.id === id) || null;
export const openSubmission = () => findSubmission(state.openSubmissionId);
