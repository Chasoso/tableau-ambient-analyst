import { describe, expect, it } from 'vitest';

import {
  classifyCiFailure,
  decideCiFailure,
  maxCiRepairCycles,
  maxTransientCiReruns,
  runCiFeedbackLoop,
  sanitizeCiEvidence,
  type CiObservation,
} from '../src/review/ci-feedback.js';

const failed = (evidence: string, transient = false): CiObservation => ({
  checks: [{ name: 'validation', state: 'FAILURE' }],
  evidence,
  transient,
});

describe('CI feedback control', () => {
  it('classifies deterministic and protected failures', () => {
    expect(classifyCiFailure('npm run lint failed')).toBe('AUTO_FIX');
    expect(classifyCiFailure('permission denied reading secret')).toBe('BLOCKED');
    expect(classifyCiFailure('architecture decision required')).toBe('HUMAN_DECISION_REQUIRED');
    expect(classifyCiFailure('dependency registry returned an unknown error')).toBe('BLOCKED');
  });

  it('redacts common credential formats and bounds CI evidence', () => {
    const evidence = sanitizeCiEvidence(
      'api_key=secret-value Authorization: Bearer bearer-value sk-1234567890abcdefghijkl xoxb-secret',
    );
    expect(evidence).not.toContain('secret-value');
    expect(evidence).not.toContain('bearer-value');
    expect(evidence).not.toContain('sk-1234567890abcdefghijkl');
    expect(evidence).not.toContain('xoxb-secret');
    expect(sanitizeCiEvidence('x'.repeat(25000))).toHaveLength(20000);
  });

  it('waits for checks and reaches READY_FOR_HUMAN_REVIEW after repair', () => {
    let observations = 0;
    let waits = 0;
    let repairs = 0;
    const result = runCiFeedbackLoop({
      observe: () => {
        observations += 1;
        return observations === 1
          ? { checks: [{ name: 'validation', state: 'PENDING' }], evidence: '', transient: false }
          : observations === 2
            ? failed('npm run lint failed')
            : {
                checks: [{ name: 'validation', state: 'SUCCESS' }],
                evidence: '',
                transient: false,
              };
      },
      wait: () => {
        waits += 1;
      },
      rerunTransient: () => false,
      repair: () => {
        repairs += 1;
        return { changed: true, validated: true, pushed: true };
      },
    });

    expect(result.status).toBe('READY_FOR_HUMAN_REVIEW');
    expect(waits).toBe(1);
    expect(repairs).toBe(1);
  });

  it('waits for required checks to materialize before blocking', () => {
    let observations = 0;
    const result = runCiFeedbackLoop({
      observe: () => {
        observations += 1;
        return observations === 1
          ? { checks: [], checksPending: true, evidence: '[]', transient: false }
          : { checks: [{ name: 'validation', state: 'SUCCESS' }], evidence: '', transient: false };
      },
      wait: () => undefined,
      rerunTransient: () => false,
      repair: () => ({ changed: false, validated: false, pushed: false }),
    });

    expect(result.status).toBe('READY_FOR_HUMAN_REVIEW');
    expect(observations).toBe(2);
  });

  it('stops safely for blocked and human decisions', () => {
    expect(
      runCiFeedbackLoop({
        observe: () => ({ checks: [], evidence: 'gh unavailable', transient: false }),
        wait: () => undefined,
        rerunTransient: () => false,
        repair: () => ({ changed: false, validated: false, pushed: false }),
      }).status,
    ).toBe('CI_BLOCKED');
    expect(
      decideCiFailure(failed('permission denied'), {
        repairCycles: 0,
        transientReruns: 0,
        meaningfulProgress: false,
      }).status,
    ).toBe('CI_BLOCKED');
    expect(
      decideCiFailure(failed('product scope decision required'), {
        repairCycles: 0,
        transientReruns: 0,
        meaningfulProgress: false,
      }).status,
    ).toBe('CI_HUMAN_DECISION_REQUIRED');
  });

  it('fails closed for skipped and unknown required checks', () => {
    for (const state of ['SKIPPED', 'UNKNOWN'] as const) {
      const result = runCiFeedbackLoop({
        observe: () => ({
          checks: [{ name: 'validation', state }],
          evidence: '',
          transient: false,
        }),
        wait: () => undefined,
        rerunTransient: () => false,
        repair: () => ({ changed: true, validated: true, pushed: true }),
      });

      expect(result.status).toBe('CI_BLOCKED');
      expect(result.classification).toBe('BLOCKED');
      expect(result.state.repairCycles).toBe(0);
    }
  });

  it('bounds transient reruns and repair cycles', () => {
    const transient = failed('runner unavailable', true);
    expect(
      decideCiFailure(transient, {
        repairCycles: 0,
        transientReruns: maxTransientCiReruns,
        meaningfulProgress: false,
      }).status,
    ).toBe('CI_TRANSIENT_RETRY_LIMIT_REACHED');

    expect(
      decideCiFailure(failed('npm test failed'), {
        repairCycles: maxCiRepairCycles,
        transientReruns: 0,
        meaningfulProgress: false,
        lastFailureSignature: 'validation:FAILURE',
      }).status,
    ).toBe('CI_REPAIR_LIMIT_REACHED');
  });

  it('does not repeat the same failed CI without progress', () => {
    const result = runCiFeedbackLoop({
      observe: () => failed('npm test failed'),
      wait: () => undefined,
      rerunTransient: () => false,
      repair: () => ({ changed: false, validated: false, pushed: false }),
    });
    expect(result.status).toBe('CI_REPAIR_LIMIT_REACHED');
  });
});
