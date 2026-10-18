import { describe, expect, it } from 'vitest';
import {
  CapabilityCatalogController,
  discoverCapabilityCatalog,
  type CapabilityCatalog,
} from '../src/debug-ui/capability-catalog.js';
import type { TableauViewActionApi } from '../src/debug-ui/view-actions.js';

function api(
  overrides: Partial<NonNullable<TableauViewActionApi['dashboard']>> = {},
): TableauViewActionApi {
  const filterTypeCategorical = 'categorical';
  return {
    filterTypeCategorical,
    filterUpdateTypeReplace: 'replace',
    dashboard: {
      name: 'Sales',
      worksheets: [],
      getParametersAsync: async () => [],
      ...overrides,
    },
  };
}

function catalogApi(): TableauViewActionApi {
  return api({
    worksheets: [
      {
        name: 'Orders',
        id: 'orders-worksheet-id',
        applyFilterAsync: async () => undefined,
        getFiltersAsync: async () => [
          {
            fieldName: 'Region',
            fieldId: 'region-id',
            filterType: 'categorical',
            isAllSelected: false,
            getAppliedValues: async () => [{ value: 'East' }],
            getDomainAsync: async () => ({ values: [{ value: 'East' }, { value: 'West' }] }),
          },
          {
            fieldName: 'Region',
            fieldId: 'region-id-duplicate',
            filterType: 'categorical',
            isAllSelected: true,
            appliedValues: [],
            getDomainAsync: async () => ({ values: ['East'] }),
          },
          {
            fieldName: 'Date',
            fieldId: 'date-id',
            filterType: 'range',
            appliedValues: [],
          },
        ],
      },
      {
        name: 'Summary',
        id: 'summary-worksheet-id',
        applyFilterAsync: async () => undefined,
        getFiltersAsync: async () => {
          throw new Error('worksheet permission denied');
        },
      },
    ],
    getParametersAsync: async () => [
      {
        name: 'Threshold',
        id: 'threshold-id',
        dataType: 'float',
        currentValue: { value: 1 },
        changeValueAsync: async () => undefined,
        getAllowableValuesAsync: async () => ({ allowableValues: [0, 1, 2] }),
      },
      {
        name: 'Unbounded',
        id: 'unbounded-id',
        dataType: 'string',
        currentValue: 'x',
        changeValueAsync: async () => undefined,
        getAllowableValuesAsync: async () => ({
          allowableValues: Array.from({ length: 33 }, (_, i) => i),
        }),
      },
    ],
  });
}

