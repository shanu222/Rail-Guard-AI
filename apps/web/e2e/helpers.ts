import { expect, type Page } from '@playwright/test';

/** Demo users are created by `pnpm db:seed` (DEMO_MODE only). Password comes from SEED_DEMO_PASSWORD. */
export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Railguard-Demo-2026';
export const USERS = {
  admin: 'admin@demo.railguard.example',
  engineer: 'engineer@demo.railguard.example',
  inspector: 'inspector@demo.railguard.example',
  viewer: 'viewer@demo.railguard.example',
};

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview/);
}
