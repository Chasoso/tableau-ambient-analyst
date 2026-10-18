import type {
  TableauFilter,
  TableauParameter,
  TableauViewActionApi,
  TableauWorksheet,
  ViewActionScalar,
  ViewActionValueType,
} from './view-actions.js';

export const capabilityCatalogLimits = {
  worksheets: 32,
  filtersPerWorksheet: 32,
  parameters: 32,
  valuesPerCapability: 32,
} as const;

export type CapabilityReadStatus = 'available' | 'unavailable' | 'unsupported' | 'failed';
export type CandidateStatus = 'eligible' | 'ineligible' | 'unknown';

export type CapabilityState = {
  read: CapabilityReadStatus;
  candidate: CandidateStatus;
  candidateReason?: string;
  /** Discovery never changes these states or grants policy authorization. */
  authorization: { approved: false; executable: false; reason: 'DISCOVERY_ONLY' };
};

export type CapabilityIssue = {
  scope: string;
  reason: string;
};

export type CapabilityValue = ViewActionScalar;

export type ParameterDomain =
  | { kind: 'list'; values?: readonly CapabilityValue[]; reason?: string }
  | {
      kind: 'range';
      minValue?: CapabilityValue;
      maxValue?: CapabilityValue;
      stepSize?: number;
      dateStepPeriod?: string;
      reason?: string;
    };

export type FilterCapability = {
  kind: 'filter';
  identity: string;
  worksheet: { name: string; identity: string; index: number; worksheetId?: string };
  field: string;
  fieldId?: string;
  filterType: string;
  valueType?: ViewActionValueType;
  currentValues?: readonly CapabilityValue[];
  allSelected?: boolean;
  candidateValues?: readonly CapabilityValue[];
  state: CapabilityState;
};

export type ParameterCapability = {
  kind: 'parameter';
  identity: string;
  index: number;
  name: string;
  parameterId?: string;
  dataType?: string;
  valueType?: ViewActionValueType;
  currentValue?: CapabilityValue;
  candidateValues?: readonly CapabilityValue[];
  domain?: ParameterDomain;
  state: CapabilityState;
};

export type WorksheetCapability = {
  name: string;
  worksheetId?: string;
  identity: string;
  index: number;
  read: CapabilityReadStatus;
  reason?: string;
  filters: readonly FilterCapability[];
};

export type CapabilityCatalog = {
  version: 1;
  dashboard: { name: string; identity: string };
  source: { scope: 'active-tableau-dashboard'; host: 'tableau-extensions-api' };
  freshness: { status: 'fresh'; capturedAt: string; requestId: number };
  worksheets: readonly WorksheetCapability[];
  parameters: readonly ParameterCapability[];
  issues: readonly CapabilityIssue[];
};

export type DiscoveryResult =
  | { status: 'applied'; catalog: CapabilityCatalog }
  | { status: 'unavailable'; reason: string }
  | { status: 'stale'; reason: 'SUPERSEDED_REFRESH' | 'DASHBOARD_SCOPE_CHANGED' };

const authorization = {
  approved: false,
  executable: false,
  reason: 'DISCOVERY_ONLY' as const,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function scalarFrom(value: unknown): CapabilityValue | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (isRecord(value) && 'value' in value) return scalarFrom(value.value);
  return undefined;
}

function typeOfValues(values: readonly CapabilityValue[]): ViewActionValueType | undefined {
  if (values.length === 0) return undefined;
  const type = typeof values[0] as ViewActionValueType;
  return values.every((value) => typeof value === type) &&
    ['string', 'number', 'boolean'].includes(type)
    ? type
    : undefined;
}

function state(
  read: CapabilityReadStatus,
  candidate: CandidateStatus,
  candidateReason?: string,
): CapabilityState {
  return {
    read,
    candidate,
    ...(candidateReason ? { candidateReason } : {}),
    authorization,
  };
}

function errorReason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length <= 200 ? error.message : fallback;
}

