import { describe, expect, it, vi } from 'vitest';
import {
  MockViewActionAdapter,
  TableauViewActionAdapter,
  ViewActionController,
  ViewActionFailure,
  approvedViewActionConfigurationFromGlobal,
  tableauViewActionApiFromGlobal,
  validateViewActionProposal,
  type ViewActionEligibility,
  type ViewActionPolicy,
  type ViewActionProposal,
} from '../src/debug-ui/view-actions.js';

const policy: ViewActionPolicy = {
  scope: { dashboard: 'fixture-dashboard' },
  filterTargets: [
    {
      kind: 'worksheet-field',
      dashboard: 'fixture-dashboard',
      worksheet: 'fixture-dashboard',
      field: 'Region',
      valueType: 'string',
      allowedValues: ['West', 'East'],
    },
  ],
  parameterTargets: [
    {
      kind: 'parameter',
      dashboard: 'fixture-dashboard',
      name: 'fixture-threshold',
      valueType: 'number',
      allowedValues: [0, 1, 2],
    },
  ],
};

const filterTarget = {
  kind: 'worksheet-field' as const,
  worksheet: 'fixture-dashboard',
  field: 'Region',
};

const eligible: ViewActionEligibility = {
  status: 'completed',
  scenario: {
    trigger: { decision: 'ANALYZE' },
    verifier: { status: 'VERIFIED' },
    intervention: { decision: 'INTERVENE' },
  },
  audit: [
    'trigger-detected',
    'analysis-contract-created',
    'tableau-analysis-started',
    'evidence-collected',
    'verification-complete',
    'intervention-recommended',
  ],
};

const filterProposal: ViewActionProposal = {
  id: 'proposal-filter',
  evidenceRef: 'evidence-1',
  scope: { dashboard: 'fixture-dashboard' },
  action: {
    type: 'set-filter',
    target: filterTarget,
    values: ['West'],
  },
};

const parameterProposal: ViewActionProposal = {
  id: 'proposal-parameter',
  evidenceRef: 'evidence-1',
  scope: { dashboard: 'fixture-dashboard' },
  action: {
    type: 'set-parameter',
    target: { kind: 'parameter', name: 'fixture-threshold' },
    value: 1,
  },
};

function filterPolicy(
  worksheet: string,
  field: string,
  valueType: 'string' | 'number',
  allowedValues: readonly (string | number)[],
  parameterName = 'fixture-threshold',
): ViewActionPolicy {
  return {
    scope: { dashboard: 'fixture-dashboard' },
    filterTargets: [
      {
        kind: 'worksheet-field',
        dashboard: 'fixture-dashboard',
        worksheet,
        field,
        valueType,
        allowedValues,
      },
    ],
    parameterTargets: [
      {
        kind: 'parameter',
        dashboard: 'fixture-dashboard',
        name: parameterName,
        valueType: 'number',
        allowedValues: [0, 1, 2],
      },
    ],
  };
}

