import type { ViewIntent } from './view-intents.js';

export type CandidateViewIntent = Omit<ViewIntent, 'runId'>;

export type DebugRunStatus =
  'idle' | 'running' | 'completed' | 'failed' | 'ignored' | 'insufficient-evidence';

export type DebugIntervention = 'HOLD' | 'INTERVENE';

export type DebugStage = {
  name: string;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  detail: string;
};

export type DebugScenario = {
  id: string;
  name: string;
  description: string;
  utterances: readonly { speaker: string; text: string }[];
  trigger: { decision: 'ANALYZE' | 'IGNORE'; reason: string; claim?: string };
  questions: readonly string[];
  stages: readonly DebugStage[];
  evidence: readonly { source: string; detail: string; provenance: string }[];
  verifier: { status: 'VERIFIED' | 'INSUFFICIENT' | 'NOT_RUN'; detail: string };
  intervention: { decision: DebugIntervention; reason: string } | null;
  error?: string;
};

export type ReplayState = {
  runId?: string;
  status: Exclude<DebugRunStatus, 'idle' | 'running'>;
  scenario: DebugScenario;
  audit: string[];
  candidateIntent?: CandidateViewIntent;
  verifiedEvidenceIds?: readonly string[];
  viewIntent?: ViewIntent;
};

export interface AnalysisClient {
  replay(scenario: DebugScenario): Promise<ReplayState>;
}

export type AnalysisRunEnvelope = Omit<ReplayState, 'candidateIntent' | 'viewIntent'> & {
  runId: string;
  viewIntent?: ViewIntent;
};

