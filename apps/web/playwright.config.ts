import { defineConfig, devices } from '@playwright/test';

// Supabase URL/keys for the LOCAL stack (and the service role key used only for test cleanup).
try {
  process.loadEnvFile('.env.local');
} catch {
  // Rely on the environment instead (CI).
}

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production build, so the e2e run also covers `next build`, the CSP and the body-size limits.
    command: `pnpm run build && pnpm exec next start --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/admin/login`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