describe('validated view action boundary', () => {
  it('fails closed for HOLD and invalid targets or values', async () => {
    const adapter = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const controller = new ViewActionController(adapter, policy);
    const hold = {
      ...eligible,
      scenario: { ...eligible.scenario, intervention: { decision: 'HOLD' } },
    };
    await expect(controller.apply(hold, filterProposal)).resolves.toMatchObject({ ok: false });
    await expect(
      controller.apply(eligible, {
        ...filterProposal,
        action: {
          type: 'set-filter',
          target: { kind: 'worksheet-field', worksheet: 'fixture-dashboard', field: 'Unapproved' },
          values: ['West'],
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: 'Filter target is not approved.' });
    await expect(
      controller.apply(eligible, {
        ...filterProposal,
        action: {
          type: 'set-filter',
          target: filterTarget,
          values: ['Unknown'],
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: 'Filter value is not approved.' });
  });

  it('applies only on click, rejects repeated clicks, and undoes the latest action', async () => {
    const adapter = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const controller = new ViewActionController(adapter, policy);
    expect(adapter.state.filters['fixture-dashboard.Region']).toEqual(['All']);
    await expect(controller.apply(eligible, filterProposal)).resolves.toMatchObject({ ok: true });
    expect(adapter.state.filters['fixture-dashboard.Region']).toEqual(['West']);
    await expect(controller.apply(eligible, filterProposal)).resolves.toMatchObject({
      ok: false,
      error: 'This proposal was already applied.',
    });
    await expect(controller.undo()).resolves.toEqual({
      ok: true,
      message: 'The previous view action was undone.',
    });
    expect(adapter.state.filters['fixture-dashboard.Region']).toEqual(['All']);
    await expect(controller.undo()).resolves.toMatchObject({ ok: false });
  });

  it('supports a typed parameter action and fails closed for stale mock targets', async () => {
    const adapter = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const controller = new ViewActionController(adapter, policy);
    await expect(controller.apply(eligible, parameterProposal)).resolves.toMatchObject({
      ok: true,
    });
    expect(adapter.state.parameters['fixture-threshold']).toBe(1);
    const stale = new ViewActionController(
      new MockViewActionAdapter({ filters: {}, parameters: {} }),
      policy,
    );
    await expect(stale.apply(eligible, parameterProposal)).resolves.toMatchObject({ ok: false });
  });

  it('uses supported Tableau adapter calls and restores captured state', async () => {
    const applyFilterAsync = vi.fn(async () => undefined);
    const changeValueAsync = vi.fn(async (value: string | number | boolean) => {
      void value;
    });
    let filterState = ['East'];
    let parameterState = 0;
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: vi.fn(async () => [
        {
          fieldName: 'Region',
          filterType: 'categorical',
          isAllSelected: false,
          getAppliedValues: async () => filterState,
          getDomainAsync: async () => ({ values: ['East', 'West'] }),
        },
      ]),
      applyFilterAsync,
    };
    const parameter = {
      name: 'Threshold',
      get currentValue() {
        return parameterState;
      },
      allowableValues: { allowableValues: [0, 1, 2] },
      changeValueAsync: vi.fn(async (value: string | number | boolean) => {
        if (typeof value !== 'number') throw new Error('unexpected parameter type');
        parameterState = value;
        await changeValueAsync(value);
      }),
    };
    const adapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [worksheet],
          getParametersAsync: async () => [parameter],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('Orders', 'Region', 'string', ['West'], 'Threshold'),
    );
    const filterReceipt = await adapter.apply({
      ...filterProposal,
      action: {
        type: 'set-filter',
        target: { kind: 'worksheet-field', worksheet: 'Orders', field: 'Region' },
        values: ['West'],
      },
    });
    expect(applyFilterAsync).toHaveBeenCalledWith('Region', ['West'], 'replace');
    filterState = ['West'];
    await adapter.undo(filterReceipt);
    expect(applyFilterAsync).toHaveBeenLastCalledWith('Region', ['East'], 'replace');
    const parameterReceipt = await adapter.apply(parameterProposalWith('Threshold'));
    expect(changeValueAsync).toHaveBeenCalledWith(1);
    expect(parameterState).toBe(1);
    await adapter.undo(parameterReceipt);
    expect(changeValueAsync).toHaveBeenLastCalledWith(0);
  });

  it('checks the live domain before mutation and fails closed', async () => {
    const applyFilterAsync = vi.fn(async () => undefined);
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          filterType: 'categorical',
          isAllSelected: false,
          appliedValues: ['East'],
          getDomainAsync: async () => ({ values: ['East'] }),
        },
      ],
      applyFilterAsync,
    };
    const adapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [worksheet],
          getParametersAsync: async () => [],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('Orders', 'Region', 'string', ['West']),
    );
    await expect(
      adapter.apply({
        ...filterProposal,
        action: {
          type: 'set-filter',
          target: { kind: 'worksheet-field', worksheet: 'Orders', field: 'Region' },
          values: ['West'],
        },
      }),
    ).rejects.toThrow('FILTER_VALUE_NOT_CURRENTLY_SUPPORTED');
    expect(applyFilterAsync).not.toHaveBeenCalled();
  });

  it('enforces the approved scope at the Tableau adapter boundary', async () => {
    const applyFilterAsync = vi.fn(async () => undefined);
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          filterType: 'categorical',
          isAllSelected: false,
          appliedValues: ['East'],
          getDomainAsync: async () => ({ values: ['East', 'West'] }),
        },
      ],
      applyFilterAsync,
    };
    const adapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [worksheet],
          getParametersAsync: async () => [],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('Orders', 'Region', 'string', ['West']),
    );
    await expect(
      adapter.apply({
        ...filterProposal,
        action: {
          type: 'set-filter',
          target: { kind: 'worksheet-field', worksheet: 'Other', field: 'Region' },
          values: ['West'],
        },
      }),
    ).rejects.toThrow('Filter target is not approved.');
    expect(applyFilterAsync).not.toHaveBeenCalled();
  });

  it('fails closed for a different dashboard and unsupported filter subtype', async () => {
    const applyFilterAsync = vi.fn(async () => undefined);
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          filterType: 'RANGE',
          appliedValues: ['East'],
          getDomainAsync: async () => ({ values: ['East', 'West'] }),
        },
      ],
      applyFilterAsync,
    };
    const api = {
      dashboard: {
        name: 'OtherDashboard',
        worksheets: [worksheet],
        getParametersAsync: async () => [],
      },
      filterUpdateTypeReplace: 'replace',
      filterTypeCategorical: 'categorical',
    };
    const adapter = new TableauViewActionAdapter(
      api,
      filterPolicy('Orders', 'Region', 'string', ['West']),
    );
    const proposal = {
      ...filterProposal,
      action: {
        type: 'set-filter' as const,
        target: { kind: 'worksheet-field' as const, worksheet: 'Orders', field: 'Region' },
        values: ['West'],
      },
    };
    await expect(adapter.apply(proposal)).rejects.toThrow('DASHBOARD_SCOPE_MISMATCH');
    api.dashboard.name = 'fixture-dashboard';
    await expect(adapter.apply(proposal)).rejects.toThrow('UNSUPPORTED_FILTER_TYPE');
    expect(applyFilterAsync).not.toHaveBeenCalled();
  });

  it('reports partial or unknown state when an adapter mutation fails', async () => {
    const adapter = {
      apply: vi.fn(async () => {
        throw new ViewActionFailure('MUTATION_UNKNOWN', true);
      }),
      undo: vi.fn(async () => undefined),
    };
    const controller = new ViewActionController(adapter, policy);
    await expect(controller.apply(eligible, filterProposal)).resolves.toEqual({
      ok: false,
      error: 'MUTATION_UNKNOWN',
      partial: true,
    });
  });

  it('rejects concurrent applies at the controller boundary', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const delayedAdapter = {
      apply: async (proposal: ViewActionProposal) => {
        await pending;
        return adapter.apply(proposal);
      },
      undo: (receipt: Parameters<typeof adapter.undo>[0]) => adapter.undo(receipt),
    };
    const controller = new ViewActionController(delayedAdapter, policy);
    const first = controller.apply(eligible, filterProposal);
    await expect(controller.apply(eligible, parameterProposal)).resolves.toEqual({
      ok: false,
      error: 'Another view action is still in progress.',
      partial: false,
    });
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it('does not retain a receipt when a pending apply is invalidated by a new run', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const reset = vi.fn(() => base.reset());
    const adapter = {
      apply: async (proposal: ViewActionProposal) => {
        await pending;
        return base.apply(proposal);
      },
      undo: (receipt: Parameters<typeof base.undo>[0]) => base.undo(receipt),
      reset,
    };
    const controller = new ViewActionController(adapter, policy);
    const first = controller.apply(eligible, filterProposal);
    controller.resetForRun();
    release();
    await expect(first).resolves.toEqual({
      ok: false,
      error: 'This view action was invalidated by a new run or host scope.',
      partial: false,
    });
    await expect(controller.undo()).resolves.toEqual({
      ok: false,
      error: 'There is no view action to undo.',
      partial: false,
    });
    expect(reset).toHaveBeenCalledOnce();
  });

  it('refuses undo after an unrelated live edit', async () => {
    let filterState = ['East'];
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          filterType: 'categorical',
          isAllSelected: false,
          getAppliedValues: async () => filterState,
          getDomainAsync: async () => ({ values: ['East', 'West', 'South'] }),
        },
      ],
      applyFilterAsync: vi.fn(async () => undefined),
    };
    const adapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [worksheet],
          getParametersAsync: async () => [],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('Orders', 'Region', 'string', ['West']),
    );
    const controller = new ViewActionController(
      adapter,
      filterPolicy('Orders', 'Region', 'string', ['West']),
    );
    const proposal = {
      ...filterProposal,
      action: {
        type: 'set-filter' as const,
        target: { kind: 'worksheet-field' as const, worksheet: 'Orders', field: 'Region' },
        values: ['West'],
      },
    };
    await expect(controller.apply(eligible, proposal)).resolves.toMatchObject({ ok: true });
    filterState = ['South'];
    await expect(controller.undo()).resolves.toMatchObject({
      ok: false,
      partial: true,
      error: 'UNDO_EXTERNAL_STATE_DIVERGED',
    });
  });

  it('keeps the receipt after a partial undo and resets fixture state for a new run', async () => {
    const adapter = new MockViewActionAdapter({
      filters: { 'fixture-dashboard.Region': ['All'] },
      parameters: { 'fixture-threshold': 0 },
    });
    const controller = new ViewActionController(adapter, policy);
    await expect(controller.apply(eligible, filterProposal)).resolves.toMatchObject({ ok: true });
    adapter.state.filters['fixture-dashboard.Region'] = ['Unexpected'];
    const originalUndo = adapter.undo.bind(adapter);
    adapter.undo = vi.fn(async () => {
      await originalUndo({
        proposal: filterProposal,
        previous: {
          type: 'filter',
          target: filterTarget,
          values: ['Unexpected'],
          allSelected: false,
        },
      });
      throw new ViewActionFailure('UNDO_UNKNOWN', true);
    });
    await expect(controller.undo()).resolves.toMatchObject({
      ok: false,
      partial: true,
      error: 'UNDO_UNKNOWN',
    });
    controller.resetForRun();
    expect(adapter.state.filters['fixture-dashboard.Region']).toEqual(['All']);
    expect(adapter.applied).toEqual([]);
  });

  it('rejects malformed host configuration and missing parameter allowlists at runtime', () => {
    const host = globalThis as typeof globalThis & { __ambientAnalystViewAction?: unknown };
    const original = host.__ambientAnalystViewAction;
    try {
      host.__ambientAnalystViewAction = {
        policy: {
          scope: { dashboard: 'fixture-dashboard' },
          filterTargets: [],
          parameterTargets: [
            {
              kind: 'parameter',
              dashboard: 'fixture-dashboard',
              name: 'Threshold',
              valueType: 'number',
            },
          ],
        },
        proposal: parameterProposalWith('Threshold'),
      };
      expect(approvedViewActionConfigurationFromGlobal()).toBeUndefined();
      host.__ambientAnalystViewAction = {
        policy: {
          scope: { dashboard: 'fixture-dashboard' },
          filterTargets: [],
          parameterTargets: [
            {
              kind: 'parameter',
              dashboard: 'fixture-dashboard',
              name: 'Threshold',
              valueType: 'number',
              allowedValues: [1],
            },
          ],
        },
        proposal: parameterProposalWith('Threshold'),
      };
      expect(approvedViewActionConfigurationFromGlobal()).toMatchObject({
        policy: { parameterTargets: [{ allowedValues: [1] }] },
      });
      host.__ambientAnalystViewAction = { policy: null, proposal: {} };
      expect(approvedViewActionConfigurationFromGlobal()).toBeUndefined();
    } finally {
      host.__ambientAnalystViewAction = original;
    }
  });

  it('rejects malformed proposals and invalid target kinds before dereferencing them', () => {
    expect(
      validateViewActionProposal(
        eligible,
        { action: null } as unknown as ViewActionProposal,
        policy,
      ),
    ).toEqual({ ok: false, error: 'View action configuration is malformed.' });
    expect(
      validateViewActionProposal(eligible, filterProposal, {
        ...policy,
        filterTargets: [
          {
            kind: 'unknown',
            worksheet: 'fixture-dashboard',
            field: 'Region',
            valueType: 'string',
            allowedValues: ['West'],
          },
        ],
      } as unknown as ViewActionPolicy),
    ).toEqual({ ok: false, error: 'View action configuration is malformed.' });
  });

  it('resolves the exact Tableau enum members from the host global', () => {
    const host = globalThis as typeof globalThis & { tableau?: unknown };
    const original = host.tableau;
    try {
      host.tableau = {
        FilterType: { Categorical: 'categorical' },
        FilterUpdateType: { Replace: 'replace' },
        extensions: {
          dashboardContent: {
            dashboard: {
              name: 'fixture-dashboard',
              worksheets: [],
              getParametersAsync: async () => [],
            },
          },
        },
      };
      expect(tableauViewActionApiFromGlobal()).toMatchObject({
        filterTypeCategorical: 'categorical',
        filterUpdateTypeReplace: 'replace',
      });
    } finally {
      host.tableau = original;
    }
  });

  it('rejects a complete malformed target before any Tableau API call', async () => {
    const getFiltersAsync = vi.fn(async () => []);
    const applyFilterAsync = vi.fn(async () => undefined);
    const getParametersAsync = vi.fn(async () => []);
    const adapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [{ name: 'Orders', getFiltersAsync, applyFilterAsync }],
          getParametersAsync,
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      {
        ...policy,
        filterTargets: [
          {
            kind: 'unknown',
            dashboard: 'fixture-dashboard',
            worksheet: 'Orders',
            field: 'Region',
            valueType: 'string',
            allowedValues: ['West'],
          },
        ],
      } as unknown as ViewActionPolicy,
    );

    await expect(adapter.apply(filterProposal)).rejects.toThrow(
      'View action target kind is invalid.',
    );
    expect(getFiltersAsync).not.toHaveBeenCalled();
    expect(getParametersAsync).not.toHaveBeenCalled();
    expect(applyFilterAsync).not.toHaveBeenCalled();
  });

  it('restores typed filter values and All selection through the supported API', async () => {
    let typedValues: string[] = ['1'];
    const typedApply = vi.fn(async (_field: string, values: readonly string[]) => {
      typedValues = [...values];
    });
    const typedWorksheet = {
      name: 'Typed',
      getFiltersAsync: async () => [
        {
          fieldName: 'Score',
          filterType: 'categorical',
          isAllSelected: false,
          getAppliedValues: async () => typedValues.map(Number),
          getDomainAsync: async () => ({ values: [1, 2] }),
        },
      ],
      applyFilterAsync: typedApply,
    };
    const typedAdapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [typedWorksheet],
          getParametersAsync: async () => [],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('Typed', 'Score', 'number', [1, 2]),
    );
    const typedProposal = {
      ...filterProposal,
      action: {
        type: 'set-filter' as const,
        target: { kind: 'worksheet-field' as const, worksheet: 'Typed', field: 'Score' },
        values: [2],
      },
    };
    const typedReceipt = await typedAdapter.apply(typedProposal);
    await typedAdapter.undo(typedReceipt);
    expect(typedApply).toHaveBeenLastCalledWith('Score', ['1'], 'replace');

    let allValues: string[] = [];
    const clearFilterAsync = vi.fn(async () => {
      allValues = [];
    });
    const allApply = vi.fn(async (_field: string, values: readonly string[]) => {
      allValues = [...values];
    });
    const allWorksheet = {
      name: 'AllState',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          filterType: 'categorical',
          get isAllSelected() {
            return allValues.length === 0;
          },
          getAppliedValues: async () => allValues,
          getDomainAsync: async () => ({ values: ['East', 'West'] }),
        },
      ],
      applyFilterAsync: allApply,
      clearFilterAsync,
    };
    const allAdapter = new TableauViewActionAdapter(
      {
        dashboard: {
          name: 'fixture-dashboard',
          worksheets: [allWorksheet],
          getParametersAsync: async () => [],
        },
        filterUpdateTypeReplace: 'replace',
        filterTypeCategorical: 'categorical',
      },
      filterPolicy('AllState', 'Region', 'string', ['East', 'West']),
    );
    const allProposal = {
      ...filterProposal,
      action: {
        type: 'set-filter' as const,
        target: { kind: 'worksheet-field' as const, worksheet: 'AllState', field: 'Region' },
        values: ['West'],
      },
    };
    const allReceipt = await allAdapter.apply(allProposal);
    await allAdapter.undo(allReceipt);
    expect(clearFilterAsync).toHaveBeenCalledWith('Region');
    expect(allApply).toHaveBeenCalledWith('Region', ['West'], 'replace');
  });
});

function parameterProposalWith(name: string): ViewActionProposal {
  return {
    ...parameterProposal,
    action: { type: 'set-parameter', target: { kind: 'parameter', name }, value: 1 },
  };
}
