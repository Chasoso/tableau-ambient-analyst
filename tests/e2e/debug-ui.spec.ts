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
    await expect(page.getByText('INTERVENE:', { exact: false })).toBeVisible();
    const badge = page.getByTestId('intervention-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('! INTERVENE');
    await badge.click();
    await expect(page.getByText('mock.intervention.details-opened')).toBeVisible();
  });

  test('keeps the intervention badge absent for HOLD and ignored scenarios', async ({ page }) => {
    await page.goto('/');
    const badge = page.getByTestId('intervention-badge');

    await page.getByLabel('Scenario').selectOption('hold-insufficient');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('INSUFFICIENT EVIDENCE');
    await expect(badge).toHaveCount(0);

    await page.getByLabel('Scenario').selectOption('ignored');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('IGNORED');
    await expect(badge).toHaveCount(0);
  });

  test('shows a useful failed replay error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Scenario').selectOption('failed');
    await page.getByRole('button', { name: 'Replay' }).click();

    await expect(page.locator('[data-testid="run-status"]')).toHaveText('FAILED');
    await expect(page.getByText('FIXTURE_INVALID:', { exact: false })).toBeVisible();
  });

  test('clears intervention state when changing scenarios and replaying again', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Scenario').selectOption('verified-intervention');
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.getByTestId('intervention-badge')).toBeVisible();

    await page.getByLabel('Scenario').selectOption('ignored');
    await expect(page.getByTestId('intervention-badge')).toHaveCount(0);
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('[data-testid="run-status"]')).toHaveText('IGNORED');
    await expect(page.getByTestId('intervention-badge')).toHaveCount(0);
  });
});
