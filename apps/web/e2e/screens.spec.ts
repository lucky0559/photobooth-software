import { test } from '@playwright/test';
import { signInAsAdmin } from './fixtures';

// Visual check only (no pixel assertions): screenshots for review at phone and desktop widths.
const VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
] as const;

for (const vp of VIEWPORTS) {
  test(`screenshots at ${vp.label} width`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/admin/login?error=invalid');
    await page.screenshot({ path: `test-results/screens/login-${vp.label}.png`, fullPage: true });

    await signInAsAdmin(page);
    await page.goto('/admin/settings');
    await page.screenshot({ path: `test-results/screens/settings-${vp.label}.png`, fullPage: true });

    await page.goto('/admin/templates');
    await page.screenshot({ path: `test-results/screens/templates-${vp.label}.png`, fullPage: true });
  });
}
