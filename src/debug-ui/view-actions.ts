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

export type ViewActionScope = { dashboard: string };

export type ViewActionProposal = {
  id: string;
  evidenceRef: string;
  scope: ViewActionScope;
  action: SetFilterAction | SetParameterAction;
};

export type ApprovedFilterTarget = {
  kind: 'worksheet-field';
  dashboard: string;
  worksheet: string;
  field: string;
  valueType: ViewActionValueType;
  allowedValues: readonly ViewActionScalar[];
};

export type ApprovedParameterTarget = {
  kind: 'parameter';
  dashboard: string;
  name: string;
  valueType: ViewActionValueType;
  allowedValues: readonly ViewActionScalar[];
};

export type ViewActionPolicy = {
  scope: ViewActionScope;
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
    | {
        type: 'filter';
        target: SetFilterAction['target'];
        values: readonly ViewActionScalar[];
        allSelected: boolean;
      }
    | { type: 'parameter'; target: SetParameterAction['target']; value: ViewActionScalar };
};

export type ViewActionResult =
  { ok: true; receipt: ViewActionReceipt } | { ok: false; error: string; partial: boolean };

export type ViewActionUndoResult =
  { ok: true; message: string } | { ok: false; error: string; partial: boolean };

export class ViewActionFailure extends Error {
  constructor(
    message: string,
    readonly partial: boolean,
  ) {
    super(message);
    this.name = 'ViewActionFailure';
  }
}

