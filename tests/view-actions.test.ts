import { describe, expect, it, vi } from 'vitest';
import {
  MockViewActionAdapter,
  TableauViewActionAdapter,
  ViewActionController,
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
    const changeValueAsync = vi.fn(async () => undefined);
    const worksheet = {
      name: 'Orders',
      getFiltersAsync: vi.fn(async () => [
        { fieldName: 'Region', appliedValues: [{ value: 'East' }] },
      ]),
      applyFilterAsync,
    };
    const parameter = { name: 'Threshold', currentValue: 0, changeValueAsync };
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
    await adapter.undo(filterReceipt);
    expect(applyFilterAsync).toHaveBeenLastCalledWith('Region', ['East'], 'REPLACE');
    const parameterReceipt = await adapter.apply(parameterProposalWith('Threshold'));
    expect(changeValueAsync).toHaveBeenCalledWith(1);
    await adapter.undo(parameterReceipt);
    expect(changeValueAsync).toHaveBeenLastCalledWith(0);
  });
});

function parameterProposalWith(name: string): ViewActionProposal {
  return {
    ...parameterProposal,
    action: { type: 'set-parameter', target: { kind: 'parameter', name }, value: 1 },
  };
}