function boundedValues(
  value: unknown,
):
  | { status: 'available'; values: CapabilityValue[]; valueType?: ViewActionValueType }
  | { status: 'unavailable' | 'unsupported' | 'failed'; reason: string } {
  if (!Array.isArray(value)) return { status: 'unavailable', reason: 'VALUES_UNAVAILABLE' };
  if (value.length > capabilityCatalogLimits.valuesPerCapability) {
    return { status: 'unsupported', reason: 'VALUE_DOMAIN_TOO_LARGE' };
  }
  const values = value.map(scalarFrom);
  if (values.some((entry) => entry === undefined)) {
    return { status: 'failed', reason: 'MALFORMED_VALUE' };
  }
  const normalized = values as CapabilityValue[];
  const valueType = typeOfValues(normalized);
  if (normalized.length > 0 && !valueType) {
    return { status: 'failed', reason: 'MIXED_VALUE_TYPES' };
  }
  return { status: 'available', values: normalized, ...(valueType ? { valueType } : {}) };
}

type ParameterRestriction = {
  type?: unknown;
  allowableValues?: unknown;
  minValue?: unknown;
  maxValue?: unknown;
  stepSize?: unknown;
  dateStepPeriod?: unknown;
};

function parameterRestriction(
  restriction: ParameterRestriction | undefined,
):
  | { status: 'available'; domain: ParameterDomain; valueType?: ViewActionValueType }
  | { status: 'unavailable' | 'unsupported' | 'failed'; reason: string } {
  if (!restriction) return { status: 'unavailable', reason: 'PARAMETER_DOMAIN_UNAVAILABLE' };
  const type = isBoundedName(restriction.type) ? restriction.type.toLowerCase() : undefined;
  if (
    type === 'range' ||
    restriction.minValue !== undefined ||
    restriction.maxValue !== undefined
  ) {
    const minValue = scalarFrom(restriction.minValue);
    const maxValue = scalarFrom(restriction.maxValue);
    if (minValue === undefined || maxValue === undefined) {
      return { status: 'failed', reason: 'PARAMETER_RANGE_BOUNDS_MALFORMED' };
    }
    const valueType = typeOfValues([minValue, maxValue]);
    if (!valueType) return { status: 'failed', reason: 'PARAMETER_RANGE_TYPE_MISMATCH' };
    const stepSize = restriction.stepSize;
    if (
      stepSize !== undefined &&
      (typeof stepSize !== 'number' || !Number.isFinite(stepSize) || stepSize <= 0)
    ) {
      return { status: 'failed', reason: 'PARAMETER_RANGE_STEP_MALFORMED' };
    }
    const dateStepPeriod = restriction.dateStepPeriod;
    if (dateStepPeriod !== undefined && !isBoundedName(dateStepPeriod)) {
      return { status: 'failed', reason: 'PARAMETER_DATE_STEP_MALFORMED' };
    }
    return {
      status: 'available',
      valueType,
      domain: {
        kind: 'range',
        minValue,
        maxValue,
        ...(typeof stepSize === 'number' ? { stepSize } : {}),
        ...(typeof dateStepPeriod === 'string' ? { dateStepPeriod } : {}),
      },
    };
  }
  const values = boundedValues(restriction.allowableValues);
  if (values.status !== 'available') return values;
  return {
    status: 'available',
    ...(values.valueType ? { valueType: values.valueType } : {}),
    domain: { kind: 'list', values: values.values },
  };
}

async function readFilterValues(filter: TableauFilter): Promise<{
  current: ReturnType<typeof boundedValues>;
  allSelected: boolean | undefined;
}> {
  const current = boundedValues(
    filter.getAppliedValues ? await filter.getAppliedValues() : filter.appliedValues,
  );
  return {
    current,
    allSelected: typeof filter.isAllSelected === 'boolean' ? filter.isAllSelected : undefined,
  };
}

async function readFilterDomain(filter: TableauFilter): Promise<ReturnType<typeof boundedValues>> {
  if (!filter.getDomainAsync) return { status: 'unavailable', reason: 'FILTER_DOMAIN_UNAVAILABLE' };
  try {
    return boundedValues((await filter.getDomainAsync()).values);
  } catch (error) {
    return { status: 'failed', reason: errorReason(error, 'FILTER_DOMAIN_READ_FAILED') };
  }
}

