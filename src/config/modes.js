/**
 * KnockLog — Mode Registry
 * Single source of truth for RESIDENTIAL and COMMERCIAL mode definitions.
 * All status colors, outcome keys, and labels live here.
 *
 * Rule: Residential stays byte-for-byte equivalent. Do not change
 * RESIDENTIAL values without explicit owner approval.
 */

export const MODES = {
  RESIDENTIAL: 'RESIDENTIAL',
  COMMERCIAL: 'COMMERCIAL',
};

/**
 * Safe mode extractor. Missing mode = RESIDENTIAL (keeps all legacy data valid).
 * @param {object} payload - Any event payload or object with an optional .mode field.
 * @returns {'RESIDENTIAL'|'COMMERCIAL'}
 */
export function modeOf(payload) {
  return payload?.mode === MODES.COMMERCIAL ? MODES.COMMERCIAL : MODES.RESIDENTIAL;
}

// ── Residential status definitions (unchanged from v1) ─────────────────────

export const RESIDENTIAL_OUTCOMES = [
  { key: 'NO_ANSWER', label: 'NO ANSWER', color: '#6b7280' },
  { key: 'CONVO',     label: 'CONVO',     color: '#3b82f6' },
  { key: 'SALE',      label: 'SALE',      color: '#10b981' },
];

export const RESIDENTIAL_CONVO_OPTIONS = [
  'CALLBACK',
  'NOT INTERESTED',
  'ALREADY HAVE / DIY',
  'BAD TIMING',
  'NEED TO THINK',
  'NOT DECISION MAKER',
  'NO SOLICITING',
  'CONSTRUCTION',
];

/**
 * Resolve a residential payload to a canonical status string.
 * Mirrors the existing resolveStatus logic in teamService/propertyService.
 */
export function resolveResidentialStatus(p) {
  if (p.outcome_type !== 'CONVO') return p.outcome_type || 'NO_ANSWER';
  if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') return 'CALLBACK';
  if (p.objection_type === 'NOT INTERESTED') return 'NOT_INTERESTED';
  if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') return 'THINKING';
  if (p.objection_type === 'NO SOLICITING') return 'NO_SOLICITING';
  if (p.objection_type === 'CONSTRUCTION') return 'CONSTRUCTION';
  return 'CONVO';
}

// ── Commercial status definitions ───────────────────────────────────────────

/**
 * Commercial outcome_type values (what goes in the payload).
 */
export const COMMERCIAL_OUTCOME_TYPES = [
  'NO_ANSWER',
  'GATEKEEPER',
  'DECISION_MAKER',
  'WALKTHROUGH_BOOKED',
];

/**
 * Commercial DECISION_MAKER sub-results stored in objection_type.
 */
export const COMMERCIAL_DM_RESULTS = [
  'INTERESTED',
  'HAS VENDOR',
  'LANDLORD OR HEAD OFFICE',
  'NOT NOW',
  'NOT INTERESTED',
  'NO SOLICITING',
];

/**
 * Map commercial outcome/objection to a resolved display status.
 * Returns a canonical string used for pin colors, labels, etc.
 */
export function resolveCommercialStatus(p) {
  switch (p.outcome_type) {
    case 'WALKTHROUGH_BOOKED': return 'WALKTHROUGH_BOOKED';
    case 'GATEKEEPER':         return 'GATEKEEPER';
    case 'DECISION_MAKER': {
      // Sub-classify by objection_type
      switch (p.objection_type) {
        case 'INTERESTED':              return 'DM_INTERESTED';
        case 'HAS VENDOR':              return 'HAS_VENDOR';
        case 'LANDLORD OR HEAD OFFICE': return 'LANDLORD';
        case 'NOT NOW':                 return 'NOT_NOW';
        case 'NOT INTERESTED':          return 'NOT_INTERESTED';
        case 'NO SOLICITING':           return 'NO_SOLICITING';
        default:                         return 'DECISION_MAKER';
      }
    }
    case 'NO_ANSWER':
    default:
      return 'NO_ANSWER';
  }
}

/**
 * Colour map for commercial statuses. Reuses the existing palette
 * from the KnockLog design system (no new hex values).
 */
export const COMMERCIAL_STATUS_COLORS = {
  NO_ANSWER:          '#6b7280', // gray
  GATEKEEPER:         '#60a5fa', // light blue
  DECISION_MAKER:     '#3b82f6', // blue
  DM_INTERESTED:      '#3b82f6', // blue
  HAS_VENDOR:         '#f59e0b', // amber
  LANDLORD:           '#a855f7', // purple
  NOT_NOW:            '#a855f7', // purple
  NOT_INTERESTED:     '#ef4444', // red
  NO_SOLICITING:      '#dc2626', // dark red
  WALKTHROUGH_BOOKED: '#10b981', // green  (--success)
};