export interface ViewActionAdapter {
  apply(proposal: ViewActionProposal): Promise<ViewActionReceipt>;
  undo(receipt: ViewActionReceipt): Promise<void>;
  reset?(): void;
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

export function isViewActionEligible(state: ViewActionEligibility): boolean {
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
  if (!policy || !Array.isArray(policy.filterTargets) || !Array.isArray(policy.parameterTargets)) {
    return 'View action policy is invalid.';
  }
  if (!isBoundedName(policy.scope?.dashboard)) return 'View action scope is invalid.';
  if (policy.filterTargets.length > 32 || policy.parameterTargets.length > 32) {
    return 'View action policy is too large.';
  }
  for (const target of policy.filterTargets) {
    if (target.kind !== 'worksheet-field') return 'View action target kind is invalid.';
    if (!isBoundedName(target.dashboard) || target.dashboard !== policy.scope.dashboard) {
      return 'View action target scope is invalid.';
    }
    if (!isBoundedName(target.worksheet)) return 'View action target is invalid.';
    if (!isBoundedName(target.field)) return 'View action field is invalid.';
    if (!Array.isArray(target.allowedValues)) return 'View action allowlist is required.';
    const allowedValues = target.allowedValues;
    if (allowedValues.length > 32) return 'View action allowlist is too large.';
    if (
      allowedValues.some(
        (value: unknown) => !isScalar(value) || valueType(value) !== target.valueType,
      )
    ) {
      return 'View action allowlist contains an invalid value.';
    }
  }
  for (const target of policy.parameterTargets) {
    if (target.kind !== 'parameter') return 'View action target kind is invalid.';
    if (!isBoundedName(target.dashboard) || target.dashboard !== policy.scope.dashboard) {
      return 'View action target scope is invalid.';
    }
    if (!isBoundedName(target.name)) return 'View action target is invalid.';
    if (!Array.isArray(target.allowedValues)) return 'View action allowlist is required.';
    const allowedValues = target.allowedValues;
    if (allowedValues.length > 32) return 'View action allowlist is too large.';
    if (
      allowedValues.some(
        (value: unknown) => !isScalar(value) || valueType(value) !== target.valueType,
      )
    ) {
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
  const parsedPolicy = parsePolicy(policy);
  const parsedProposal = parseProposal(proposal);
  if (!parsedPolicy || !parsedProposal) {
    return { ok: false, error: 'View action configuration is malformed.' };
  }
  if (!isViewActionEligible(state))
    return { ok: false, error: 'No verified intervention is actionable.' };
  return validateApprovedProposal(parsedProposal, parsedPolicy);
}

function validateApprovedProposal(
  proposal: ViewActionProposal,
  policy: ViewActionPolicy,
): ViewActionValidation {
  const policyError = validatePolicy(policy);
  if (policyError) return { ok: false, error: policyError };
  if (
    !isBoundedName(proposal.id) ||
    !isBoundedName(proposal.evidenceRef) ||
    !isBoundedName(proposal.scope?.dashboard) ||
    proposal.scope.dashboard !== policy.scope.dashboard
  ) {
    return { ok: false, error: 'View action scope or identity is invalid.' };
  }

  if (proposal.action.type === 'set-filter') {
    const { target, values } = proposal.action;
    const approved = policy.filterTargets.find(
      (candidate) =>
        candidate.kind === 'worksheet-field' &&
        candidate.dashboard === proposal.scope.dashboard &&
        candidate.worksheet === target.worksheet &&
        candidate.field === target.field,
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
    const approved = policy.parameterTargets.find(
      (candidate) =>
        candidate.kind === 'parameter' &&
        candidate.dashboard === proposal.scope.dashboard &&
        candidate.name === target.name,
    );
    if (!approved) return { ok: false, error: 'Parameter target is not approved.' };
    if (
      !isScalar(value) ||
      valueType(value) !== approved.valueType ||
      !approved.allowedValues.some((allowed) => sameValue(allowed, value))
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
  private inFlight = false;
  private inFlightEpoch: number | undefined;
  private epoch = 0;
  private resetPending = false;

  constructor(
    private readonly adapter: ViewActionAdapter,
    private readonly policy: ViewActionPolicy,
  ) {}

  resetForRun(): void {
    this.epoch += 1;
    this.lastReceipt = undefined;
    this.appliedProposalIds.clear();
    if (this.inFlight) {
      this.resetPending = true;
    } else {
      this.adapter.reset?.();
    }
  }

  async apply(
    state: ViewActionEligibility,
    proposal: ViewActionProposal,
  ): Promise<ViewActionResult> {
    const validation = validateViewActionProposal(state, proposal, this.policy);
    if (!validation.ok) return { ...validation, partial: false };
    if (this.inFlight) {
      return { ok: false, error: 'Another view action is still in progress.', partial: false };
    }
    if (this.appliedProposalIds.has(proposal.id)) {
      return { ok: false, error: 'This proposal was already applied.', partial: false };
    }
    const operationEpoch = this.epoch;
    this.inFlight = true;
    this.inFlightEpoch = operationEpoch;
    try {
      const receipt = await this.adapter.apply(proposal);
      if (operationEpoch !== this.epoch) {
        return {
          ok: false,
          error: 'This view action was invalidated by a new run or host scope.',
          partial: true,
        };
      }
      this.lastReceipt = receipt;
      this.appliedProposalIds.add(proposal.id);
      return { ok: true, receipt };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ViewActionFailure
            ? error.message
            : 'The view action could not be applied safely; its final state is unknown.',
        partial: error instanceof ViewActionFailure ? error.partial : true,
      };
    } finally {
      if (this.inFlightEpoch === operationEpoch) {
        this.inFlight = false;
        this.inFlightEpoch = undefined;
        if (this.resetPending) {
          this.resetPending = false;
          this.adapter.reset?.();
        }
      }
    }
  }

  async undo(): Promise<ViewActionUndoResult> {
    if (this.inFlight) {
      return { ok: false, error: 'Another view action is still in progress.', partial: false };
    }
    if (!this.lastReceipt) {
      return { ok: false, error: 'There is no view action to undo.', partial: false };
    }
    const operationEpoch = this.epoch;
    const receipt = this.lastReceipt;
    this.inFlight = true;
    this.inFlightEpoch = operationEpoch;
    try {
      await this.adapter.undo(receipt);
      if (operationEpoch !== this.epoch) {
        return {
          ok: false,
          error: 'This view action undo was invalidated by a new run or host scope.',
          partial: true,
        };
      }
      this.lastReceipt = undefined;
      return { ok: true, message: 'The previous view action was undone.' };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ViewActionFailure
            ? error.message
            : 'The previous view action may be only partially undone; verify the dashboard state.',
        partial: error instanceof ViewActionFailure ? error.partial : true,
      };
    } finally {
      if (this.inFlightEpoch === operationEpoch) {
        this.inFlight = false;
        this.inFlightEpoch = undefined;
        if (this.resetPending) {
          this.resetPending = false;
          this.adapter.reset?.();
        }
      }
    }
  }
}

export type MockViewState = {
  filters: Record<string, readonly string[]>;
  parameters: Record<string, ViewActionScalar>;
};

export class MockViewActionAdapter implements ViewActionAdapter {
  public readonly applied: ViewActionProposal[] = [];
  private readonly initialState: MockViewState;

  constructor(public readonly state: MockViewState) {
    this.initialState = {
      filters: Object.fromEntries(
        Object.entries(state.filters).map(([key, values]) => [key, [...values]]),
      ),
      parameters: { ...state.parameters },
    };
  }

  async apply(proposal: ViewActionProposal): Promise<ViewActionReceipt> {
    if (proposal.action.type === 'set-filter') {
      const key = `${proposal.action.target.worksheet}.${proposal.action.target.field}`;
      const previous = this.state.filters[key];
      if (!previous) throw new ViewActionFailure('STALE_FILTER_TARGET', false);
      this.state.filters[key] = proposal.action.values.map(String);
      this.applied.push(proposal);
      return {
        proposal,
        previous: {
          type: 'filter',
          target: proposal.action.target,
          values: previous,
          allSelected: false,
        },
      };
    }
    const key = proposal.action.target.name;
    const previous = this.state.parameters[key];
    if (previous === undefined) throw new ViewActionFailure('STALE_PARAMETER_TARGET', false);
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
      if (!this.state.filters[key]) throw new ViewActionFailure('STALE_FILTER_TARGET', false);
      this.state.filters[key] = receipt.previous.values.map(String);
    } else {
      if (this.state.parameters[receipt.previous.target.name] === undefined) {
        throw new ViewActionFailure('STALE_PARAMETER_TARGET', false);
      }
      this.state.parameters[receipt.previous.target.name] = receipt.previous.value;
    }
  }

  reset(): void {
    for (const [key, values] of Object.entries(this.initialState.filters)) {
      this.state.filters[key] = [...values];
    }
    for (const [key, value] of Object.entries(this.initialState.parameters)) {
      this.state.parameters[key] = value;
    }
    this.applied.length = 0;
  }
}

export type TableauFilter = {
  fieldId?: unknown;
  fieldName?: unknown;
  filterType?: unknown;
  isAllSelected?: unknown;
  appliedValues?: readonly unknown[];
  getAppliedValues?: () => Promise<readonly unknown[]>;
  getDomainAsync?: () => Promise<{ values?: readonly unknown[] }>;
};

export type TableauWorksheet = {
  id?: unknown;
  name?: unknown;
  getFiltersAsync: () => Promise<readonly TableauFilter[]>;
  applyFilterAsync: (
    field: string,
    values: readonly string[],
    updateType: unknown,
  ) => Promise<void>;
  clearFilterAsync?: (field: string) => Promise<void>;
};

export type TableauParameter = {
  id?: unknown;
  dataType?: unknown;
  name?: unknown;
  currentValue?: unknown;
  allowableValues?: {
    type?: unknown;
    allowableValues?: readonly unknown[];
    minValue?: unknown;
    maxValue?: unknown;
    stepSize?: unknown;
    dateStepPeriod?: unknown;
  };
  getAllowableValuesAsync?: () => Promise<{
    type?: unknown;
    allowableValues?: readonly unknown[];
    minValue?: unknown;
    maxValue?: unknown;
    stepSize?: unknown;
    dateStepPeriod?: unknown;
  }>;
  changeValueAsync: (value: ViewActionScalar) => Promise<void>;
};

export type TableauDashboard = {
  name?: unknown;
  worksheets: readonly TableauWorksheet[];
  getParametersAsync: () => Promise<readonly TableauParameter[]>;
};

export type TableauViewActionApi = {
  dashboard: TableauDashboard;
  filterUpdateTypeReplace: unknown;
  filterTypeCategorical: unknown;
};

export type ApprovedViewActionConfiguration = {
  policy: ViewActionPolicy;
  proposal?: ViewActionProposal;
  mappings?: unknown;
};

export function approvedViewActionConfigurationFromGlobal():
  ApprovedViewActionConfiguration | undefined {
  const value = (globalThis as unknown as { __ambientAnalystViewAction?: unknown })
    .__ambientAnalystViewAction;
  return parseApprovedViewActionConfiguration(value);
}

function parseScalarList(value: unknown): ViewActionScalar[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return undefined;
  return value.every(isScalar) ? [...value] : undefined;
}

function parseValueType(value: unknown): ViewActionValueType | undefined {
  return value === 'string' || value === 'number' || value === 'boolean' ? value : undefined;
}

function parsePolicy(value: unknown): ViewActionPolicy | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as {
    scope?: unknown;
    filterTargets?: unknown;
    parameterTargets?: unknown;
  };
  if (!Array.isArray(candidate.filterTargets) || !Array.isArray(candidate.parameterTargets)) {
    return undefined;
  }
  if (
    typeof candidate.scope !== 'object' ||
    candidate.scope === null ||
    !isBoundedName((candidate.scope as { dashboard?: unknown }).dashboard)
  ) {
    return undefined;
  }
  const scope = { dashboard: (candidate.scope as { dashboard: string }).dashboard };
  const filterTargets: ApprovedFilterTarget[] = [];
  for (const target of candidate.filterTargets) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return undefined;
    const item = target as Record<string, unknown>;
    const parsedType = parseValueType(item.valueType);
    const allowedValues = parseScalarList(item.allowedValues);
    if (
      item.kind !== 'worksheet-field' ||
      !isBoundedName(item.dashboard) ||
      !isBoundedName(item.worksheet) ||
      !isBoundedName(item.field) ||
      !parsedType ||
      !allowedValues ||
      allowedValues.some((entry) => valueType(entry) !== parsedType)
    ) {
      return undefined;
    }
    filterTargets.push({
      kind: 'worksheet-field',
      dashboard: item.dashboard,
      worksheet: item.worksheet,
      field: item.field,
      valueType: parsedType,
      allowedValues,
    });
  }
  const parameterTargets: ApprovedParameterTarget[] = [];
  for (const target of candidate.parameterTargets) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return undefined;
    const item = target as Record<string, unknown>;
    const parsedType = parseValueType(item.valueType);
    const allowedValues = parseScalarList(item.allowedValues);
    if (
      item.kind !== 'parameter' ||
      !isBoundedName(item.dashboard) ||
      !isBoundedName(item.name) ||
      !parsedType ||
      !allowedValues ||
      allowedValues.some((entry) => valueType(entry) !== parsedType)
    ) {
      return undefined;
    }
    parameterTargets.push({
      kind: 'parameter',
      dashboard: item.dashboard,
      name: item.name,
      valueType: parsedType,
      allowedValues,
    });
  }
  const policy = { scope, filterTargets, parameterTargets } satisfies ViewActionPolicy;
  return validatePolicy(policy) ? undefined : policy;
}