function filterCapability(
  dashboardName: string,
  worksheet: TableauWorksheet,
  worksheetIndex: number,
  filter: TableauFilter,
  filterIndex: number,
  filterTypeCategorical: unknown,
): FilterCapability {
  const worksheetName = isBoundedName(worksheet.name) ? worksheet.name : '';
  const worksheetId = isBoundedName(worksheet.id) ? worksheet.id : undefined;
  const field = isBoundedName(filter.fieldName) ? filter.fieldName : '';
  const fieldId = isBoundedName((filter as TableauFilter & { fieldId?: unknown }).fieldId)
    ? (filter as TableauFilter & { fieldId: string }).fieldId
    : undefined;
  const worksheetIdentity = worksheetId
    ? `${dashboardName}::worksheet-id:${worksheetId}`
    : `${dashboardName}::worksheet:${worksheetName || 'invalid'}#${worksheetIndex + 1}`;
  const identity = `${worksheetIdentity}::filter:${fieldId ?? `caption:${field || 'invalid'}#${filterIndex + 1}`}`;
  const filterType = isBoundedName(filter.filterType) ? filter.filterType : 'unknown';
  if (!worksheetName) {
    return {
      kind: 'filter',
      identity,
      worksheet: {
        name: '',
        identity: worksheetIdentity,
        index: worksheetIndex,
        ...(worksheetId ? { worksheetId } : {}),
      },
      field: '',
      filterType,
      state: state('failed', 'unknown', 'WORKSHEET_NAME_UNAVAILABLE'),
    };
  }
  if (!field) {
    return {
      kind: 'filter',
      identity,
      worksheet: {
        name: worksheetName,
        identity: worksheetIdentity,
        index: worksheetIndex,
        ...(worksheetId ? { worksheetId } : {}),
      },
      field: '',
      filterType,
      state: state('failed', 'unknown', 'FIELD_NAME_UNAVAILABLE'),
    };
  }
  if (filter.filterType !== filterTypeCategorical) {
    return {
      kind: 'filter',
      identity,
      worksheet: {
        name: worksheetName,
        identity: worksheetIdentity,
        index: worksheetIndex,
        ...(worksheetId ? { worksheetId } : {}),
      },
      field,
      filterType,
      state: state('unsupported', 'ineligible', 'UNSUPPORTED_FILTER_TYPE'),
    };
  }
  return {
    kind: 'filter',
    identity,
    worksheet: {
      name: worksheetName,
      identity: worksheetIdentity,
      index: worksheetIndex,
      ...(worksheetId ? { worksheetId } : {}),
    },
    field,
    ...(fieldId ? { fieldId } : {}),
    filterType,
    state: state(
      'available',
      fieldId ? 'unknown' : 'ineligible',
      fieldId ? 'READING_FILTER_STATE' : 'FILTER_FIELD_ID_UNAVAILABLE',
    ),
  };
}

