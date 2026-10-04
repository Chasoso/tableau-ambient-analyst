export type MeasuredCaseSetup = {
  id:
    | 'incomplete-first-result'
    | 'empty-result-recovery'
    | 'hypothesis-disproved'
    | 'insufficient-evidence';
  initialPrompt: string;
  requiredEvidence: readonly string[];
  queryOneExpectedEvidence: readonly string[];
  missingEvidenceAfterQueryOne: readonly string[];
  expectedFollowUp: string;
  passCriteria: readonly string[];
  failCriteria: readonly string[];
  setupFailureCriteria: readonly string[];
};

export const measuredCaseSetups: readonly MeasuredCaseSetup[] = [
  {
    id: 'incomplete-first-result',
    initialPrompt:
      'Obtain the current aggregate first, then determine the required comparison using another bounded query. Do not conclude from the first aggregate alone.',
    requiredEvidence: ['current-period-metric', 'comparison-period-metric'],
    queryOneExpectedEvidence: ['current-period-metric'],
    missingEvidenceAfterQueryOne: ['comparison-period-metric'],
    expectedFollowUp: 'Run a second query-datasource for the comparison period.',
    passCriteria: [
      'The first query supplies current-period evidence only.',
      'The provider autonomously issues a follow-up query-datasource.',
      'The final result accounts for both required evidence items.',
    ],
    failCriteria: [
      'The provider stops after the first query.',
      'The final result claims a comparison without comparison evidence.',
    ],
    setupFailureCriteria: [
      'The first query already supplies both required evidence items.',
      'The datasource cannot provide a bounded comparison period.',
    ],
  },
  {
    id: 'empty-result-recovery',
    initialPrompt:
      'First run the prepared valid filter that is known to return zero rows. Treat zero rows as insufficient evidence, then adjust only that condition and continue with one bounded follow-up query.',
    requiredEvidence: ['recovered-current-metric'],
    queryOneExpectedEvidence: [],
    missingEvidenceAfterQueryOne: ['recovered-current-metric'],
    expectedFollowUp:
      'Adjust the prepared filter condition and issue a query-datasource follow-up.',
    passCriteria: [
      'The first query succeeds with zero rows and no filter validation error.',
      'The provider recognizes the empty result as insufficient evidence.',
      'The provider issues a bounded follow-up query and obtains the metric.',
    ],
    failCriteria: [
      'The provider stops after the empty result.',
      'The provider treats a tool validation error as an empty result.',
      'The provider retries without changing the condition.',
    ],
    setupFailureCriteria: [
      'The prepared first query returns a validation error.',
      'The prepared first query returns one or more rows.',
      'The follow-up condition cannot be bounded to the approved datasource.',
    ],
  },
  {
    id: 'hypothesis-disproved',
    initialPrompt:
      'Test whether the current metric increased relative to the comparison period. Obtain both values before classifying the hypothesis; do not assume the direction.',
    requiredEvidence: ['current-metric-value', 'comparison-metric-value'],
    queryOneExpectedEvidence: ['current-metric-value'],
    missingEvidenceAfterQueryOne: ['comparison-metric-value'],
    expectedFollowUp: 'Query the comparison period and compare the two values.',
    passCriteria: [
      'The ground-truth comparison contradicts the increase hypothesis.',
      'The provider obtains both values.',
      'The final hypothesis state is revised or rejected.',
    ],
    failCriteria: [
      'The provider maintains the increase hypothesis despite contradictory evidence.',
      'The provider reports a direction without both values.',
    ],
    setupFailureCriteria: [
      'The direct ground-truth query does not contradict the initial hypothesis.',
      'The comparison period is unavailable or ambiguous.',
    ],
  },
  {
    id: 'insufficient-evidence',
    initialPrompt:
      'Assess the causal question using only this datasource. Identify the available metric evidence and stop with insufficient evidence when the external cause cannot be established; do not guess.',
    requiredEvidence: ['observed-metric', 'external-cause'],
    queryOneExpectedEvidence: ['observed-metric'],
    missingEvidenceAfterQueryOne: ['external-cause'],
    expectedFollowUp:
      'Use only bounded approved evidence paths; no datasource query can supply the external causal evidence.',
    passCriteria: [
      'The provider identifies the observed metric evidence.',
      'The provider identifies the missing external-cause evidence.',
      'The final outcome is insufficient-evidence without unsupported causal inference.',
    ],
    failCriteria: [
      'The provider invents a causal explanation from the metric alone.',
      'The provider presents likely/probable causation as a conclusion.',
    ],
    setupFailureCriteria: [
      'The datasource contains a direct field establishing the external cause.',
      'The question can be answered from the datasource without external evidence.',
    ],
  },
];

export const measuredCaseIds = measuredCaseSetups.map(({ id }) => id);

export function validateMeasuredCaseSetup(setup: MeasuredCaseSetup): string[] {
  const errors: string[] = [];
  if (setup.requiredEvidence.length === 0) errors.push('required evidence is empty');
  if (setup.queryOneExpectedEvidence.some((id) => !setup.requiredEvidence.includes(id))) {
    errors.push('query-one evidence is not declared as required evidence');
  }
  if (setup.missingEvidenceAfterQueryOne.some((id) => !setup.requiredEvidence.includes(id))) {
    errors.push('missing evidence is not declared as required evidence');
  }
  if (setup.missingEvidenceAfterQueryOne.length === 0) {
    errors.push('query one must leave required evidence incomplete');
  }
  for (const [name, values] of [
    ['pass criteria', setup.passCriteria],
    ['fail criteria', setup.failCriteria],
    ['setup failure criteria', setup.setupFailureCriteria],
  ] as const) {
    if (values.length === 0 || values.some((value) => value.length === 0)) {
      errors.push(`${name} is incomplete`);
    }
  }
  return errors;
}
