import { describe, expect, it } from 'vitest';
import { resolveViewIntent, type ViewIntentResolutionInput } from '../src/debug-ui/view-intents.js';
import type { ViewActionPolicy } from '../src/debug-ui/view-actions.js';

const policy: ViewActionPolicy = {
  scope: { dashboard: 'regional-dashboard' },
  filterTargets: [
    {
      kind: 'worksheet-field',
      dashboard: 'regional-dashboard',
      worksheet: 'Sales',
      field: 'Region',
      valueType: 'string',
      allowedValues: ['North', 'West'],
    },
  ],
  parameterTargets: [
    {
      kind: 'parameter',
      dashboard: 'regional-dashboard',
      name: 'Region parameter',
      valueType: 'string',
      allowedValues: ['North', 'West'],
    },
  ],
};

const context = {
  runId: 'run-42',
  verification: 'VERIFIED',
  intervention: 'INTERVENE',
  verifiedEvidenceIds: ['evidence-region-verified'],
};

const filterMapping = [
  {
    semanticKey: 'region',
    operation: 'set-filter',
    valueType: 'string',
    target: { kind: 'worksheet-field', worksheet: 'Sales', field: 'Region' },
    values: [
      { from: 'north', to: 'North' },
      { from: 'west', to: 'West' },
    ],
  },
];

const filterIntent = {
  id: 'focus-region-north',
  runId: 'run-42',
  evidenceRef: 'evidence-region-verified',
  operation: 'set-filter',
  semanticKey: 'region',
  valueType: 'string',
  values: ['north'],
};

function input(overrides: Partial<ViewIntentResolutionInput> = {}): ViewIntentResolutionInput {
  return { intent: filterIntent, context, mappings: filterMapping, policy, ...overrides };
}

describe('view intent resolver', () => {
  it('resolves an exact or explicitly aliased value to one approved proposal', () => {
    expect(resolveViewIntent(input())).toEqual({
      status: 'READY',
      proposal: {
        id: 'focus-region-north',
        evidenceRef: 'evidence-region-verified',
        scope: { dashboard: 'regional-dashboard' },
        action: {
          type: 'set-filter',
          target: { kind: 'worksheet-field', worksheet: 'Sales', field: 'Region' },
          values: ['North'],
        },
      },
    });
  });

  it('is deterministic for the same intent, evidence, mapping, and policy', () => {
    expect(resolveViewIntent(input())).toEqual(resolveViewIntent(input()));
  });

  it('reuses the core for an explicit parameter mapping', () => {
    const result = resolveViewIntent(
      input({
        intent: { ...filterIntent, operation: 'set-parameter' },
        mappings: [
          {
            semanticKey: 'region',
            operation: 'set-parameter',
            valueType: 'string',
            target: { kind: 'parameter', name: 'Region parameter' },
            values: [{ from: 'north', to: 'North' }],
          },
        ],
      }),
    );
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.proposal.action).toEqual({
        type: 'set-parameter',
        target: { kind: 'parameter', name: 'Region parameter' },
        value: 'North',
      });
    }
  });

  it('returns NO_ACTION when no dashboard mapping matches', () => {
    expect(resolveViewIntent(input({ mappings: [] }))).toEqual({
      status: 'NO_ACTION',
      reason: 'No dashboard mapping matches this view intent.',
    });
  });

  it('rejects ambiguous mappings instead of choosing one', () => {
    expect(
      resolveViewIntent(
        input({
          mappings: [
            ...filterMapping,
            { ...filterMapping[0]!, target: { ...filterMapping[0]!.target, worksheet: 'Profit' } },
          ],
        }),
      ),
    ).toMatchObject({ status: 'REJECTED' });
  });

  it.each([
    ['wrong run', { ...filterIntent, runId: 'run-other' }, context],
    ['unknown evidence', { ...filterIntent, evidenceRef: 'evidence-unknown' }, context],
    ['hold', filterIntent, { ...context, intervention: 'HOLD' }],
    ['unverified', filterIntent, { ...context, verification: 'INSUFFICIENT' }],
    ['bad value', { ...filterIntent, values: ['South'] }, context],
    ['bad type', { ...filterIntent, valueType: 'number', values: [1] }, context],
  ])('rejects %s input without producing a proposal', (_label, intent, verifiedContext) => {
    const result = resolveViewIntent(input({ intent, context: verifiedContext }));
    expect(result.status).toBe('REJECTED');
    expect(result).not.toHaveProperty('proposal');
  });

  it('rejects malformed or unsupported mappings', () => {
    expect(resolveViewIntent(input({ mappings: [{ semanticKey: 'region' }] }))).toMatchObject({
      status: 'REJECTED',
    });
    expect(
      resolveViewIntent(
        input({
          mappings: [
            {
              ...filterMapping[0]!,
              values: [{ from: 'north', to: 'South' }],
            },
          ],
        }),
      ),
    ).toMatchObject({ status: 'REJECTED' });
  });

  it('rejects a proposal that the existing execution policy does not authorize', () => {
    expect(
      resolveViewIntent(
        input({
          policy: {
            ...policy,
            filterTargets: [],
          },
        }),
      ),
    ).toMatchObject({ status: 'REJECTED' });
  });
});
