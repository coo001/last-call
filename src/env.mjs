// Loads configuration from process.env, then from an env file (LASTCALL_ENV_FILE or ./.env).
// Values are never printed.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv() {
  const file = process.env.LASTCALL_ENV_FILE || path.resolve(process.cwd(), '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const e = process.env;
  const cfg = {
    apiKey: e.FLAGSMITH_API_KEY || e.FLAGSMITH_ADMIN_API_KEY || '',
    envKey: e.FLAGSMITH_ENVIRONMENT || e.FLAGSMITH_DEV_ENV_KEY || '',
    projectId: e.FLAGSMITH_PROJECT_ID || e.FLAGSMITH_PROJECT || '',
    apiBase: (e.FLAGSMITH_API_URL || 'https://api.flagsmith.com').replace(/\/api\/v1\/?$/, '').replace(/\/$/, ''),
    dashboard: e.FLAGSMITH_DASHBOARD_URL || 'https://app.flagsmith.com',
  };
  return cfg;
}

export function requireEnv(cfg, keys = ['apiKey', 'envKey', 'projectId']) {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`Missing configuration: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
}
