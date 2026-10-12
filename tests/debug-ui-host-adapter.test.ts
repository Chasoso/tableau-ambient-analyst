import { describe, expect, it, vi } from 'vitest';
import { initializeTableauHost } from '../src/debug-ui/host-adapter.js';

describe('debug UI Tableau host adapter', () => {
  it('does not load or initialize Tableau in standalone mode', async () => {
    const loadExtensions = vi.fn();

    await expect(initializeTableauHost({ embedded: false, loadExtensions })).resolves.toEqual({
      mode: 'standalone',
    });
    expect(loadExtensions).not.toHaveBeenCalled();
  });

  it('initializes a Tableau host through the injected API boundary', async () => {
    const initializeAsync = vi.fn(async () => undefined);

    await expect(
      initializeTableauHost({ embedded: true, extensions: { initializeAsync } }),
    ).resolves.toEqual({ mode: 'tableau' });
    expect(initializeAsync).toHaveBeenCalledOnce();
  });

  it('loads the API only for an embedded host', async () => {
    const initializeAsync = vi.fn(async () => undefined);
    const loadExtensions = vi.fn(async () => ({ initializeAsync }));

    await expect(initializeTableauHost({ embedded: true, loadExtensions })).resolves.toEqual({
      mode: 'tableau',
    });
    expect(loadExtensions).toHaveBeenCalledOnce();
    expect(initializeAsync).toHaveBeenCalledOnce();
  });

  it('reports an unavailable embedded API without breaking the UI contract', async () => {
    await expect(
      initializeTableauHost({ embedded: true, loadExtensions: async () => undefined }),
    ).resolves.toMatchObject({ mode: 'tableau-unavailable' });
  });

  it('reports initialization failures instead of claiming Tableau readiness', async () => {
    const initializeAsync = vi.fn(async () => {
      throw new Error('permission denied');
    });

    await expect(
      initializeTableauHost({ embedded: true, extensions: { initializeAsync } }),
    ).resolves.toEqual({ mode: 'tableau-error', reason: 'permission denied' });
  });
});