function parseProposal(value: unknown): ViewActionProposal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!isBoundedName(candidate.id) || !isBoundedName(candidate.evidenceRef)) return undefined;
  if (
    typeof candidate.scope !== 'object' ||
    candidate.scope === null ||
    !isBoundedName((candidate.scope as { dashboard?: unknown }).dashboard)
  ) {
    return undefined;
  }
  const scope = { dashboard: (candidate.scope as { dashboard: string }).dashboard };
  if (typeof candidate.action !== 'object' || candidate.action === null) return undefined;
  const action = candidate.action as Record<string, unknown>;
  if (action.type === 'set-filter') {
    if (typeof action.target !== 'object' || action.target === null) return undefined;
    const target = action.target as Record<string, unknown>;
    if (
      target.kind !== 'worksheet-field' ||
      !isBoundedName(target.worksheet) ||
      !isBoundedName(target.field)
    ) {
      return undefined;
    }
    const values = parseScalarList(action.values);
    if (!values || values.length > 16) return undefined;
    return {
      id: candidate.id,
      evidenceRef: candidate.evidenceRef,
      scope,
      action: {
        type: 'set-filter',
        target: {
          kind: 'worksheet-field',
          worksheet: target.worksheet,
          field: target.field,
        },
        values,
      },
    };
  }
  if (action.type === 'set-parameter') {
    if (typeof action.target !== 'object' || action.target === null) return undefined;
    const target = action.target as Record<string, unknown>;
    if (target.kind !== 'parameter' || !isBoundedName(target.name) || !isScalar(action.value)) {
      return undefined;
    }
    return {
      id: candidate.id,
      evidenceRef: candidate.evidenceRef,
      scope,
      action: {
        type: 'set-parameter',
        target: { kind: 'parameter', name: target.name },
        value: action.value,
      },
    };
  }
  return undefined;
}