export const scenarios: readonly DebugScenario[] = [
  {
    id: 'verified-intervention',
    name: 'Verified contradiction → INTERVENE',
    description: 'A deterministic positive path with complete evidence and a mock intervention.',
    utterances: [
      { speaker: 'Aki', text: 'The conversion rate is 18% this month.' },
      { speaker: 'Morgan', text: 'That looks higher than the baseline.' },
      { speaker: 'Aki', text: "Let's decide whether the campaign caused the increase." },
    ],
    trigger: {
      decision: 'ANALYZE',
      reason: 'assumption-based-decision',
      claim: 'The campaign caused the conversion increase.',
    },
    questions: ['What is the baseline conversion rate?', 'Is campaign lift supported by the data?'],
    stages: [
      { name: 'Trigger', status: 'complete', detail: 'Decision-relevant assumption detected.' },
      { name: 'Analysis Contract', status: 'complete', detail: '2 bounded questions created.' },
      { name: 'Analysis', status: 'complete', detail: 'Fixture analysis completed.' },
      { name: 'Evidence', status: 'complete', detail: '2 provenance-linked observations.' },
      { name: 'Verifier', status: 'complete', detail: 'Evidence contradicts the assumption.' },
      { name: 'Intervention', status: 'complete', detail: 'Mock intervention is available.' },
    ],
    evidence: [
      {
        source: 'fixture:baseline',
        detail: 'Baseline conversion: 12%',
        provenance: 'fixture-row-1',
      },
      { source: 'fixture:campaign', detail: 'Campaign cohort: 11%', provenance: 'fixture-row-2' },
    ],
    verifier: { status: 'VERIFIED', detail: 'Required evidence is complete and contradictory.' },
    intervention: {
      decision: 'INTERVENE',
      reason: 'Verified evidence contradicts the assumption underlying the decision.',
    },
  },
  {
    id: 'verified-intervention-parameter',
    name: 'Verified threshold → INTERVENE',
    description: 'A second deterministic verified fixture with a distinct evidence-linked intent.',
    utterances: [
      { speaker: 'Aki', text: 'The threshold should be raised for this decision.' },
      { speaker: 'Morgan', text: 'The verified evidence supports a threshold change.' },
    ],
    trigger: {
      decision: 'ANALYZE',
      reason: 'assumption-based-decision',
      claim: 'The current threshold is too low.',
    },
    questions: ['Is the threshold change supported by the data?'],
    stages: [
      { name: 'Trigger', status: 'complete', detail: 'Decision-relevant assumption detected.' },
      { name: 'Analysis Contract', status: 'complete', detail: '1 bounded question created.' },
      { name: 'Analysis', status: 'complete', detail: 'Fixture analysis completed.' },
      { name: 'Evidence', status: 'complete', detail: '1 provenance-linked observation.' },
      { name: 'Verifier', status: 'complete', detail: 'Evidence supports the assumption.' },
      { name: 'Intervention', status: 'complete', detail: 'Mock intervention is available.' },
    ],
    evidence: [
      {
        source: 'fixture:threshold',
        detail: 'Verified threshold: 1',
        provenance: 'fixture-threshold-row-1',
      },
    ],
    verifier: { status: 'VERIFIED', detail: 'Required evidence is complete and supportive.' },
    intervention: {
      decision: 'INTERVENE',
      reason: 'Verified evidence supports the proposed threshold change.',
    },
  },
  {
    id: 'hold-insufficient',
    name: 'Missing evidence → HOLD',
    description: 'A positive trigger where required evidence remains unresolved.',
    utterances: [
      { speaker: 'Morgan', text: 'Revenue fell after the price change.' },
      {
        speaker: 'Aki',
        text: 'We should decide whether to roll back based on the price-change assumption.',
      },
    ],
    trigger: {
      decision: 'ANALYZE',
      reason: 'assumption-based-decision',
      claim: 'The price change caused the revenue fall.',
    },
    questions: ['Did revenue change in the comparable period?'],
    stages: [
      { name: 'Trigger', status: 'complete', detail: 'Decision-relevant assumption detected.' },
      { name: 'Analysis Contract', status: 'complete', detail: '1 bounded question created.' },
      { name: 'Analysis', status: 'complete', detail: 'Fixture analysis completed.' },
      { name: 'Evidence', status: 'complete', detail: 'No comparable-period row found.' },
      { name: 'Verifier', status: 'complete', detail: 'Required evidence is unresolved.' },
      { name: 'Intervention', status: 'complete', detail: 'Safety policy holds.' },
    ],
    evidence: [],
    verifier: { status: 'INSUFFICIENT', detail: 'A required question is unresolved.' },
    intervention: { decision: 'HOLD', reason: 'Required evidence is incomplete or invalid.' },
  },
  {
    id: 'ignored',
    name: 'No analytical opportunity → IGNORED',
    description: 'Conversation without a claim, hypothesis, or decision to investigate.',
    utterances: [
      { speaker: 'Aki', text: 'The meeting starts at ten.' },
      { speaker: 'Morgan', text: 'Thanks, I will send the notes afterward.' },
    ],
    trigger: { decision: 'IGNORE', reason: 'no-analytical-opportunity' },
    questions: [],
    stages: [
      { name: 'Trigger', status: 'complete', detail: 'No analytical opportunity detected.' },
      { name: 'Analysis Contract', status: 'skipped', detail: 'Not applicable.' },
      { name: 'Analysis', status: 'skipped', detail: 'Not applicable.' },
      { name: 'Evidence', status: 'skipped', detail: 'Not applicable.' },
      { name: 'Verifier', status: 'skipped', detail: 'Not applicable.' },
      { name: 'Intervention', status: 'skipped', detail: 'Not applicable.' },
    ],
    evidence: [],
    verifier: { status: 'NOT_RUN', detail: 'No analysis was requested.' },
    intervention: null,
  },
  {
    id: 'failed',
    name: 'Fixture failure → FAILED',
    description: 'A deterministic malformed-fixture case that fails closed with an audit event.',
    utterances: [{ speaker: 'Fixture', text: 'Replay payload cannot be parsed.' }],
    trigger: { decision: 'IGNORE', reason: 'fixture-invalid' },
    questions: [],
    stages: [
      { name: 'Trigger', status: 'failed', detail: 'Fixture validation failed.' },
      { name: 'Analysis Contract', status: 'skipped', detail: 'Not started.' },
      { name: 'Analysis', status: 'skipped', detail: 'Not started.' },
      { name: 'Evidence', status: 'skipped', detail: 'Not started.' },
      { name: 'Verifier', status: 'skipped', detail: 'Not started.' },
      { name: 'Intervention', status: 'complete', detail: 'HOLD: flow failed closed.' },
    ],
    evidence: [],
    verifier: { status: 'NOT_RUN', detail: 'Fixture error prevented analysis.' },
    intervention: { decision: 'HOLD', reason: 'Flow failed closed during fixture validation.' },
    error: 'FIXTURE_INVALID: deterministic replay payload rejected',
  },
];

