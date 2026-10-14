import { describe, expect, it, vi } from 'vitest';
import {
  MockViewActionAdapter,
  TableauViewActionAdapter,
  ViewActionController,
  ViewActionFailure,
  approvedViewActionConfigurationFromGlobal,
  validateViewActionProposal,
  type ViewActionEligibility,
  type ViewActionPolicy,
  type ViewActionProposal,
} from '../src/debug-ui/view-actions.js';

const policy: ViewActionPolicy = {
  filterTargets: [
    {
      kind: 'worksheet-field',
      worksheet: 'fixture-dashboard',
      field: 'Region',
      valueType: 'string',
      allowedValues: ['West', 'East'],
    },
  ],
  parameterTargets: [
    {
      kind: 'parameter',
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
  action: {
    type: 'set-filter',
    target: filterTarget,
    values: ['West'],
  },
};

const parameterProposal: ViewActionProposal = {
  id: 'proposal-parameter',
  evidenceRef: 'evidence-1',
  action: {
    type: 'set-parameter',
    target: { kind: 'parameter', name: 'fixture-threshold' },
    value: 1,
  },
};

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
    const adapter = new TableauViewActionAdapter({
      dashboard: {
        worksheets: [worksheet],
        getParametersAsync: async () => [parameter],
      },
      filterUpdateTypeReplace: 'REPLACE',
    });
    const filterReceipt = await adapter.apply({
      ...filterProposal,
      action: {
        type: 'set-filter',
        target: { kind: 'worksheet-field', worksheet: 'Orders', field: 'Region' },
        values: ['West'],
      },
    });
    expect(applyFilterAsync).toHaveBeenCalledWith('Region', ['West'], 'REPLACE');
    filterState = ['West'];
    await adapter.undo(filterReceipt);
    expect(applyFilterAsync).toHaveBeenLastCalledWith('Region', ['East'], 'REPLACE');
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
          appliedValues: ['East'],
          getDomainAsync: async () => ({ values: ['East'] }),
        },
      ],
      applyFilterAsync,
    };
    const adapter = new TableauViewActionAdapter({
      dashboard: { worksheets: [worksheet], getParametersAsync: async () => [] },
      filterUpdateTypeReplace: 'REPLACE',
    });
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

  it('refuses undo after an unrelated live edit', async () => {
    let filterState = ['East'];
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: async () => [
        {
          fieldName: 'Region',
          getAppliedValues: async () => filterState,
          getDomainAsync: async () => ({ values: ['East', 'West', 'South'] }),
        },
      ],
      applyFilterAsync: vi.fn(async () => undefined),
    };
    const adapter = new TableauViewActionAdapter({
      dashboard: { worksheets: [worksheet], getParametersAsync: async () => [] },
      filterUpdateTypeReplace: 'REPLACE',
    });
    const controller = new ViewActionController(adapter, {
      filterTargets: [
        {
          kind: 'worksheet-field',
          worksheet: 'Orders',
          field: 'Region',
          valueType: 'string',
          allowedValues: ['West'],
        },
      ],
      parameterTargets: [],
    });
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
        previous: { type: 'filter', target: filterTarget, values: ['Unexpected'] },
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
          filterTargets: [],
          parameterTargets: [{ kind: 'parameter', name: 'Threshold', valueType: 'number' }],
        },
        proposal: parameterProposalWith('Threshold'),
      };
      expect(approvedViewActionConfigurationFromGlobal()).toBeUndefined();
      host.__ambientAnalystViewAction = {
        policy: {
          filterTargets: [],
          parameterTargets: [
            {
              kind: 'parameter',
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
});

function parameterProposalWith(name: string): ViewActionProposal {
  return {
    ...parameterProposal,
    action: { type: 'set-parameter', target: { kind: 'parameter', name }, value: 1 },
  };
}