function parseApprovedViewActionConfiguration(
  value: unknown,
): ApprovedViewActionConfiguration | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { policy?: unknown; proposal?: unknown; mappings?: unknown };
  const policy = parsePolicy(candidate.policy);
  const proposal = parseProposal(candidate.proposal);
  if (!policy) return undefined;
  return {
    policy,
    ...(proposal ? { proposal } : {}),
    ...(candidate.mappings !== undefined ? { mappings: candidate.mappings } : {}),
  };
}

export function tableauViewActionApiFromGlobal(): TableauViewActionApi | undefined {
  const tableau = (
    globalThis as unknown as {
      tableau?: {
        extensions?: { dashboardContent?: { dashboard?: TableauDashboard } };
        FilterUpdateType?: { Replace?: unknown };
        FilterType?: { Categorical?: unknown };
      };
    }
  ).tableau;
  const dashboard = tableau?.extensions?.dashboardContent?.dashboard;
  const filterUpdateTypeReplace = tableau?.FilterUpdateType?.Replace;
  const filterTypeCategorical = tableau?.FilterType?.Categorical;
  if (
    !dashboard ||
    !Array.isArray(dashboard.worksheets) ||
    typeof dashboard.getParametersAsync !== 'function' ||
    filterUpdateTypeReplace === undefined ||
    filterTypeCategorical === undefined ||
    !isBoundedName(dashboard.name)
  ) {
    return undefined;
  }
  return { dashboard, filterUpdateTypeReplace, filterTypeCategorical };
}

