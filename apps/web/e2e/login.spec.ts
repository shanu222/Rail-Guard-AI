import { expect, test } from '@playwright/test';
import { USERS, login } from './helpers';

test.describe('login', () => {
  test('rejects a wrong password and shows branding', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'RAILGUARD AI' })).toBeVisible();
    await expect(page.getByText('Resilience Technologies Labs')).toBeVisible();
    await page.getByLabel('Email').fill(USERS.admin);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid/i);
  });

  test('signs in, shows the DEMO DATA badge and KPI cards, then signs out', async ({ page }) => {
    await login(page, USERS.engineer);
    await expect(page.getByText('DEMO DATA').first()).toBeVisible();
    await expect(page.getByText('Km monitored')).toBeVisible();
    await expect(page.getByText('Open severe defects')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated visitors to the login page', async ({ page }) => {
    await page.goto('/detections');
    await expect(page).toHaveURL(/\/login/);
  });

  test('viewer cannot see the admin or review navigation', async ({ page }) => {
    await login(page, USERS.viewer);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Inspector Review' })).toHaveCount(0);
  });
});
