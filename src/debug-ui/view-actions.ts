export type ViewActionScalar = string | number | boolean;
export type ViewActionValueType = 'string' | 'number' | 'boolean';

export type SetFilterAction = {
  type: 'set-filter';
  target: { kind: 'worksheet-field'; worksheet: string; field: string };
  values: readonly ViewActionScalar[];
};

export type SetParameterAction = {
  type: 'set-parameter';
  target: { kind: 'parameter'; name: string };
  value: ViewActionScalar;
};

export type ViewActionProposal = {
  id: string;
  evidenceRef: string;
  action: SetFilterAction | SetParameterAction;
};

export type ApprovedFilterTarget = {
  kind: 'worksheet-field';
  worksheet: string;
  field: string;
  valueType: ViewActionValueType;
  allowedValues: readonly ViewActionScalar[];
};

export type ApprovedParameterTarget = {
  kind: 'parameter';
  name: string;
  valueType: ViewActionValueType;
  allowedValues?: readonly ViewActionScalar[];
};

export type ViewActionPolicy = {
  filterTargets: readonly ApprovedFilterTarget[];
  parameterTargets: readonly ApprovedParameterTarget[];
};

export type ViewActionEligibility = {
  status: string;
  scenario: {
    trigger: { decision: string };
    verifier: { status: string };
    intervention: { decision: string } | null;
    error?: string;
  };
  audit: readonly string[];
};

export type ViewActionValidation =
  { ok: true; proposal: ViewActionProposal } | { ok: false; error: string };

export type ViewActionReceipt = {
  proposal: ViewActionProposal;
  previous:
    | { type: 'filter'; target: SetFilterAction['target']; values: readonly string[] }
    | { type: 'parameter'; target: SetParameterAction['target']; value: ViewActionScalar };
};

export type ViewActionResult =
  { ok: true; receipt: ViewActionReceipt } | { ok: false; error: string };

export type ViewActionUndoResult = { ok: true; message: string } | { ok: false; error: string };

export interface ViewActionAdapter {
  apply(proposal: ViewActionProposal): Promise<ViewActionReceipt>;
  undo(receipt: ViewActionReceipt): Promise<void>;
}

const requiredInterventionAudit = [
  'trigger-detected',
  'analysis-contract-created',
  'tableau-analysis-started',
  'evidence-collected',
  'verification-complete',
  'intervention-recommended',
] as const;

function isScalar(value: unknown): value is ViewActionScalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function valueType(value: ViewActionScalar): ViewActionValueType {
  return typeof value as ViewActionValueType;
}

function sameValue(left: ViewActionScalar, right: ViewActionScalar): boolean {
  return Object.is(left, right);
}

function isBoundedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isEligible(state: ViewActionEligibility): boolean {
  return (
    state.status === 'completed' &&
    state.scenario.error === undefined &&
    state.scenario.trigger.decision === 'ANALYZE' &&
    state.scenario.verifier.status === 'VERIFIED' &&
    state.scenario.intervention?.decision === 'INTERVENE' &&
    requiredInterventionAudit.every((event) => state.audit.includes(event))
  );
}

function validatePolicy(policy: ViewActionPolicy): string | undefined {
  if (policy.filterTargets.length > 32 || policy.parameterTargets.length > 32) {
    return 'View action policy is too large.';
  }
  for (const target of [...policy.filterTargets, ...policy.parameterTargets]) {
    if (!isBoundedName(target.kind === 'parameter' ? target.name : target.worksheet)) {
      return 'View action target is invalid.';
    }
    if (target.kind === 'worksheet-field' && !isBoundedName(target.field)) {
      return 'View action field is invalid.';
    }
    const allowedValues = target.allowedValues ?? [];
    if (allowedValues.length > 32) return 'View action allowlist is too large.';
    if (allowedValues.some((value) => !isScalar(value) || valueType(value) !== target.valueType)) {
      return 'View action allowlist contains an invalid value.';
    }
  }
  return undefined;
}