describe('Tableau capability catalog discovery', () => {
  it('discovers bounded filters and parameters without authorizing execution', async () => {
    const catalog = await discoverCapabilityCatalog(
      catalogApi(),
      7,
      () => '2026-10-18T00:00:00.000Z',
    );
    expect(catalog.freshness.requestId).toBe(7);
    expect(catalog.freshness.capturedAt).toBe('2026-10-18T00:00:00.000Z');
    const filters = catalog.worksheets[0]!.filters;
    expect(filters[0]).toMatchObject({
      identity: 'Sales::worksheet-id:orders-worksheet-id::filter:region-id',
      currentValues: ['East'],
      candidateValues: ['East', 'West'],
      state: {
        read: 'available',
        candidate: 'eligible',
        authorization: { approved: false, executable: false },
      },
    });
    expect(filters[0]!.worksheet.identity).toBe('Sales::worksheet-id:orders-worksheet-id');
    expect(filters[1]!.identity).toBe(
      'Sales::worksheet-id:orders-worksheet-id::filter:region-id-duplicate',
    );
    const reordered = catalogApi();
    const originalGetFilters = reordered.dashboard.worksheets[0]!.getFiltersAsync;
    reordered.dashboard.worksheets[0]!.getFiltersAsync = async () =>
      [...(await originalGetFilters())].reverse();
    const reorderedCatalog = await discoverCapabilityCatalog(reordered);
    expect(reorderedCatalog.worksheets[0]!.filters.map(({ identity }) => identity).sort()).toEqual(
      filters.map(({ identity }) => identity).sort(),
    );
    expect(filters[2]!.state).toMatchObject({ read: 'unsupported', candidate: 'ineligible' });
    expect(catalog.parameters[0]).toMatchObject({
      identity: 'Sales::parameter:threshold-id',
      currentValue: 1,
      candidateValues: [0, 1, 2],
      state: {
        read: 'available',
        candidate: 'eligible',
        authorization: { approved: false, executable: false },
      },
    });
    expect(catalog.parameters[1]!.state).toMatchObject({
      read: 'unsupported',
      candidate: 'ineligible',
      candidateReason: 'VALUE_DOMAIN_TOO_LARGE',
    });
  });

  it('isolates worksheet failures and malformed or unavailable reads', async () => {
    const catalog = await discoverCapabilityCatalog(catalogApi());
    expect(catalog.worksheets[1]).toMatchObject({
      read: 'failed',
      reason: 'worksheet permission denied',
      filters: [],
    });
    expect(catalog.issues).toEqual(
      expect.arrayContaining([
        {
          scope: 'Sales::worksheet-id:summary-worksheet-id',
          reason: 'worksheet permission denied',
        },
      ]),
    );
  });

  it('bounds worksheet and parameter lists', async () => {
    const huge = api({
      worksheets: Array.from({ length: 33 }, (_, index) => ({
        name: `Sheet-${index}`,
        applyFilterAsync: async () => undefined,
        getFiltersAsync: async () => [],
      })),
      getParametersAsync: async () =>
        Array.from({ length: 33 }, (_, index) => ({
          name: `Parameter-${index}`,
          currentValue: index,
          changeValueAsync: async () => undefined,
          allowableValues: { allowableValues: [index] },
        })),
    });
    const catalog = await discoverCapabilityCatalog(huge);
    expect(catalog.worksheets).toHaveLength(32);
    expect(catalog.parameters).toHaveLength(32);
    expect(catalog.issues).toEqual(
      expect.arrayContaining([
        { scope: 'dashboard', reason: 'WORKSHEET_LIST_TOO_LARGE' },
        { scope: 'parameters', reason: 'PARAMETER_LIST_TOO_LARGE' },
      ]),
    );
  });

  it('retains bounded parameter range metadata without making it enumerable', async () => {
    const range = api({
      getParametersAsync: async () => [
        {
          id: 'date-range-id',
          name: 'Date range',
          dataType: 'date',
          currentValue: '2026-01-01',
          changeValueAsync: async () => undefined,
          allowableValues: {
            type: 'range',
            minValue: '2026-01-01',
            maxValue: '2026-12-31',
            dateStepPeriod: 'month',
          },
        },
      ],
    });
    const catalog = await discoverCapabilityCatalog(range);
    expect(catalog.parameters[0]).toMatchObject({
      parameterId: 'date-range-id',
      dataType: 'date',
      domain: {
        kind: 'range',
        minValue: '2026-01-01',
        maxValue: '2026-12-31',
        dateStepPeriod: 'month',
      },
      state: {
        read: 'available',
        candidate: 'ineligible',
        candidateReason: 'RANGE_DOMAIN_NOT_ENUMERATED',
      },
    });
    expect(catalog.parameters[0]!.candidateValues).toBeUndefined();
  });

  it('normalizes Tableau Date values without exposing Date objects', async () => {
    const date = new Date('2026-02-03T00:00:00.000Z');
    const dateApi = api({
      getParametersAsync: async () => [
        {
          id: 'date-id',
          name: 'As of',
          dataType: 'date',
          currentValue: date,
          changeValueAsync: async () => undefined,
          allowableValues: { type: 'list', allowableValues: [date] },
        },
      ],
    });
    const catalog = await discoverCapabilityCatalog(dateApi);
    expect(catalog.parameters[0]).toMatchObject({
      currentValue: '2026-02-03T00:00:00.000Z',
      candidateValues: ['2026-02-03T00:00:00.000Z'],
      dataType: 'date',
      state: { read: 'available', candidate: 'eligible' },
    });
  });

  it('fails closed for malformed identities, current state, and values', async () => {
    const malformed = api({
      name: '',
      worksheets: [
        {
          name: '',
          applyFilterAsync: async () => undefined,
          getFiltersAsync: async () => [],
        },
        {
          name: '',
          applyFilterAsync: async () => undefined,
          getFiltersAsync: async () => [],
        },
      ],
      getParametersAsync: async () => [
        {
          name: '',
          currentValue: 1,
          changeValueAsync: async () => undefined,
          allowableValues: { allowableValues: [1] },
        },
      ],
    });
    await expect(discoverCapabilityCatalog(malformed)).rejects.toThrow(
      'DASHBOARD_IDENTITY_UNAVAILABLE',
    );

    const valid = api({
      worksheets: [
        {
          name: '',
          applyFilterAsync: async () => undefined,
          getFiltersAsync: async () => [],
        },
        {
          name: 'Orders',
          id: 'orders-worksheet-id',
          applyFilterAsync: async () => undefined,
          getFiltersAsync: async () => [
            {
              fieldName: 'Region',
              fieldId: 'region-id',
              filterType: 'categorical',
              isAllSelected: false,
              appliedValues: [{ bad: true }],
              getDomainAsync: async () => ({ values: ['East'] }),
            },
          ],
        },
      ],
      getParametersAsync: async () => [
        {
          name: '',
          currentValue: 1,
          changeValueAsync: async () => undefined,
          allowableValues: { allowableValues: [1] },
        },
      ],
    });
    const catalog = await discoverCapabilityCatalog(valid);
    expect(catalog.worksheets[1]!.filters[0]!.state).toMatchObject({
      read: 'failed',
      candidate: 'unknown',
      candidateReason: 'MALFORMED_VALUE',
    });
    expect(catalog.worksheets[0]!.read).toBe('failed');
    expect(catalog.parameters[0]!.state).toMatchObject({
      read: 'failed',
      candidate: 'unknown',
      candidateReason: 'PARAMETER_NAME_UNAVAILABLE',
    });
  });

  it('isolates malformed worksheet entries from valid siblings', async () => {
    const sibling = catalogApi();
    const malformed = api({
      worksheets: [
        null,
        sibling.dashboard.worksheets[0]!,
      ] as unknown as typeof sibling.dashboard.worksheets,
      getParametersAsync: sibling.dashboard.getParametersAsync,
    });
    const catalog = await discoverCapabilityCatalog(malformed);
    expect(catalog.worksheets[0]).toMatchObject({
      read: 'failed',
      reason: 'WORKSHEET_ENTRY_MALFORMED',
    });
    expect(catalog.worksheets[1]).toMatchObject({ name: 'Orders', read: 'available' });
    expect(catalog.parameters[0]).toMatchObject({
      name: 'Threshold',
      state: { read: 'available' },
    });
  });

  it('discards superseded refreshes and dashboard scope changes', async () => {
    let current: TableauViewActionApi | undefined = catalogApi();
    let release: (() => void) | undefined;
    current.dashboard.worksheets[0]!.getFiltersAsync = () =>
      new Promise((resolve) => {
        release = () => resolve([]);
      });
    const controller = new CapabilityCatalogController(() => current);
    const pending = controller.refresh(() => 'now');
    controller.invalidate();
    release?.();
    await expect(pending).resolves.toEqual({ status: 'stale', reason: 'SUPERSEDED_REFRESH' });

    current = catalogApi();
    const changing = new CapabilityCatalogController(() => current);
    const original = current;
    const result = await changing.refresh(() => 'now');
    expect(result.status).toBe('applied');
    expect((result as { catalog: CapabilityCatalog }).catalog.dashboard.name).toBe(
      original.dashboard.name,
    );
  });

  it('discards an older concurrent refresh and a result from a changed dashboard', async () => {
    const firstRelease: { resolve?: () => void } = {};
    const secondRelease: { resolve?: () => void } = {};
    let calls = 0;
    const current = catalogApi();
    current.dashboard.worksheets[0]!.getFiltersAsync = () => {
      calls += 1;
      return new Promise((resolve) => {
        (calls === 1 ? firstRelease : secondRelease).resolve = () => resolve([]);
      });
    };
    const controller = new CapabilityCatalogController(() => current);
    const first = controller.refresh(() => 'first');
    const second = controller.refresh(() => 'second');
    firstRelease.resolve?.();
    await expect(first).resolves.toEqual({ status: 'stale', reason: 'SUPERSEDED_REFRESH' });
    secondRelease.resolve?.();
    await expect(second).resolves.toMatchObject({ status: 'applied' });

    const changing = catalogApi();
    let release: (() => void) | undefined;
    changing.dashboard.worksheets[0]!.getFiltersAsync = () =>
      new Promise((resolve) => {
        release = () => resolve([]);
      });
    const scopeController = new CapabilityCatalogController(() => changing);
    const scoped = scopeController.refresh(() => 'scope');
    changing.dashboard.name = 'Other dashboard';
    release?.();
    await expect(scoped).resolves.toEqual({ status: 'stale', reason: 'DASHBOARD_SCOPE_CHANGED' });

    let active = catalogApi();
    let sameNameRelease: (() => void) | undefined;
    active.dashboard.worksheets[0]!.getFiltersAsync = () =>
      new Promise((resolve) => {
        sameNameRelease = () => resolve([]);
      });
    const sameNameController = new CapabilityCatalogController(() => active);
    const sameName = sameNameController.refresh(() => 'same-name');
    active = catalogApi();
    sameNameRelease?.();
    await expect(sameName).resolves.toEqual({ status: 'stale', reason: 'DASHBOARD_SCOPE_CHANGED' });
  });

  it('reports an unavailable host without creating a synthetic catalog', async () => {
    const controller = new CapabilityCatalogController(() => undefined);
    await expect(controller.refresh()).resolves.toEqual({
      status: 'unavailable',
      reason: 'TABLEAU_HOST_UNAVAILABLE',
    });
  });
});