export class FixtureAnalysisClient implements AnalysisClient {
  async replay(scenario: DebugScenario): Promise<ReplayState> {
    const status: ReplayState['status'] = scenario.error
      ? 'failed'
      : scenario.trigger.decision === 'IGNORE'
        ? 'ignored'
        : scenario.verifier.status === 'INSUFFICIENT'
          ? 'insufficient-evidence'
          : 'completed';
    const audit = [
      'replay.started',
      scenario.error
        ? 'flow-failed'
        : scenario.trigger.decision === 'IGNORE'
          ? 'trigger-ignored'
          : 'trigger-detected',
      ...(status === 'completed'
        ? [
            'analysis-contract-created',
            'tableau-analysis-started',
            'evidence-collected',
            'verification-complete',
            'intervention-recommended',
          ]
        : status === 'insufficient-evidence'
          ? [
              'analysis-contract-created',
              'tableau-analysis-started',
              'evidence-collected',
              'verification-insufficient',
              'intervention-hold',
            ]
          : []),
    ];
    return { status, scenario, audit };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isViewIntent(value: unknown): value is ViewIntent {
  if (!isRecord(value)) return false;
  if (
    !isBoundedString(value.id, 200) ||
    !isBoundedString(value.runId, 100) ||
    !isBoundedString(value.evidenceRef, 200) ||
    !isBoundedString(value.semanticKey, 200) ||
    !['set-filter', 'set-parameter'].includes(value.operation as string) ||
    !['string', 'number', 'boolean'].includes(value.valueType as string) ||
    !Array.isArray(value.values) ||
    value.values.length === 0 ||
    value.values.length > 16 ||
    (value.operation === 'set-parameter' && value.values.length !== 1)
  )
    return false;
  return value.values.every(
    (item) =>
      (typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))) &&
      typeof item === value.valueType,
  );
}

function isVerifiedEvidenceIds(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every((item) => isBoundedString(item, 200) && item.length > 0)
  );
}

export function hasValidReplayStateInvariants(
  status: ReplayState['status'],
  scenario: {
    trigger: DebugScenario['trigger'];
    verifier: DebugScenario['verifier'];
    intervention: DebugScenario['intervention'];
    error?: string;
  },
): boolean {
  if (status === 'ignored') {
    return (
      scenario.trigger.decision === 'IGNORE' &&
      scenario.verifier.status === 'NOT_RUN' &&
      scenario.intervention === null &&
      scenario.error === undefined
    );
  }
  if (status === 'insufficient-evidence') {
    return (
      scenario.trigger.decision === 'ANALYZE' &&
      scenario.verifier.status === 'INSUFFICIENT' &&
      scenario.intervention?.decision === 'HOLD' &&
      scenario.error === undefined
    );
  }
  if (status === 'completed') {
    return (
      scenario.trigger.decision === 'ANALYZE' &&
      scenario.verifier.status === 'VERIFIED' &&
      scenario.intervention?.decision === 'INTERVENE' &&
      scenario.error === undefined
    );
  }
  return scenario.intervention === null || scenario.intervention.decision === 'HOLD';
}

const replayStageNames = [
  'Trigger',
  'Analysis Contract',
  'Analysis',
  'Evidence',
  'Verifier',
  'Intervention',
] as const;

export function hasValidReplayTraceInvariants(
  status: ReplayState['status'],
  scenario: Pick<DebugScenario, 'stages'> & Parameters<typeof hasValidReplayStateInvariants>[1],
  audit: readonly string[],
): boolean {
  if (!hasValidReplayStateInvariants(status, scenario)) return false;
  const stages = new Map(scenario.stages.map((stage) => [stage.name, stage.status]));
  if (replayStageNames.some((name) => !stages.has(name))) return false;

  const requiredAuditByStatus: Record<ReplayState['status'], readonly string[]> = {
    completed: [
      'trigger-detected',
      'analysis-contract-created',
      'tableau-analysis-started',
      'evidence-collected',
      'verification-complete',
      'intervention-recommended',
    ],
    'insufficient-evidence': [
      'trigger-detected',
      'analysis-contract-created',
      'tableau-analysis-started',
      'evidence-collected',
      'verification-insufficient',
      'intervention-hold',
    ],
    ignored: ['trigger-ignored'],
    failed: [],
  };
  if (status === 'failed') {
    if (!audit.includes('flow-failed') && !audit.includes('flow.failed')) return false;
  } else if (requiredAuditByStatus[status].some((event) => !audit.includes(event))) {
    return false;
  }

  if (status === 'completed' || status === 'insufficient-evidence') {
    return replayStageNames.every((name) => stages.get(name) === 'complete');
  }
  if (status === 'ignored') {
    return (
      stages.get('Trigger') === 'complete' &&
      replayStageNames.slice(1).every((name) => stages.get(name) === 'skipped')
    );
  }
  return replayStageNames.some((name) => stages.get(name) === 'failed');
}