function scalarFrom(value: unknown): ViewActionScalar | undefined {
  if (isScalar(value)) return value;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const candidate = (value as { value?: unknown }).value;
    return isScalar(candidate) ? candidate : undefined;
  }
  return undefined;
}

async function currentFilterState(
  filter: TableauFilter,
): Promise<{ values: ViewActionScalar[]; allSelected: boolean }> {
  const values = filter.getAppliedValues ? await filter.getAppliedValues() : filter.appliedValues;
  if (!values || values.length > 32) throw new ViewActionFailure('FILTER_STATE_UNAVAILABLE', false);
  const normalized = values.map(scalarFrom);
  if (normalized.some((value) => value === undefined)) {
    throw new ViewActionFailure('FILTER_STATE_UNAVAILABLE', false);
  }
  if (typeof filter.isAllSelected !== 'boolean') {
    throw new ViewActionFailure('FILTER_SELECTION_MODE_UNAVAILABLE', false);
  }
  return { values: normalized as ViewActionScalar[], allSelected: filter.isAllSelected };
}

function hasSameValues(
  left: readonly ViewActionScalar[],
  right: readonly ViewActionScalar[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function filterDomainValues(filter: TableauFilter): Promise<ViewActionScalar[]> {
  if (!filter.getDomainAsync) {
    throw new ViewActionFailure('FILTER_DOMAIN_UNAVAILABLE', false);
  }
  const domain = await filter.getDomainAsync();
  const values = domain?.values;
  if (!values) throw new ViewActionFailure('FILTER_DOMAIN_UNAVAILABLE', false);
  if (values.length > 32) throw new ViewActionFailure('FILTER_DOMAIN_TOO_LARGE', false);
  const normalized = values.map(scalarFrom);
  if (normalized.some((value) => value === undefined)) {
    throw new ViewActionFailure('FILTER_DOMAIN_UNAVAILABLE', false);
  }
  return normalized as ViewActionScalar[];
}

async function parameterDomainValues(parameter: TableauParameter): Promise<ViewActionScalar[]> {
  const restriction = parameter.getAllowableValuesAsync
    ? await parameter.getAllowableValuesAsync()
    : parameter.allowableValues;
  const values = restriction?.allowableValues;
  if (!values || values.length > 32) {
    throw new ViewActionFailure('PARAMETER_DOMAIN_UNAVAILABLE', false);
  }
  const normalized = values.map(scalarFrom);
  if (normalized.some((value) => value === undefined)) {
    throw new ViewActionFailure('PARAMETER_DOMAIN_UNAVAILABLE', false);
  }
  return normalized as ViewActionScalar[];
}

export class TableauViewActionAdapter implements ViewActionAdapter {
  constructor(
    private readonly api: TableauViewActionApi,
    private readonly policy: ViewActionPolicy,
  ) {}

  async apply(proposal: ViewActionProposal): Promise<ViewActionReceipt> {
    const authorization = validateApprovedProposal(proposal, this.policy);
    if (!authorization.ok) {
      throw new ViewActionFailure(authorization.error, false);
    }
    if (this.api.dashboard.name !== this.policy.scope.dashboard) {
      throw new ViewActionFailure('DASHBOARD_SCOPE_MISMATCH', false);
    }
    const action = proposal.action;
    if (action.type === 'set-filter') {
      const worksheet = this.api.dashboard.worksheets.find(
        (candidate) => candidate.name === action.target.worksheet,
      );
      if (!worksheet) throw new ViewActionFailure('WORKSHEET_NOT_FOUND', false);
      const filter = (await worksheet.getFiltersAsync()).find(
        (candidate) => candidate.fieldName === action.target.field,
      );
      if (!filter) throw new ViewActionFailure('FILTER_NOT_FOUND', false);
      if (filter.filterType !== this.api.filterTypeCategorical) {
        throw new ViewActionFailure('UNSUPPORTED_FILTER_TYPE', false);
      }
      const previous = await currentFilterState(filter);
      const domain = await filterDomainValues(filter);
      if (action.values.some((value) => !domain.some((candidate) => sameValue(candidate, value)))) {
        throw new ViewActionFailure('FILTER_VALUE_NOT_CURRENTLY_SUPPORTED', false);
      }
      const values = action.values.map(String);
      try {
        await worksheet.applyFilterAsync(
          action.target.field,
          values,
          this.api.filterUpdateTypeReplace,
        );
      } catch {
        throw new ViewActionFailure('FILTER_APPLY_PARTIAL_OR_UNKNOWN', true);
      }
      return {
        proposal,
        previous: { type: 'filter', target: action.target, ...previous },
      };
    }
    const parameter = (await this.api.dashboard.getParametersAsync()).find(
      (candidate) => candidate.name === action.target.name,
    );
    const previous = parameter && scalarFrom(parameter.currentValue);
    if (!parameter || previous === undefined) {
      throw new ViewActionFailure('PARAMETER_NOT_FOUND', false);
    }
    const domain = await parameterDomainValues(parameter);
    if (!domain.some((candidate) => sameValue(candidate, action.value))) {
      throw new ViewActionFailure('PARAMETER_VALUE_NOT_CURRENTLY_SUPPORTED', false);
    }
    try {
      await parameter.changeValueAsync(action.value);
    } catch {
      throw new ViewActionFailure('PARAMETER_APPLY_PARTIAL_OR_UNKNOWN', true);
    }
    return {
      proposal,
      previous: { type: 'parameter', target: action.target, value: previous },
    };
  }

  async undo(receipt: ViewActionReceipt): Promise<void> {
    if (this.api.dashboard.name !== this.policy.scope.dashboard) {
      throw new ViewActionFailure('DASHBOARD_SCOPE_MISMATCH', true);
    }
    const previous = receipt.previous;
    if (previous.type === 'filter') {
      const worksheet = this.api.dashboard.worksheets.find(
        (candidate) => candidate.name === previous.target.worksheet,
      );
      if (!worksheet) throw new ViewActionFailure('UNDO_TARGET_NOT_FOUND', true);
      const filter = (await worksheet.getFiltersAsync()).find(
        (candidate) => candidate.fieldName === previous.target.field,
      );
      if (!filter) throw new ViewActionFailure('UNDO_TARGET_NOT_FOUND', true);
      if (filter.filterType !== this.api.filterTypeCategorical) {
        throw new ViewActionFailure('UNSUPPORTED_FILTER_TYPE', true);
      }
      const current = await currentFilterState(filter);
      const expected = receipt.proposal.action;
      if (
        expected.type !== 'set-filter' ||
        current.allSelected ||
        !hasSameValues(current.values, expected.values)
      ) {
        throw new ViewActionFailure('UNDO_EXTERNAL_STATE_DIVERGED', true);
      }
      const domain = await filterDomainValues(filter);
      if (
        !previous.allSelected &&
        previous.values.some((value) => !domain.some((candidate) => sameValue(candidate, value)))
      ) {
        throw new ViewActionFailure('UNDO_PREVIOUS_VALUE_UNAVAILABLE', true);
      }
      try {
        if (previous.allSelected) {
          if (!worksheet.clearFilterAsync) {
            throw new ViewActionFailure('FILTER_ALL_RESTORE_UNAVAILABLE', true);
          }
          await worksheet.clearFilterAsync(previous.target.field);
        } else {
          await worksheet.applyFilterAsync(
            previous.target.field,
            previous.values.map(String),
            this.api.filterUpdateTypeReplace,
          );
        }
      } catch {
        throw new ViewActionFailure('FILTER_UNDO_PARTIAL_OR_UNKNOWN', true);
      }
      return;
    }
    const parameter = (await this.api.dashboard.getParametersAsync()).find(
      (candidate) => candidate.name === previous.target.name,
    );
    if (!parameter) throw new ViewActionFailure('UNDO_TARGET_NOT_FOUND', true);
    const current = scalarFrom(parameter.currentValue);
    const expected = receipt.proposal.action;
    if (
      expected.type !== 'set-parameter' ||
      current === undefined ||
      !sameValue(current, expected.value)
    ) {
      throw new ViewActionFailure('UNDO_EXTERNAL_STATE_DIVERGED', true);
    }
    const domain = await parameterDomainValues(parameter);
    if (!domain.some((candidate) => sameValue(candidate, previous.value))) {
      throw new ViewActionFailure('UNDO_PREVIOUS_VALUE_UNAVAILABLE', true);
    }
    try {
      await parameter.changeValueAsync(previous.value);
    } catch {
      throw new ViewActionFailure('PARAMETER_UNDO_PARTIAL_OR_UNKNOWN', true);
    }
  }
}
