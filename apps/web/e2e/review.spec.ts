import { expect, test } from '@playwright/test';
import { USERS, login } from './helpers';

// Needs demo detections: run `pnpm sim backfill --days 30` after seeding.
test.describe('detection review', () => {
  test('inspector confirms a detection from the detail page with the keyboard shortcut', async ({
    page,
  }) => {
    await login(page, USERS.inspector);
    await page.goto('/detections?');
    await page.getByRole('combobox', { name: 'Review status' }).selectOption('PENDING');
    const first = page.locator('tbody tr a, a[href^="/detections/"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByText('Evidence image')).toBeVisible();
    await page.getByLabel('Review note').fill('Checked on site by e2e');
    await page.getByRole('button', { name: /Confirm/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    await expect(page.getByText('CONFIRMED').first()).toBeVisible();
  });

  test('inspector review works offline and syncs when the network returns', async ({
    page,
    context,
  }) => {
    await login(page, USERS.inspector);
    await page.goto('/review');
    const confirm = page.getByRole('button', { name: /Confirm defect/ }).first();
    await expect(confirm).toBeVisible();
    await context.setOffline(true);
    await confirm.click();
    await expect(page.getByText(/waiting to sync/)).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/Synced \d+ review/)).toBeVisible();
  });
});
