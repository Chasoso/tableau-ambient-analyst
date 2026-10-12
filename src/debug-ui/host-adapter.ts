export type TableauExtensions = {
  initializeAsync: () => Promise<void>;
};

export type HostMode = 'standalone' | 'tableau' | 'tableau-unavailable' | 'tableau-error';

export type HostInitialization = {
  mode: HostMode;
  reason?: string;
};

export type HostAdapterEnvironment = {
  embedded: boolean;
  extensions?: TableauExtensions;
  loadExtensions?: () => Promise<TableauExtensions | undefined>;
};

export const tableauExtensionsApiUrl =
  'https://cdn.jsdelivr.net/gh/tableau/extensions-api/lib/tableau.extensions.1.latest.js';

function isTableauExtensions(value: unknown): value is TableauExtensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'initializeAsync' in value &&
    typeof value.initializeAsync === 'function'
  );
}

function extensionsFromGlobal(): TableauExtensions | undefined {
  const tableau = (globalThis as { tableau?: unknown }).tableau;
  if (typeof tableau !== 'object' || tableau === null || !('extensions' in tableau)) {
    return undefined;
  }
  const extensions = tableau.extensions;
  return isTableauExtensions(extensions) ? extensions : undefined;
}

function loadExtensionsApiScript(): Promise<TableauExtensions | undefined> {
  if (typeof document === 'undefined') return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = tableauExtensionsApiUrl;
    script.async = true;
    script.onload = () => resolve(extensionsFromGlobal());
    script.onerror = () => reject(new Error('Could not load the Tableau Extensions API library.'));
    document.head.append(script);
  });
}

function browserEnvironment(): HostAdapterEnvironment {
  let embedded = false;
  if (typeof window !== 'undefined') {
    try {
      embedded = window.self !== window.top;
    } catch {
      embedded = true;
    }
  }

  const extensions = extensionsFromGlobal();
  return {
    embedded,
    ...(extensions ? { extensions } : {}),
    loadExtensions: loadExtensionsApiScript,
  };
}

/**
 * Tableau initialization is intentionally isolated here. Standalone pages do
 * not load the Extensions API and continue to use the same UI and fixtures.
 */
export async function initializeTableauHost(
  environment: HostAdapterEnvironment = browserEnvironment(),
): Promise<HostInitialization> {
  if (!environment.embedded) return { mode: 'standalone' };

  try {
    const extensions =
      environment.extensions ?? (await environment.loadExtensions?.()) ?? undefined;
    if (!extensions) {
      return {
        mode: 'tableau-unavailable',
        reason: 'The Tableau Extensions API was not available in the embedded host.',
      };
    }
    await extensions.initializeAsync();
    return { mode: 'tableau' };
  } catch (error) {
    return {
      mode: 'tableau-error',
      reason:
        error instanceof Error ? error.message : 'Tableau Extensions API initialization failed.',
    };
  }
}
