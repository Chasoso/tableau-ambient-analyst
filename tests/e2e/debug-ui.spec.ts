import { expect, test } from '@playwright/test';

test.describe('Ambient Analyst debug console', () => {
  test('loads the key debug sections', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Ambient Analyst Debug Console' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trigger' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Analysis Contract' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Analysis progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Action Capability Catalog' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh capabilities' })).toBeDisabled();
    await expect(page.getByTestId('capability-status')).toHaveText('Waiting for the Tableau host.');
    await expect(page.getByRole('heading', { name: 'Evidence / provenance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Verifier' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Intervention' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
  });

  test('replays a verified intervention and records the mock interaction', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Scenario').selectOption('verified-intervention');
    await page.getByRole('button', { name: 'Replay' }).click();

    await expect(page.locator('[data-testid="run-status"]')).toHaveText('COMPLETED');
    const analysisStage = page
      .locator('.stages li')
      .filter({ hasText: 'Derived from the agentic analysis boundary.' });
    await expect(analysisStage).toHaveAttribute('data-status', 'complete');
    await expect(analysisStage).toContainText('Analysis');
    await expect(
      page
        .getByText(
          'Deterministic fixture evidence was collected through the application boundary.',
          {
            exact: true,
          },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText('VERIFIED: Verification completed.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('INTERVENE:', { exact: false })).toBeVisible();
    const badge = page.getByTestId('intervention-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('! INTERVENE');
    await badge.click();
    await expect(page.getByText('view-action.applied')).toBeVisible();
    await page.getByTestId('view-action-undo').click();
    await expect(page.getByText('view-action.undone')).toBeVisible();
  });

  test('displays a distinct resolver proposal for a second verified run', async ({ page }) => {
    await page.goto('/');
    const proposal = page.getByTestId('view-action-proposal');

    await page.getByLabel('Scenario').selectOption('verified-intervention');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(proposal).toHaveText('Proposed change: set Region to West');

    await page.getByLabel('Scenario').selectOption('verified-intervention-parameter');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(proposal).toHaveText('Proposed change: set fixture-threshold to 1');
  });

  test('keeps the intervention badge absent for HOLD and ignored scenarios', async ({ page }) => {
    await page.goto('/');
    const badge = page.getByTestId('intervention-badge');

    await page.getByLabel('Scenario').selectOption('hold-insufficient');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('INSUFFICIENT EVIDENCE');
    await expect(page.locator('[data-testid="run-status"]')).toHaveAttribute(
      'data-status',
      'insufficient-evidence',
    );
    await expect(
      page.getByText('HOLD: Required evidence is incomplete or invalid.', { exact: true }),
    ).toBeVisible();
    await expect(badge).toHaveCount(0);

    await page.getByLabel('Scenario').selectOption('ignored');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('IGNORED');
    await expect(page.locator('[data-testid="run-status"]')).toHaveAttribute(
      'data-status',
      'ignored',
    );
    await expect(badge).toHaveCount(0);
  });

  test('shows a useful failed replay error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Scenario').selectOption('failed');
    await page.getByRole('button', { name: 'Replay' }).click();

    await expect(page.locator('[data-testid="run-status"]')).toHaveText('FAILED');
    await expect(page.locator('[data-testid="run-status"]')).toHaveAttribute(
      'data-status',
      'failed',
    );
    await expect(
      page.getByText('The application flow failed closed.', { exact: true }),
    ).toBeVisible();
  });

  test('clears intervention state when changing scenarios and replaying again', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Scenario').selectOption('verified-intervention');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.getByTestId('intervention-badge')).toBeVisible();

    await page.getByLabel('Scenario').selectOption('ignored');
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('IDLE');
    await expect(page.locator('[data-testid="run-status"]')).toHaveAttribute('data-status', 'idle');
    await expect(page.getByTestId('intervention-badge')).toHaveCount(0);
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('IGNORED');
    await expect(page.locator('[data-testid="run-status"]')).toHaveAttribute(
      'data-status',
      'ignored',
    );
    await expect(page.getByTestId('intervention-badge')).toHaveCount(0);
  });

  test('displays bounded embedded discovery without authorizing an action', async ({ page }) => {
    await page.addInitScript(() => {
      if (window.self === window.top) return;
      const filter = {
        fieldName: 'Region',
        fieldId: 'region-id',
        filterType: 'categorical',
        isAllSelected: false,
        getAppliedValues: async () => ['East'],
        getDomainAsync: async () => ({ values: ['East', 'West'] }),
      };
      const worksheet = {
        name: 'Orders',
        id: 'orders-worksheet-id',
        getFiltersAsync: async () => [filter],
        applyFilterAsync: async () => undefined,
      };
      const dashboard = {
        name: 'Discovery dashboard',
        worksheets: [worksheet],
        getParametersAsync: async () => [
          {
            name: 'Threshold',
            id: 'threshold-id',
            dataType: 'float',
            currentValue: 1,
            allowableValues: { allowableValues: [0, 1, 2] },
            changeValueAsync: async () => undefined,
          },
        ],
      };
      (globalThis as typeof globalThis & { tableau?: unknown }).tableau = {
        extensions: {
          initializeAsync: async () => undefined,
          dashboardContent: { dashboard },
        },
        FilterUpdateType: { Replace: 'replace' },
        FilterType: { Categorical: 'categorical' },
      };
    });
    await page.goto('/');
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.src = window.location.href;
      iframe.title = 'embedded debug console';
      document.body.append(iframe);
    });
    await expect(page.locator('iframe[title="embedded debug console"]')).toHaveCount(1);
    const frame = page.frameLocator('iframe[title="embedded debug console"]');
    await expect(frame.getByRole('heading', { name: 'Action Capability Catalog' })).toBeVisible();
    await expect(frame.getByTestId('capability-status')).toContainText('Discovery dashboard');
    await expect(frame.getByText('Filter Region (categorical)', { exact: false })).toContainText(
      'current: East',
    );
    const parameterRow = frame.getByRole('listitem').filter({ hasText: 'Parameter Threshold = 1' });
    await expect(parameterRow).toBeVisible();
    await expect(
      parameterRow.getByText('available · candidate eligible', { exact: false }),
    ).toBeVisible();
    await expect(frame.getByRole('button', { name: '! INTERVENE' })).toHaveCount(0);
  });
});