async function discoverFilter(
  dashboardName: string,
  worksheet: TableauWorksheet,
  worksheetIndex: number,
  filter: TableauFilter,
  filterIndex: number,
  filterTypeCategorical: unknown,
): Promise<FilterCapability> {
  const capability = filterCapability(
    dashboardName,
    worksheet,
    worksheetIndex,
    filter,
    filterIndex,
    filterTypeCategorical,
  );
  if (capability.state.read !== 'available') return capability;
  try {
    const current = await readFilterValues(filter);
    if (current.current.status !== 'available' || current.allSelected === undefined) {
      const readStatus =
        current.current.status === 'available' ? 'unavailable' : current.current.status;
      return {
        ...capability,
        state: state(
          readStatus,
          'unknown',
          current.current.status === 'available'
            ? 'FILTER_SELECTION_MODE_UNAVAILABLE'
            : current.current.reason,
        ),
      };
    }
    const domain = await readFilterDomain(filter);
    if (domain.status !== 'available') {
      return {
        ...capability,
        ...(current.current.valueType ? { valueType: current.current.valueType } : {}),
        currentValues: current.current.values,
        allSelected: current.allSelected,
        state: state(domain.status, 'ineligible', domain.reason),
      };
    }
    if (
      current.current.valueType &&
      domain.valueType &&
      current.current.valueType !== domain.valueType
    ) {
      return {
        ...capability,
        valueType: current.current.valueType,
        currentValues: current.current.values,
        allSelected: current.allSelected,
        state: state('failed', 'ineligible', 'FILTER_VALUE_TYPE_MISMATCH'),
      };
    }
    const valueType = domain.valueType ?? current.current.valueType;
    return {
      ...capability,
      ...(valueType ? { valueType } : {}),
      currentValues: current.current.values,
      allSelected: current.allSelected,
      candidateValues: domain.values,
      state: state(
        'available',
        capability.fieldId ? 'eligible' : 'ineligible',
        capability.fieldId ? undefined : 'FILTER_FIELD_ID_UNAVAILABLE',
      ),
    };
  } catch (error) {
    return {
      ...capability,
      state: state('failed', 'unknown', errorReason(error, 'FILTER_READ_FAILED')),
    };
  }
}

async function discoverWorksheet(
  dashboardName: string,
  worksheet: TableauWorksheet,
  index: number,
  filterTypeCategorical: unknown,
): Promise<WorksheetCapability> {
  const name = isBoundedName(worksheet.name) ? worksheet.name : '';
  const worksheetId = isBoundedName(worksheet.id) ? worksheet.id : undefined;
  const identity = worksheetId
    ? `${dashboardName}::worksheet-id:${worksheetId}`
    : `${dashboardName}::worksheet:${name || 'invalid'}#${index + 1}`;
  if (!name) {
    return {
      name,
      identity,
      index,
      read: 'failed',
      reason: 'WORKSHEET_NAME_UNAVAILABLE',
      filters: [],
    };
  }
  try {
    const filters = await worksheet.getFiltersAsync();
    if (!Array.isArray(filters))
      return {
        name,
        identity,
        index,
        read: 'failed',
        reason: 'FILTER_LIST_MALFORMED',
        filters: [],
      };
    if (filters.length > capabilityCatalogLimits.filtersPerWorksheet) {
      return {
        name,
        identity,
        index,
        read: 'unsupported',
        reason: 'FILTER_LIST_TOO_LARGE',
        filters: [],
      };
    }
    return {
      name,
      ...(isBoundedName(worksheet.id) ? { worksheetId: worksheet.id } : {}),
      identity,
      index,
      read: 'available',
      filters: await Promise.all(
        filters.map((filter, filterIndex) => {
          if (isRecord(filter)) {
            return discoverFilter(
              dashboardName,
              worksheet,
              index,
              filter as TableauFilter,
              filterIndex,
              filterTypeCategorical,
            );
          }
          return Promise.resolve({
            ...filterCapability(
              dashboardName,
              worksheet,
              index,
              {} as TableauFilter,
              filterIndex,
              filterTypeCategorical,
            ),
            state: state('failed', 'unknown', 'FILTER_ENTRY_MALFORMED'),
          });
        }),
      ),
    };
  } catch (error) {
    return {
      name,
      identity,
      index,
      read: 'failed',
      reason: errorReason(error, 'FILTER_LIST_READ_FAILED'),
      filters: [],
    };
  }
}

function malformedWorksheet(dashboardName: string, index: number): WorksheetCapability {
  return {
    name: '',
    identity: `${dashboardName}::worksheet:invalid#${index + 1}`,
    index,
    read: 'failed',
    reason: 'WORKSHEET_ENTRY_MALFORMED',
    filters: [],
  };
}

