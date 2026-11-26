// Every Admin API call goes through the Flagsmith CLI v2 (`flagsmith api <path>`), so the CLI's
// credential handling is the only place the admin key is used.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localBin = path.resolve(here, '..', 'node_modules', '.bin', 'flagsmith');
const BIN = process.env.FLAGSMITH_CLI || (fs.existsSync(localBin) ? localBin : 'flagsmith');

export class FlagsmithError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export function createClient(cfg, { log } = {}) {
  const calls = [];
  async function api(apiPath, { method = 'GET', body } = {}) {
    const p = apiPath.replace(/^\//, '');
    const args = ['api', p, '-X', method, '-i', '--no-input'];
    if (body !== undefined) args.push('--input', '-');
    const env = { ...process.env, FLAGSMITH_API_KEY: cfg.apiKey, FLAGSMITH_API_URL: cfg.apiBase };
    delete env.FLAGSMITH_ENVIRONMENT; // the admin API never needs the SDK key
    const out = await new Promise((resolve, reject) => {
      const child = spawn(BIN, args, { env });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      if (body !== undefined) child.stdin.end(JSON.stringify(body)); else child.stdin.end();
    });
    const text = out.stdout;
    const statusMatch = text.match(/^HTTP\/[\d.]+\s+(\d{3})/m);
    const errMatch = out.stderr.match(/returned (\d{3})/);
    // the CLI prints no status line for 4xx/5xx and still exits 0, so read the code from its error text
    const status = statusMatch ? Number(statusMatch[1]) : errMatch ? Number(errMatch[1]) : (out.code === 0 && !/^Error:/m.test(out.stderr) ? 200 : 0);
    // -i prints status line + headers, blank line, then the body
    const split = text.search(/\r?\n\r?\n/);
    const raw = statusMatch && split >= 0 ? text.slice(split).trim() : text.trim();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (data === null && out.stderr) { try { data = JSON.parse(out.stderr.split('\n')[0]); } catch { /* not JSON */ } }
    const shown = p.replace(cfg.envKey, '<env>');
    calls.push({ method, path: shown, status });
    if (log) log(`flagsmith api ${shown} -X ${method} -> ${status}`);
    if (status < 200 || status >= 300) {
      throw new FlagsmithError(`${method} ${shown} failed (${status}): ${(typeof data === 'string' ? data : JSON.stringify(data) || out.stderr).slice(0, 400)}`, status, data);
    }
    return data;
  }
  const env = (suffix) => `api/v1/environments/${cfg.envKey}/${suffix}`;
  return {
    calls, api,
    listExperiments: () => api(env('experiments/')),
    getExperiment: (id) => api(env(`experiments/${id}/`)),
    refreshResults: (id) => api(env(`experiments/${id}/results/refresh/`), { method: 'POST', body: {} }),
    getResults: (id) => api(env(`experiments/${id}/results/`)),
    refreshExposures: (id) => api(env(`experiments/${id}/exposures/refresh/`), { method: 'POST', body: {} }),
    getExposures: (id) => api(env(`experiments/${id}/exposures/`)),
    completeExperiment: (id, body) => api(env(`experiments/${id}/complete/`), { method: 'POST', body }),
    getFeature: (id) => api(`api/v1/projects/${cfg.projectId}/features/${id}/`),
    listFeatures: () => api(`api/v1/projects/${cfg.projectId}/features/?page_size=100`),
    listMvOptions: (featureId) => api(`api/v1/projects/${cfg.projectId}/features/${featureId}/mv-options/`),
  };
}