/**
 * Human-readable labels for commercial statuses (used in feeds, maps, history).
 */
export const COMMERCIAL_STATUS_LABELS = {
  NO_ANSWER:          'No Answer',
  GATEKEEPER:         'Gatekeeper',
  DECISION_MAKER:     'Decision Maker',
  DM_INTERESTED:      'DM – Interested',
  HAS_VENDOR:         'Has Vendor',
  LANDLORD:           'Landlord / HO',
  NOT_NOW:            'Not Now',
  NOT_INTERESTED:     'Not Interested',
  NO_SOLICITING:      'No Soliciting',
  WALKTHROUGH_BOOKED: 'Walkthrough Booked',
};

// ── Unified dispatcher ───────────────────────────────────────────────────────

/**
 * Resolve any payload (residential or commercial) to a canonical status string.
 * Use this as the single entry point everywhere: map pins, leaderboard, history.
 */
export function resolveStatus(payload) {
  const mode = modeOf(payload);
  if (mode === MODES.COMMERCIAL) return resolveCommercialStatus(payload);
  return resolveResidentialStatus(payload);
}

/**
 * Get the pin color for any resolved status string, mode-aware.
 * Residential colors match the existing status color maps.
 */
const RESIDENTIAL_STATUS_COLORS = {
  NO_ANSWER:    '#6b7280',
  CONVO:        '#3b82f6',
  CALLBACK:     '#60a5fa',
  THINKING:     '#a855f7',
  NOT_INTERESTED:'#ef4444',
  NO_SOLICITING:'#dc2626',
  CONSTRUCTION: '#f59e0b',
  SALE:         '#10b981',
};

export function statusColor(status, mode = MODES.RESIDENTIAL) {
  if (mode === MODES.COMMERCIAL) {
    return COMMERCIAL_STATUS_COLORS[status] || '#6b7280';
  }
  return RESIDENTIAL_STATUS_COLORS[status] || '#6b7280';
}

/**
 * Build the stable target_key for a COMMERCIAL knock payload.
 * slug = lowercase, trim, collapse whitespace, strip non-alphanumeric (except spaces).
 */
function slug(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

export function buildCommercialTargetKey(businessName, houseNumber, streetName, suite) {
  const bizPart = slug(businessName);
  const addrPart = `${(houseNumber || '').toLowerCase().trim()} ${slug(streetName)}`.trim();
  let key = `${bizPart}|${addrPart}`;
  if (suite && suite.trim()) key += `|${slug(suite)}`;
  return key;
}

// ── Phase 2: Commercial Lead Pipeline & Options ─────────────────────────────

export const LEAD_STAGES = [
  'COLD',
  'CONTACTED',
  'DM_IDENTIFIED',
  'WALKTHROUGH_BOOKED',
  'QUOTED',
  'WON',
  'LOST'
];

export const LEAD_STAGE_LABELS = {
  COLD:                'Cold',
  CONTACTED:           'Contacted',
  DM_IDENTIFIED:       'DM Identified',
  WALKTHROUGH_BOOKED:  'Walkthrough Booked',
  QUOTED:              'Quoted',
  WON:                 'Won',
  LOST:                'Lost'
};

export const LEAD_STAGE_COLORS = {
  COLD:                '#6b7280', // gray
  CONTACTED:           '#60a5fa', // light blue
  DM_IDENTIFIED:       '#3b82f6', // blue
  WALKTHROUGH_BOOKED:  '#10b981', // green
  QUOTED:              '#f59e0b', // amber
  WON:                 '#8b5cf6', // purple / violet
  LOST:                '#ef4444'  // red
};

export const COMMERCIAL_SERVICES = [
  { key: 'RECURRING_JANITORIAL', label: 'Recurring Janitorial' },
  { key: 'ONE_TIME_DEEP_CLEAN',  label: 'Deep Clean' },
  { key: 'FLOOR_CARE',           label: 'Floor Care' },
  { key: 'POST_CONSTRUCTION',    label: 'Post-Construction' },
  { key: 'WINDOWS',              label: 'Windows' },
  { key: 'OTHER',                label: 'Other' }
];

export const COMMERCIAL_FREQUENCIES = [
  { key: 'DAILY',    label: 'Daily' },
  { key: 'WEEKLY',   label: 'Weekly' },
  { key: 'BIWEEKLY', label: 'Bi-Weekly' },
  { key: 'MONTHLY',  label: 'Monthly' },
  { key: 'ONE_TIME', label: 'One-Time' }
];

export const COMMERCIAL_EST_VALUE_CHIPS = [
  500,
  1000,
  2500,
  5000
];

