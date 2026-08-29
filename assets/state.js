// ---------------------------------------------------------------------------
// state.js — the submission record, the seeded queue, and the underwriting
// rules. Everything here is deterministic. No model judgment lives in this
// file: the agent gathers facts, this code decides what they mean.
// ---------------------------------------------------------------------------

export const FIELDS = [
  { key: 'named_insured',      label: 'Named insured',        group: 'Applicant', required: true,  type: 'text' },
  { key: 'fein',               label: 'FEIN',                 group: 'Applicant', required: true,  type: 'text' },
  { key: 'entity_type',        label: 'Entity type',          group: 'Applicant', required: false, type: 'text' },
  { key: 'state',              label: 'State(s) of operation',group: 'Applicant', required: true,  type: 'text' },
  { key: 'years_in_business',  label: 'Years in business',    group: 'Applicant', required: false, type: 'number' },

  { key: 'effective_date',     label: 'Effective date',       group: 'Coverage',  required: true,  type: 'text' },
  { key: 'experience_mod',     label: 'Experience mod',       group: 'Coverage',  required: true,  type: 'number' },

  { key: 'governing_class',    label: 'Governing class code', group: 'Exposure',  required: true,  type: 'text' },
  { key: 'class_description',  label: 'Class description',    group: 'Exposure',  required: false, type: 'text' },
  { key: 'annual_payroll',     label: 'Total annual payroll', group: 'Exposure',  required: true,  type: 'money' },
  { key: 'employee_count',     label: 'Employee count',       group: 'Exposure',  required: true,  type: 'number' },

  { key: 'losses_on_app',      label: 'Losses disclosed on application', group: 'Loss history', required: true, type: 'yesno' },
  { key: 'loss_run_years',     label: 'Years of loss runs provided',     group: 'Loss history', required: true, type: 'number' },
  { key: 'loss_run_claims',    label: 'Claims shown on loss runs',       group: 'Loss history', required: false, type: 'number' },
  { key: 'loss_run_incurred',  label: 'Total incurred on loss runs',     group: 'Loss history', required: false, type: 'money' },

  { key: 'agency_name',        label: 'Producing agency',     group: 'Producer',  required: false, type: 'text' },
  { key: 'agent_email',        label: 'Producer email',       group: 'Producer',  required: false, type: 'text' },
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
const byKey = Object.fromEntries(FIELDS.map(f => [f.key, f]));
export const fieldLabel = k => (byKey[k] ? byKey[k].label : k);
export const fieldType  = k => (byKey[k] ? byKey[k].type : 'text');

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
  quote_now:     { label: 'Quote Now',     blurb: 'In appetite, complete, and clean. Send to rating.' },
  indication:    { label: 'Indication',    blurb: 'Enough to price a ballpark, not enough to bind.' },
  send_for_info: { label: 'Send for Info', blurb: 'Go back to the producer before anything else.' },
  likely_decline:{ label: 'Likely Decline',blurb: 'Outside appetite. Decline politely and fast.' },
};

// --- Live state -------------------------------------------------------------
export const state = {
  openSubmissionId: null,
  record: Object.fromEntries(FIELD_KEYS.map(k => [k, null])),
  provenance: {},        // field -> where the value came from
  proposal: null,        // { lane, rationale, decidedBy }
  decision: null,        // { lane, at } once a human confirms
  pendingQuestion: null, // { field, question }
  log: [],               // tool-call activity
};

export function resetRecord() {
  state.record = Object.fromEntries(FIELD_KEYS.map(k => [k, null]));
  state.provenance = {};
  state.proposal = null;
  state.decision = null;
  state.pendingQuestion = null;
}

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// --- The rules engine -------------------------------------------------------
export function evaluate(record = state.record) {
  const missing = FIELDS.filter(f => f.required && isBlank(record[f.key])).map(f => f.key);
  const conflicts = [];
  const appetite = [];
  const notes = [];

  const cls = record.governing_class ? String(record.governing_class).trim() : null;
  if (cls && PROHIBITED_CLASSES[cls]) {
    appetite.push({
      code: 'PROHIBITED_CLASS',
      message: `Class ${cls} (${PROHIBITED_CLASSES[cls]}) is on the prohibited list.`,
      fields: ['governing_class'],
    });
  }

  const mod = num(record.experience_mod);
  if (mod !== null && mod > MAX_EXPERIENCE_MOD) {
    appetite.push({
      code: 'HIGH_MOD',
      message: `Experience mod ${mod.toFixed(2)} is above the ${MAX_EXPERIENCE_MOD} maximum.`,
      fields: ['experience_mod'],
    });
  }

  const incurred = num(record.loss_run_incurred);
  if (incurred !== null && incurred > MAX_INCURRED) {
    appetite.push({
      code: 'LOSS_SEVERITY',
      message: `Total incurred of $${incurred.toLocaleString()} exceeds the $${MAX_INCURRED.toLocaleString()} threshold.`,
      fields: ['loss_run_incurred'],
    });
  }

  // The contradiction the agent cannot resolve on its own.
  const claims = num(record.loss_run_claims);
  if (record.losses_on_app === 'no' && claims !== null && claims > 0) {
    conflicts.push({
      code: 'LOSS_DISCLOSURE_MISMATCH',
      message: `The application reports no losses, but the loss run shows ${claims} claim${claims === 1 ? '' : 's'}. A person has to decide which document is right.`,
      fields: ['losses_on_app', 'loss_run_claims'],
    });
  }

  const yearsProvided = num(record.loss_run_years);
  if (yearsProvided !== null && yearsProvided < MIN_LOSS_RUN_YEARS) {
    notes.push({
      code: 'SHORT_LOSS_HISTORY',
      message: `Only ${yearsProvided} year${yearsProvided === 1 ? '' : 's'} of loss runs provided. ${MIN_LOSS_RUN_YEARS} are needed to firm up a quote.`,
      fields: ['loss_run_years'],
    });
  }

  // Order matters: get out of the way of risks you will never write.
  let lane;
  if (appetite.length) lane = 'likely_decline';
  else if (conflicts.length) lane = 'send_for_info';
  else if (missing.length) lane = 'send_for_info';
  else if (notes.length) lane = 'indication';
  else lane = 'quote_now';

  const filled = FIELD_KEYS.filter(k => !isBlank(record[k])).length;
  return {
    lane,
    laneLabel: LANES[lane].label,
    missing,
    conflicts,
    appetite,
    notes,
    completeness: Math.round((filled / FIELD_KEYS.length) * 100),
    requiredRemaining: missing.length,
  };
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
