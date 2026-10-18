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
        applyFilterAsync: async () => undefined,
        getFiltersAsync: async () => [
          {
            fieldName: 'Region',
            filterType: 'categorical',
            isAllSelected: false,
            getAppliedValues: async () => [{ value: 'East' }],
            getDomainAsync: async () => ({ values: [{ value: 'East' }, { value: 'West' }] }),
          },
          {
            fieldName: 'Region',
            filterType: 'categorical',
            isAllSelected: true,
            appliedValues: [],
            getDomainAsync: async () => ({ values: ['East'] }),
          },
          {
            fieldName: 'Date',
            filterType: 'range',
            appliedValues: [],
          },
        ],
      },
      {
        name: 'Summary',
        applyFilterAsync: async () => undefined,
        getFiltersAsync: async () => {
          throw new Error('worksheet permission denied');
        },
      },
    ],
    getParametersAsync: async () => [
      {
        name: 'Threshold',
        currentValue: { value: 1 },
        changeValueAsync: async () => undefined,
        getAllowableValuesAsync: async () => ({ allowableValues: [0, 1, 2] }),
      },
      {
        name: 'Unbounded',
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
      identity: 'Sales::worksheet:Orders#1::filter:Region#1',
      currentValues: ['East'],
      candidateValues: ['East', 'West'],
      state: {
        read: 'available',
        candidate: 'eligible',
        authorization: { approved: false, executable: false },
      },
    });
    expect(filters[1]!.identity).toBe('Sales::worksheet:Orders#1::filter:Region#2');
    expect(filters[2]!.state).toMatchObject({ read: 'unsupported', candidate: 'ineligible' });
    expect(catalog.parameters[0]).toMatchObject({
      identity: 'Sales::parameter:Threshold#1',
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
        { scope: 'Sales::worksheet:Summary#2', reason: 'worksheet permission denied' },
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
          applyFilterAsync: async () => undefined,
          getFiltersAsync: async () => [
            {
              fieldName: 'Region',
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
  });

  it('reports an unavailable host without creating a synthetic catalog', async () => {
    const controller = new CapabilityCatalogController(() => undefined);
    await expect(controller.refresh()).resolves.toEqual({
      status: 'unavailable',
      reason: 'TABLEAU_HOST_UNAVAILABLE',
    });
  });
});
