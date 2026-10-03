import type { EvaluationCase } from './types.js';

export const requiredEvaluationCaseIds = [
  'one-call-sufficient',
  'incomplete-first-result',
  'empty-result-recovery',
  'dimension-change',
  'temporal-comparison',
  'hypothesis-disproved',
  'insufficient-evidence',
] as const;

export const evaluationCases: readonly EvaluationCase[] = [
  {
    id: 'one-call-sufficient',
    title: 'One tool call is sufficient',
    analysisGoal: 'Obtain the current value of a single metric.',
    requiredEvidence: [
      { id: 'current-metric', description: 'Metric value for the current period.' },
    ],
    expectedChallenge: 'The first valid result already contains all required evidence.',
    completionCondition: 'Stop when the current metric value is available.',
    expectedOutcomeType: 'supported',
    allowedToolBehavior: ['get-metric'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the current metric value.',
          result: 'The current metric value is 120.',
          evidence: ['current-metric'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        { kind: 'obtain-required-evidence', description: 'Use the available result.' },
        { kind: 'stop-after-completion', description: 'Stop after the first sufficient result.' },
      ],
      mustNot: [
        {
          kind: 'redundant-exploration',
          description: 'Do not make an unnecessary follow-up call.',
        },
      ],
    },
  },
  {
    id: 'incomplete-first-result',
    title: 'First result is insufficient',
    analysisGoal:
      'Determine whether a metric is elevated for the whole population and the comparison group.',
    initialHypothesis: 'The metric is elevated for the comparison group as well as overall.',
    requiredEvidence: [
      { id: 'overall-metric', description: 'Overall metric value for the current period.' },
      { id: 'comparison-group-metric', description: 'Metric value for the comparison group.' },
    ],
    expectedChallenge: 'The first result contains only the overall value.',
    completionCondition: 'Stop when both overall and comparison-group values are available.',
    expectedOutcomeType: 'supported',
    allowedToolBehavior: ['get-metric', 'break-down'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the overall metric value.',
          result: 'The overall metric is elevated.',
          evidence: ['overall-metric'],
          status: 'available',
        },
        {
          action: 'break-down',
          description: 'Read the metric for the comparison group.',
          result: 'The comparison-group metric is also elevated.',
          evidence: ['comparison-group-metric'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'recognize-missing-evidence',
          description: 'Notice that the overall result is incomplete.',
        },
        {
          kind: 'continue-exploration',
          description: 'Use another allowed action to obtain the missing group value.',
        },
        {
          kind: 'stop-after-completion',
          description: 'Stop after both required values are available.',
        },
      ],
      mustNot: [
        { kind: 'premature-stop', description: 'Do not conclude from the overall value alone.' },
      ],
    },
  },
  {
    id: 'empty-result-recovery',
    title: 'Empty result requires recovery',
    analysisGoal: 'Find the current metric after an initial condition returns no usable rows.',
    initialHypothesis: 'The metric can be evaluated under the requested condition.',
    requiredEvidence: [
      {
        id: 'recovered-current-metric',
        description: 'A usable current metric value after adjusting the condition.',
      },
    ],
    expectedChallenge: 'The first condition returns an empty result.',
    completionCondition: 'Stop when a bounded condition adjustment returns the required metric.',
    expectedOutcomeType: 'supported',
    allowedToolBehavior: ['adjust-filter', 'get-metric'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the metric using the initial condition.',
          result: 'No rows match the initial condition.',
          evidence: [],
          status: 'empty',
        },
        {
          action: 'adjust-filter',
          description: 'Adjust the condition within the case boundary.',
          result: 'The adjusted condition is valid for the requested analysis.',
          evidence: [],
          status: 'available',
        },
        {
          action: 'get-metric',
          description: 'Read the metric with the adjusted condition.',
          result: 'A usable current metric value is available.',
          evidence: ['recovered-current-metric'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'recover-from-empty-result',
          description: 'Treat the empty result as insufficient evidence.',
        },
        {
          kind: 'bounded-retry',
          description: 'Adjust the condition and retry within the available paths.',
        },
        {
          kind: 'stop-after-completion',
          description: 'Stop when the recovered metric is available.',
        },
      ],
      mustNot: [
        {
          kind: 'premature-stop',
          description: 'Do not report insufficient evidence immediately after the empty result.',
        },
        { kind: 'unbounded-retry', description: 'Do not retry indefinitely.' },
      ],
    },
  },
  {
    id: 'dimension-change',
    title: 'Dimension change reveals the difference',
    analysisGoal: 'Determine whether an unchanged aggregate hides a meaningful segment difference.',
    initialHypothesis: 'The metric is unchanged for all segments.',
    requiredEvidence: [
      { id: 'aggregate-metric', description: 'Aggregate metric for the current comparison.' },
      {
        id: 'segment-breakdown',
        description: 'Metric breakdown across a neutral segment dimension.',
      },
    ],
    expectedChallenge: 'The aggregate result alone does not distinguish segment behavior.',
    completionCondition: 'Stop when the aggregate and segment breakdown are both available.',
    expectedOutcomeType: 'revised',
    allowedToolBehavior: ['get-metric', 'break-down'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the aggregate metric.',
          result: 'The aggregate metric appears unchanged.',
          evidence: ['aggregate-metric'],
          status: 'available',
        },
        {
          action: 'break-down',
          description: 'Break down the metric by a neutral segment dimension.',
          result: 'The segment values differ meaningfully despite the unchanged aggregate.',
          evidence: ['segment-breakdown'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'change-dimension',
          description: 'Request a breakdown when the aggregate is insufficient.',
        },
        {
          kind: 'revise-hypothesis',
          description: 'Revise the unchanged-for-all-segments hypothesis.',
        },
        {
          kind: 'stop-after-completion',
          description: 'Stop after the segment difference is evidenced.',
        },
      ],
      mustNot: [
        {
          kind: 'aggregate-only-conclusion',
          description: 'Do not treat the aggregate as the complete explanation.',
        },
      ],
    },
  },
  {
    id: 'temporal-comparison',
    title: 'Temporal comparison is required',
    analysisGoal: 'Determine whether the current metric changed relative to a baseline period.',
    initialHypothesis: 'The current metric is higher than the baseline.',
    requiredEvidence: [
      { id: 'current-period-metric', description: 'Metric value for the current period.' },
      {
        id: 'baseline-period-metric',
        description: 'Metric value for a comparable previous period.',
      },
    ],
    expectedChallenge: 'The current value has no meaning for change without a comparison window.',
    completionCondition: 'Stop when current and baseline-period values are both available.',
    expectedOutcomeType: 'supported',
    allowedToolBehavior: ['get-metric', 'compare-periods'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the current-period metric.',
          result: 'The current metric value is 120.',
          evidence: ['current-period-metric'],
          status: 'available',
        },
        {
          action: 'compare-periods',
          description: 'Read the comparable baseline-period metric.',
          result: 'The baseline metric value is 80.',
          evidence: ['baseline-period-metric'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'compare-time-period',
          description: 'Request a comparison period after seeing only the current value.',
        },
        {
          kind: 'stop-after-completion',
          description: 'Stop after both period values are available.',
        },
      ],
      mustNot: [
        {
          kind: 'current-only-conclusion',
          description: 'Do not infer change from the current value alone.',
        },
      ],
    },
  },
  {
    id: 'hypothesis-disproved',
    title: 'Initial hypothesis is disproved',
    analysisGoal: 'Determine whether the current metric increased relative to the baseline.',
    initialHypothesis: 'Evidence will support that the current metric increased.',
    requiredEvidence: [
      { id: 'disproof-current-value', description: 'Current metric value.' },
      { id: 'disproof-baseline-value', description: 'Comparable baseline metric value.' },
    ],
    expectedChallenge: 'The evidence contradicts the initial direction of change.',
    completionCondition:
      'Stop after comparing both values and explicitly rejecting or revising the initial hypothesis.',
    expectedOutcomeType: 'rejected',
    allowedToolBehavior: ['get-metric', 'compare-periods'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the current metric.',
          result: 'The current metric value is 100.',
          evidence: ['disproof-current-value'],
          status: 'available',
        },
        {
          action: 'compare-periods',
          description: 'Read the comparable baseline metric.',
          result: 'The baseline metric value is 120.',
          evidence: ['disproof-baseline-value'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'compare-time-period',
          description: 'Obtain the baseline needed to test the hypothesis.',
        },
        {
          kind: 'reject-or-revise-hypothesis',
          description: 'Reject or revise the unsupported increase hypothesis.',
        },
      ],
      mustNot: [
        {
          kind: 'confirmation-bias',
          description: 'Do not force the evidence to support the initial hypothesis.',
        },
        { kind: 'unsupported-positive-conclusion', description: 'Do not report an increase.' },
      ],
    },
  },
  {
    id: 'insufficient-evidence',
    title: 'Evidence remains insufficient',
    analysisGoal:
      'Determine whether a change can be established when the necessary comparison is unavailable.',
    initialHypothesis: 'The current metric may differ from the baseline.',
    requiredEvidence: [
      { id: 'available-current-value', description: 'Current metric value.' },
      { id: 'required-baseline-value', description: 'Comparable baseline value.' },
    ],
    expectedChallenge:
      'The current value is available but every bounded path to the baseline is unavailable.',
    completionCondition:
      'Stop with insufficient evidence after the allowed evidence paths are exhausted.',
    expectedOutcomeType: 'insufficient-evidence',
    allowedToolBehavior: ['get-metric', 'compare-periods', 'break-down'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the current metric.',
          result: 'The current metric value is available.',
          evidence: ['available-current-value'],
          status: 'available',
        },
        {
          action: 'compare-periods',
          description: 'Attempt to read the baseline value.',
          result: 'The comparison period is unavailable.',
          evidence: [],
          status: 'unavailable',
        },
        {
          action: 'break-down',
          description: 'Attempt a bounded alternative evidence path.',
          result: 'No breakdown can supply the missing baseline value.',
          evidence: [],
          status: 'unavailable',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'exhaust-bounded-paths',
          description: 'Try the explicitly available evidence paths.',
        },
        {
          kind: 'stop-with-insufficient-evidence',
          description: 'Report insufficient evidence without inventing a conclusion.',
        },
      ],
      mustNot: [
        {
          kind: 'best-guess',
          description: 'Do not report best guess, likely, or probably as the outcome.',
        },
        {
          kind: 'unbounded-exploration',
          description: 'Do not continue after the bounded paths are exhausted.',
        },
      ],
    },
  },
  {
    id: 'recoverable-tool-error',
    title: 'Recover from a transient tool error',
    analysisGoal: 'Obtain the current metric after a recoverable execution error.',
    requiredEvidence: [
      { id: 'recovered-metric', description: 'Current metric after a successful retry path.' },
    ],
    expectedChallenge: 'The first action fails transiently but a bounded retry path is available.',
    completionCondition: 'Stop after a retry succeeds and the current metric is available.',
    expectedOutcomeType: 'supported',
    allowedToolBehavior: ['get-metric'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Initial metric request fails transiently.',
          result: 'Temporary execution error; retry is allowed by the case.',
          evidence: [],
          status: 'error',
        },
        {
          action: 'get-metric',
          description: 'Bounded retry of the metric request.',
          result: 'The current metric is available.',
          evidence: ['recovered-metric'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'recover-from-error',
          description: 'Retry the recoverable error within the case boundary.',
        },
        {
          kind: 'stop-after-completion',
          description: 'Stop after the retry provides the required evidence.',
        },
      ],
      mustNot: [
        { kind: 'unbounded-retry', description: 'Do not retry indefinitely.' },
        {
          kind: 'auth-blind-retry',
          description: 'This recoverable error must not imply blind auth or permission retries.',
        },
      ],
    },
  },
  {
    id: 'conflicting-evidence',
    title: 'Conflicting evidence requires reconciliation',
    analysisGoal: 'Determine whether two apparently conflicting observations can be reconciled.',
    initialHypothesis: 'The observations describe the same underlying segment.',
    requiredEvidence: [
      { id: 'first-observation', description: 'First observation and its scope.' },
      { id: 'second-observation', description: 'Second observation and its scope.' },
      { id: 'reconciled-interpretation', description: 'Clarification of the apparent conflict.' },
    ],
    expectedChallenge: 'Two available results appear inconsistent until their scopes are compared.',
    completionCondition: 'Stop when the conflict is reconciled or explicitly marked insufficient.',
    expectedOutcomeType: 'revised',
    allowedToolBehavior: ['get-metric', 'reconcile'],
    fixture: {
      responses: [
        {
          action: 'get-metric',
          description: 'Read the first scoped observation.',
          result: 'The first observation reports a higher value.',
          evidence: ['first-observation'],
          status: 'available',
        },
        {
          action: 'get-metric',
          description: 'Read the second scoped observation.',
          result: 'The second observation reports a lower value.',
          evidence: ['second-observation'],
          status: 'conflicting',
        },
        {
          action: 'reconcile',
          description: 'Compare scopes and reconcile the apparent conflict.',
          result: 'The observations use different scopes; the apparent conflict is explained.',
          evidence: ['reconciled-interpretation'],
          status: 'available',
        },
      ],
    },
    expectations: {
      must: [
        {
          kind: 'recognize-conflict',
          description: 'Notice that the observations cannot be combined directly.',
        },
        {
          kind: 'reconcile-evidence',
          description: 'Seek clarification before forming a conclusion.',
        },
      ],
      mustNot: [
        {
          kind: 'ignore-conflict',
          description: 'Do not discard one result without checking its scope.',
        },
      ],
    },
  },
];
