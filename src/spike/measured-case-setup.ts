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
      'Determine whether recent view-count changes are attributable to a particular workbook. First inspect the month-level aggregate trend, then obtain a workbook-level breakdown. Do not conclude from the trend alone.',
    requiredEvidence: ['monthly-view-trend', 'workbook-view-breakdown'],
    queryOneExpectedEvidence: ['monthly-view-trend'],
    missingEvidenceAfterQueryOne: ['workbook-view-breakdown'],
    expectedFollowUp:
      'Run a second query-datasource grouped by Workbook Title with aggregated view count.',
    passCriteria: [
      'The first query supplies the month-level trend only.',
      'The provider autonomously issues a workbook breakdown query.',
      'The final result accounts for both required evidence items.',
    ],
    failCriteria: [
      'The provider stops after the first query.',
      'The final result attributes the trend without workbook evidence.',
    ],
    setupFailureCriteria: [
      'The first query already supplies both required evidence items.',
      'The datasource cannot provide both a month-level aggregate and a workbook breakdown.',
    ],
  },
  {
    id: 'empty-result-recovery',
    initialPrompt:
      'First run the prepared valid future-date filter that is known to return zero rows. Treat zero rows as insufficient evidence, then remove only that date condition and continue with one bounded follow-up query.',
    requiredEvidence: ['recovered-current-metric'],
    queryOneExpectedEvidence: [],
    missingEvidenceAfterQueryOne: ['recovered-current-metric'],
    expectedFollowUp:
      'Remove the prepared future-date condition and issue a query-datasource follow-up.',
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
      'Test the hypothesis that "#B2VB 2024 Week 22 | Sports Viz Sunday x B2VB | #VOTD" has the highest aggregated view count. Obtain the workbook ranking before classifying the hypothesis; do not assume the direction.',
    requiredEvidence: ['workbook-view-ranking'],
    queryOneExpectedEvidence: [],
    missingEvidenceAfterQueryOne: ['workbook-view-ranking'],
    expectedFollowUp:
      'Run a bounded Workbook Title plus aggregated view-count query and compare the ranking.',
    passCriteria: [
      'The direct ground-truth ranking contradicts the initial workbook hypothesis.',
      'The provider obtains the workbook ranking.',
      'The final hypothesis state is revised or rejected.',
    ],
    failCriteria: [
      'The provider maintains the false hypothesis despite contradictory evidence.',
      'The provider reports a ranking without obtaining the ranking evidence.',
    ],
    setupFailureCriteria: [
      'The selected initial hypothesis is actually true.',
      'The workbook ranking is unavailable or ambiguous.',
    ],
  },
  {
    id: 'insufficient-evidence',
    initialPrompt:
      'Assess why a particular workbook has a higher view count using only this datasource. Identify the observed timing and workbook metrics, then stop with insufficient evidence when the external cause cannot be established; do not guess.',
    requiredEvidence: ['observed-view-metrics', 'external-cause'],
    queryOneExpectedEvidence: ['observed-view-metrics'],
    missingEvidenceAfterQueryOne: ['external-cause'],
    expectedFollowUp:
      'Use only bounded approved evidence paths; no datasource query can supply external referral, campaign, event, or search evidence.',
    passCriteria: [
      'The provider identifies the observed view metrics.',
      'The provider identifies the missing external-cause evidence.',
      'The final outcome is insufficient-evidence without unsupported causal inference.',
    ],
    failCriteria: [
      'The provider invents a causal explanation from the metric alone.',
      'The provider presents likely/probable causation as a conclusion.',
    ],
    setupFailureCriteria: [
      'The datasource contains a direct field establishing an external cause.',
      'The question can be answered without external referral or campaign evidence.',
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
