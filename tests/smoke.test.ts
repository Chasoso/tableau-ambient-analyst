import { describe, expect, it } from 'vitest';

import { getAppName } from '../src/index.js';

describe('runtime bootstrap', () => {
  it('exposes the application name', () => {
    expect(getAppName()).toBe('tableau-ambient-analyst');
  });
});