function isAnalysisRunEnvelope(value: unknown): value is AnalysisRunEnvelope {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.runId, 100) || !isBoundedString(value.status, 32)) return false;
  if (!['completed', 'failed', 'ignored', 'insufficient-evidence'].includes(value.status))
    return false;
  if (!Array.isArray(value.audit) || value.audit.length > 64) return false;
  if (!value.audit.every((item) => isBoundedString(item, 200))) return false;
  if (
    value.verifiedEvidenceIds !== undefined &&
    !isVerifiedEvidenceIds(value.verifiedEvidenceIds)
  ) {
    return false;
  }
  if (value.viewIntent !== undefined && !isViewIntent(value.viewIntent)) return false;

  const scenario = value.scenario;
  if (!isRecord(scenario)) return false;
  if (
    !isBoundedString(scenario.id, 100) ||
    !scenarios.some(({ id }) => id === scenario.id) ||
    !isBoundedString(scenario.name, 200) ||
    !isBoundedString(scenario.description, 500)
  )
    return false;

  if (!Array.isArray(scenario.utterances) || scenario.utterances.length > 100) return false;
  if (
    !scenario.utterances.every(
      (item) =>
        isRecord(item) && isBoundedString(item.speaker, 100) && isBoundedString(item.text, 500),
    )
  )
    return false;

  const trigger = scenario.trigger;
  if (
    !isRecord(trigger) ||
    !['ANALYZE', 'IGNORE'].includes(trigger.decision as string) ||
    !isBoundedString(trigger.reason, 100) ||
    (trigger.claim !== undefined && !isBoundedString(trigger.claim, 300))
  )
    return false;

  if (!Array.isArray(scenario.questions) || scenario.questions.length > 8) return false;
  if (!scenario.questions.every((item) => isBoundedString(item, 300))) return false;

  if (!Array.isArray(scenario.evidence) || scenario.evidence.length > 20) return false;
  if (
    !scenario.evidence.every(
      (item) =>
        isRecord(item) &&
        isBoundedString(item.source, 100) &&
        isBoundedString(item.detail, 500) &&
        isBoundedString(item.provenance, 100),
    )
  )
    return false;

  if (!isRecord(scenario.verifier)) return false;
  if (
    !['VERIFIED', 'INSUFFICIENT', 'NOT_RUN'].includes(scenario.verifier.status as string) ||
    !isBoundedString(scenario.verifier.detail, 500)
  )
    return false;

  if (!Array.isArray(scenario.stages) || scenario.stages.length > 16) return false;
  if (
    !scenario.stages.every(
      (item) =>
        isRecord(item) &&
        isBoundedString(item.name, 100) &&
        ['pending', 'active', 'complete', 'failed', 'skipped'].includes(item.status as string) &&
        isBoundedString(item.detail, 500),
    )
  )
    return false;

  if (scenario.intervention !== null) {
    if (!isRecord(scenario.intervention)) return false;
    if (
      !['HOLD', 'INTERVENE'].includes(scenario.intervention.decision as string) ||
      !isBoundedString(scenario.intervention.reason, 500)
    )
      return false;
  }
  if (scenario.error !== undefined && !isBoundedString(scenario.error, 200)) return false;
  return hasValidReplayTraceInvariants(
    value.status as ReplayState['status'],
    {
      trigger: scenario.trigger as DebugScenario['trigger'],
      verifier: scenario.verifier as DebugScenario['verifier'],
      intervention: scenario.intervention as DebugScenario['intervention'],
      stages: scenario.stages as DebugScenario['stages'],
      ...(scenario.error !== undefined ? { error: scenario.error as string } : {}),
    },
    value.audit as string[],
  );
}

export class HttpAnalysisClient implements AnalysisClient {
  constructor(private readonly baseUrl = '') {}

  async replay(scenario: DebugScenario): Promise<ReplayState> {
    const response = await fetch(`${this.baseUrl}/api/analysis-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: scenario.id }),
    });
    if (!response.ok) throw new Error('ANALYSIS_RUN_REQUEST_FAILED');
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error('ANALYSIS_RUN_RESPONSE_INVALID');
    }
    if (!isAnalysisRunEnvelope(value) || value.scenario.id !== scenario.id) {
      throw new Error('ANALYSIS_RUN_RESPONSE_INVALID');
    }
    return value;
  }
}

export function recordMockInterventionEvent(state: ReplayState): void {
  state.audit.push('mock.intervention.details-opened');
}

export function scenarioById(id: string): DebugScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!;
}