async function discoverParameter(
  dashboardName: string,
  parameter: TableauParameter,
  index: number,
): Promise<ParameterCapability> {
  if (!isRecord(parameter)) {
    return {
      kind: 'parameter',
      identity: `${dashboardName}::parameter:invalid#${index + 1}`,
      index,
      name: '',
      state: state('failed', 'unknown', 'PARAMETER_ENTRY_MALFORMED'),
    };
  }
  const name = isBoundedName(parameter.name) ? parameter.name : '';
  const parameterId = isBoundedName((parameter as TableauParameter & { id?: unknown }).id)
    ? (parameter as TableauParameter & { id: string }).id
    : undefined;
  const dataType = isBoundedName((parameter as TableauParameter & { dataType?: unknown }).dataType)
    ? (parameter as TableauParameter & { dataType: string }).dataType
    : undefined;
  const identity = `${dashboardName}::parameter:${parameterId ?? `caption:${name || 'invalid'}#${index + 1}`}`;
  const currentValue = scalarFrom(parameter.currentValue);
  if (!name) {
    return {
      kind: 'parameter',
      identity,
      index,
      name,
      ...(parameterId ? { parameterId } : {}),
      ...(dataType ? { dataType } : {}),
      state: state('failed', 'unknown', 'PARAMETER_NAME_UNAVAILABLE'),
    };
  }
  if (currentValue === undefined) {
    return {
      kind: 'parameter',
      identity,
      index,
      name,
      ...(parameterId ? { parameterId } : {}),
      ...(dataType ? { dataType } : {}),
      state: state('failed', 'unknown', 'PARAMETER_VALUE_UNAVAILABLE'),
    };
  }
  try {
    const restriction = parameter.getAllowableValuesAsync
      ? await parameter.getAllowableValuesAsync()
      : parameter.allowableValues;
    const domain = parameterRestriction(restriction as ParameterRestriction | undefined);
    if (domain.status !== 'available') {
      return {
        kind: 'parameter',
        identity,
        index,
        name,
        ...(parameterId ? { parameterId } : {}),
        ...(dataType ? { dataType } : {}),
        valueType: typeof currentValue as ViewActionValueType,
        currentValue,
        state: state(domain.status, 'ineligible', domain.reason),
      };
    }
    const currentType = typeof currentValue as ViewActionValueType;
    if (domain.valueType && domain.valueType !== currentType) {
      return {
        kind: 'parameter',
        identity,
        index,
        name,
        ...(parameterId ? { parameterId } : {}),
        ...(dataType ? { dataType } : {}),
        valueType: currentType,
        currentValue,
        state: state('failed', 'ineligible', 'PARAMETER_VALUE_TYPE_MISMATCH'),
      };
    }
    return {
      kind: 'parameter',
      identity,
      index,
      name,
      ...(parameterId ? { parameterId } : {}),
      ...(dataType ? { dataType } : {}),
      valueType: domain.valueType ?? currentType,
      currentValue,
      ...(domain.domain.kind === 'list' && domain.domain.values
        ? { candidateValues: domain.domain.values }
        : {}),
      domain: domain.domain,
      state: state(
        'available',
        parameterId && domain.domain.kind === 'list' ? 'eligible' : 'ineligible',
        parameterId
          ? domain.domain.kind === 'list'
            ? undefined
            : 'RANGE_DOMAIN_NOT_ENUMERATED'
          : 'PARAMETER_ID_UNAVAILABLE',
      ),
    };
  } catch (error) {
    return {
      kind: 'parameter',
      identity,
      index,
      name,
      ...(parameterId ? { parameterId } : {}),
      ...(dataType ? { dataType } : {}),
      state: state('failed', 'unknown', errorReason(error, 'PARAMETER_READ_FAILED')),
    };
  }
}

