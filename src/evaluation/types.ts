export type EvaluationOutcomeType = 'supported' | 'revised' | 'rejected' | 'insufficient-evidence';

export type EvaluationAction =
  'get-metric' | 'compare-periods' | 'break-down' | 'adjust-filter' | 'reconcile';

export type FixtureResponseStatus = 'available' | 'empty' | 'error' | 'unavailable' | 'conflicting';

export type EvidenceRequirement = {
  id: string;
  description: string;
};

export type EvaluationExpectation = {
  kind: string;
  description: string;
};

export type FixtureResponse = {
  action: EvaluationAction;
  description: string;
  result: string;
  evidence: readonly string[];
  status: FixtureResponseStatus;
};

export type EvaluationFixture = {
  responses: readonly FixtureResponse[];
};

export type EvaluationCase = {
  id: string;
  title: string;
  analysisGoal: string;
  initialHypothesis?: string;
  requiredEvidence: readonly EvidenceRequirement[];
  optionalEvidence?: readonly EvidenceRequirement[];
  expectedChallenge: string;
  completionCondition: string;
  expectedOutcomeType: EvaluationOutcomeType;
  allowedToolBehavior: readonly EvaluationAction[];
  fixture: EvaluationFixture;
  expectations: {
    must: readonly EvaluationExpectation[];
    mustNot: readonly EvaluationExpectation[];
  };
};