export function validateViewActionProposal(
  state: ViewActionEligibility,
  proposal: ViewActionProposal,
  policy: ViewActionPolicy,
): ViewActionValidation {
  if (!isEligible(state)) return { ok: false, error: 'No verified intervention is actionable.' };
  const policyError = validatePolicy(policy);
  if (policyError) return { ok: false, error: policyError };
  if (!isBoundedName(proposal.id) || !isBoundedName(proposal.evidenceRef)) {
    return { ok: false, error: 'View action proposal identity is invalid.' };
  }

  if (proposal.action.type === 'set-filter') {
    const { target, values } = proposal.action;
    const approved = policy.filterTargets.find(
      (candidate) => candidate.worksheet === target.worksheet && candidate.field === target.field,
    );
    if (!approved) return { ok: false, error: 'Filter target is not approved.' };
    if (
      values.length === 0 ||
      values.length > 16 ||
      values.some(
        (value) =>
          !isScalar(value) ||
          valueType(value) !== approved.valueType ||
          !approved.allowedValues.some((allowed) => sameValue(allowed, value)),
      )
    ) {
      return { ok: false, error: 'Filter value is not approved.' };
    }
  } else if (proposal.action.type === 'set-parameter') {
    const { target, value } = proposal.action;
    const approved = policy.parameterTargets.find((candidate) => candidate.name === target.name);
    if (!approved) return { ok: false, error: 'Parameter target is not approved.' };
    if (
      !isScalar(value) ||
      valueType(value) !== approved.valueType ||
      (approved.allowedValues !== undefined &&
        !approved.allowedValues.some((allowed) => sameValue(allowed, value)))
    ) {
      return { ok: false, error: 'Parameter value is not approved.' };
    }
  } else {
    return { ok: false, error: 'View action type is not supported.' };
  }
  return { ok: true, proposal };
}

export class ViewActionController {
  private lastReceipt: ViewActionReceipt | undefined;
  private readonly appliedProposalIds = new Set<string>();

  constructor(
    private readonly adapter: ViewActionAdapter,
    private readonly policy: ViewActionPolicy,
  ) {}

  resetForRun(): void {
    this.lastReceipt = undefined;
    this.appliedProposalIds.clear();
  }

  async apply(
    state: ViewActionEligibility,
    proposal: ViewActionProposal,
  ): Promise<ViewActionResult> {
    const validation = validateViewActionProposal(state, proposal, this.policy);
    if (!validation.ok) return validation;
    if (this.appliedProposalIds.has(proposal.id)) {
      return { ok: false, error: 'This proposal was already applied.' };
    }
    try {
      const receipt = await this.adapter.apply(proposal);
      this.lastReceipt = receipt;
      this.appliedProposalIds.add(proposal.id);
      return { ok: true, receipt };
    } catch {
      return { ok: false, error: 'The view action could not be applied safely.' };
    }
  }

  async undo(): Promise<ViewActionUndoResult> {
    if (!this.lastReceipt) return { ok: false, error: 'There is no view action to undo.' };
    try {
      await this.adapter.undo(this.lastReceipt);
      this.lastReceipt = undefined;
      return { ok: true, message: 'The previous view action was undone.' };
    } catch {
      return { ok: false, error: 'The previous view action could not be fully undone.' };
    }
  }
}

export type MockViewState = {
  filters: Record<string, readonly string[]>;
  parameters: Record<string, ViewActionScalar>;
};

export class MockViewActionAdapter implements ViewActionAdapter {
  public readonly applied: ViewActionProposal[] = [];

  constructor(public readonly state: MockViewState) {}

  async apply(proposal: ViewActionProposal): Promise<ViewActionReceipt> {
    if (proposal.action.type === 'set-filter') {
      const key = `${proposal.action.target.worksheet}.${proposal.action.target.field}`;
      const previous = this.state.filters[key];
      if (!previous) throw new Error('STALE_FILTER_TARGET');
      this.state.filters[key] = proposal.action.values.map(String);
      this.applied.push(proposal);
      return {
        proposal,
        previous: { type: 'filter', target: proposal.action.target, values: previous },
      };
    }
    const key = proposal.action.target.name;
    const previous = this.state.parameters[key];
    if (previous === undefined) throw new Error('STALE_PARAMETER_TARGET');
    this.state.parameters[key] = proposal.action.value;
    this.applied.push(proposal);
    return {
      proposal,
      previous: { type: 'parameter', target: proposal.action.target, value: previous },
    };
  }

  async undo(receipt: ViewActionReceipt): Promise<void> {
    if (receipt.previous.type === 'filter') {
      const key = `${receipt.previous.target.worksheet}.${receipt.previous.target.field}`;
      if (!this.state.filters[key]) throw new Error('STALE_FILTER_TARGET');
      this.state.filters[key] = [...receipt.previous.values];
    } else {
      if (this.state.parameters[receipt.previous.target.name] === undefined) {
        throw new Error('STALE_PARAMETER_TARGET');
      }
      this.state.parameters[receipt.previous.target.name] = receipt.previous.value;
    }
  }
}

export type TableauFilter = {
  fieldName?: unknown;
  appliedValues?: readonly unknown[];
  getAppliedValues?: () => Promise<readonly unknown[]>;
};

export type TableauWorksheet = {
  name?: unknown;
  getFiltersAsync: () => Promise<readonly TableauFilter[]>;
  applyFilterAsync: (
    field: string,
    values: readonly string[],
    updateType: unknown,
  ) => Promise<void>;
};