export async function discoverCapabilityCatalog(
  api: TableauViewActionApi,
  requestId = 1,
  now = () => new Date().toISOString(),
): Promise<CapabilityCatalog> {
  if (!isBoundedName(api.dashboard.name)) throw new Error('DASHBOARD_IDENTITY_UNAVAILABLE');
  const dashboardName = api.dashboard.name;
  const worksheetValue = (api.dashboard as unknown as { worksheets?: unknown }).worksheets;
  const issues: CapabilityIssue[] = [];
  const worksheets = Array.isArray(worksheetValue) ? worksheetValue : [];
  if (!Array.isArray(worksheetValue)) {
    issues.push({ scope: 'worksheets', reason: 'WORKSHEET_LIST_MALFORMED' });
  }
  const boundedWorksheets = worksheets.slice(0, capabilityCatalogLimits.worksheets);
  if (worksheets.length > capabilityCatalogLimits.worksheets)
    issues.push({ scope: 'dashboard', reason: 'WORKSHEET_LIST_TOO_LARGE' });
  const worksheetCapabilities = await Promise.all(
    boundedWorksheets.map((worksheet, index) =>
      isRecord(worksheet)
        ? discoverWorksheet(
            dashboardName,
            worksheet as TableauWorksheet,
            index,
            api.filterTypeCategorical,
          )
        : Promise.resolve(malformedWorksheet(dashboardName, index)),
    ),
  );
  worksheetCapabilities.forEach((worksheet) => {
    if (worksheet.read !== 'available')
      issues.push({
        scope: worksheet.identity,
        reason: worksheet.reason ?? 'WORKSHEET_UNAVAILABLE',
      });
    worksheet.filters.forEach((filter) => {
      if (filter.state.read !== 'available')
        issues.push({
          scope: filter.identity,
          reason: filter.state.candidateReason ?? 'FILTER_UNAVAILABLE',
        });
    });
  });
  let parameters: readonly TableauParameter[] = [];
  try {
    parameters = await api.dashboard.getParametersAsync();
    if (!Array.isArray(parameters)) throw new Error('PARAMETER_LIST_MALFORMED');
  } catch (error) {
    issues.push({ scope: 'parameters', reason: errorReason(error, 'PARAMETER_LIST_READ_FAILED') });
  }
  if (parameters.length > capabilityCatalogLimits.parameters) {
    issues.push({ scope: 'parameters', reason: 'PARAMETER_LIST_TOO_LARGE' });
  }
  const parameterCapabilities = await Promise.all(
    parameters
      .slice(0, capabilityCatalogLimits.parameters)
      .map((parameter, index) => discoverParameter(dashboardName, parameter, index)),
  );
  parameterCapabilities.forEach((parameter) => {
    if (parameter.state.read !== 'available')
      issues.push({
        scope: parameter.identity,
        reason: parameter.state.candidateReason ?? 'PARAMETER_UNAVAILABLE',
      });
  });
  return {
    version: 1,
    dashboard: { name: dashboardName, identity: `tableau-dashboard:${dashboardName}` },
    source: { scope: 'active-tableau-dashboard', host: 'tableau-extensions-api' },
    freshness: { status: 'fresh', capturedAt: now(), requestId },
    worksheets: worksheetCapabilities,
    parameters: parameterCapabilities,
    issues,
  };
}

export class CapabilityCatalogController {
  private generation = 0;
  private invalidated = false;

  constructor(private readonly getApi: () => TableauViewActionApi | undefined) {}

  invalidate(): void {
    this.generation += 1;
    this.invalidated = true;
  }

  async refresh(now = () => new Date().toISOString()): Promise<DiscoveryResult> {
    const api = this.getApi();
    if (!api) return { status: 'unavailable', reason: 'TABLEAU_HOST_UNAVAILABLE' };
    const requestId = ++this.generation;
    this.invalidated = false;
    const initialDashboard = api.dashboard.name;
    const initialDashboardObject = api.dashboard;
    if (typeof initialDashboard !== 'string' || initialDashboard.length === 0) {
      return { status: 'unavailable', reason: 'DASHBOARD_IDENTITY_UNAVAILABLE' };
    }
    const catalog = await discoverCapabilityCatalog(api, requestId, now);
    const currentApi = this.getApi();
    if (this.invalidated || requestId !== this.generation)
      return { status: 'stale', reason: 'SUPERSEDED_REFRESH' };
    if (
      !currentApi ||
      currentApi.dashboard !== initialDashboardObject ||
      currentApi.dashboard.name !== initialDashboard
    ) {
      this.invalidate();
      return { status: 'stale', reason: 'DASHBOARD_SCOPE_CHANGED' };
    }
    return { status: 'applied', catalog };
  }
}
