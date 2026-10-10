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
  status: Exclude<DebugRunStatus, 'idle' | 'running'>;
  scenario: DebugScenario;
  audit: string[];
};

export interface AnalysisClient {
  replay(scenario: DebugScenario): Promise<ReplayState>;
}

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
    id: 'hold-insufficient',
    name: 'Missing evidence → HOLD',
    description: 'A positive trigger where required evidence remains unresolved.',
    utterances: [
      { speaker: 'Morgan', text: 'Revenue fell after the price change.' },
      { speaker: 'Aki', text: 'We should roll back based on that result.' },
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
    return {
      status,
      scenario,
      audit: [
        'replay.started',
        `trigger.${scenario.trigger.decision.toLowerCase()}`,
        ...(scenario.error ? ['flow.failed'] : ['analysis.completed', 'audit.recorded']),
      ],
    };
  }
}

export function scenarioById(id: string): DebugScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!;
}