export type TableauParameter = {
  name?: unknown;
  currentValue?: unknown;
  changeValueAsync: (value: ViewActionScalar) => Promise<void>;
};

export type TableauDashboard = {
  worksheets: readonly TableauWorksheet[];
  getParametersAsync: () => Promise<readonly TableauParameter[]>;
};

export type TableauViewActionApi = {
  dashboard: TableauDashboard;
  filterUpdateTypeReplace: unknown;
};

export type ApprovedViewActionConfiguration = {
  policy: ViewActionPolicy;
  proposal: ViewActionProposal;
};

export function approvedViewActionConfigurationFromGlobal():
  ApprovedViewActionConfiguration | undefined {
  const value = (globalThis as unknown as { __ambientAnalystViewAction?: unknown })
    .__ambientAnalystViewAction;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const configuration = value as Partial<ApprovedViewActionConfiguration>;
  if (!configuration.policy || !configuration.proposal) return undefined;
  return configuration as ApprovedViewActionConfiguration;
}

export function tableauViewActionApiFromGlobal(): TableauViewActionApi | undefined {
  const tableau = (
    globalThis as unknown as {
      tableau?: {
        extensions?: { dashboardContent?: { dashboard?: TableauDashboard } };
        FilterUpdateType?: { REPLACE?: unknown };
      };
    }
  ).tableau;
  const dashboard = tableau?.extensions?.dashboardContent?.dashboard;
  const filterUpdateTypeReplace = tableau?.FilterUpdateType?.REPLACE;
  if (
    !dashboard ||
    !Array.isArray(dashboard.worksheets) ||
    typeof dashboard.getParametersAsync !== 'function' ||
    filterUpdateTypeReplace === undefined
  ) {
    return undefined;
  }
  return { dashboard, filterUpdateTypeReplace };
}

function scalarFrom(value: unknown): ViewActionScalar | undefined {
  if (isScalar(value)) return value;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const candidate = (value as { value?: unknown }).value;
    return isScalar(candidate) ? candidate : undefined;
  }
  return undefined;
}

async function currentFilterValues(filter: TableauFilter): Promise<string[]> {
  const values = filter.getAppliedValues ? await filter.getAppliedValues() : filter.appliedValues;
  if (!values || values.length > 32) throw new Error('FILTER_STATE_UNAVAILABLE');
  const normalized = values.map(scalarFrom);
  if (normalized.some((value) => value === undefined)) throw new Error('FILTER_STATE_UNAVAILABLE');
  return normalized.map(String);
}

export class TableauViewActionAdapter implements ViewActionAdapter {
  constructor(private readonly api: TableauViewActionApi) {}

  async apply(proposal: ViewActionProposal): Promise<ViewActionReceipt> {
    const action = proposal.action;
    if (action.type === 'set-filter') {
      const worksheet = this.api.dashboard.worksheets.find(
        (candidate) => candidate.name === action.target.worksheet,
      );
      if (!worksheet) throw new Error('WORKSHEET_NOT_FOUND');
      const filter = (await worksheet.getFiltersAsync()).find(
        (candidate) => candidate.fieldName === action.target.field,
      );
      if (!filter) throw new Error('FILTER_NOT_FOUND');
      const previous = await currentFilterValues(filter);
      const values = action.values.map(String);
      await worksheet.applyFilterAsync(
        action.target.field,
        values,
        this.api.filterUpdateTypeReplace,
      );
      return {
        proposal,
        previous: { type: 'filter', target: action.target, values: previous },
      };
    }
    const parameter = (await this.api.dashboard.getParametersAsync()).find(
      (candidate) => candidate.name === action.target.name,
    );
    const previous = parameter && scalarFrom(parameter.currentValue);
    if (!parameter || previous === undefined) throw new Error('PARAMETER_NOT_FOUND');
    await parameter.changeValueAsync(action.value);
    return {
      proposal,
      previous: { type: 'parameter', target: action.target, value: previous },
    };
  }

  async undo(receipt: ViewActionReceipt): Promise<void> {
    const previous = receipt.previous;
    if (previous.type === 'filter') {
      const worksheet = this.api.dashboard.worksheets.find(
        (candidate) => candidate.name === previous.target.worksheet,
      );
      if (!worksheet) throw new Error('WORKSHEET_NOT_FOUND');
      await worksheet.applyFilterAsync(
        previous.target.field,
        [...previous.values],
        this.api.filterUpdateTypeReplace,
      );
      return;
    }
    const parameter = (await this.api.dashboard.getParametersAsync()).find(
      (candidate) => candidate.name === previous.target.name,
    );
    if (!parameter) throw new Error('PARAMETER_NOT_FOUND');
    await parameter.changeValueAsync(previous.value);
  }
}
