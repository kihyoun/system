import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: process.env.WIZARD_BASE_URL || 'http://127.0.0.1:4173' },
  webServer: process.env.WIZARD_BASE_URL ? undefined : {
    command: 'npm run build && npx vite preview --host 127.0.0.1',
    port: 4173,
    timeout: 120000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
