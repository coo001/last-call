// Vertical check against real Flagsmith Cloud: create -> start -> traffic -> results -> complete.
// Usage: node scripts/probe.mjs <step>   steps: create | traffic | results | complete
import fs from 'node:fs';
import { loadEnv, requireEnv } from '../src/env.mjs';
import { createClient } from '../src/flagsmith.mjs';

const cfg = loadEnv(); requireEnv(cfg);
const fsm = createClient(cfg, { log: (m) => console.log('  ' + m) });
const stateFile = new URL('../verification/probe-state.json', import.meta.url);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const redact = (o) => JSON.stringify(o, null, 1).split(cfg.envKey).join('<env>');
const step = process.argv[2];
const FLAG = 'probe_end_api';

if (step === 'create') {
  const feature = await fsm.api(`api/v1/projects/${cfg.projectId}/features/`, { method: 'POST', body: { name: FLAG, initial_value: 'control', default_enabled: true, type: 'MULTIVARIATE' } });
  state.featureId = feature.id;
  const opt = await fsm.api(`api/v1/projects/${cfg.projectId}/features/${feature.id}/mv-options/`, { method: 'POST', body: { feature: feature.id, type: 'unicode', string_value: 'treatment', key: 'treatment', default_percentage_allocation: 0 } });
  state.optionId = opt.id; console.log('mv option', redact(opt));
  const metric = await fsm.api(`api/v1/environments/${cfg.envKey}/experiment-metrics/`, { method: 'POST', body: { name: 'probe_done', aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: 'probe_done' } } });
  state.metricId = metric.id;
  const exp = await fsm.api(`api/v1/environments/${cfg.envKey}/experiments/`, { method: 'POST', body: { feature: feature.id, name: 'Probe: end API', hypothesis: 'Checks that the lifecycle endpoints work on the free plan.', metrics: [{ metric: metric.id, expected_direction: 'increase' }], experiment_rollout: { enabled: true, rollout_percentage: 100, feature_state_value: { type: 'string', value: 'control' }, multivariate_feature_state_values: [{ multivariate_feature_option: opt.id, percentage_allocation: 50 }] } } });
  state.experimentId = exp.id; save();
  console.log('experiment', redact(exp));
  const started = await fsm.api(`api/v1/environments/${cfg.envKey}/experiments/${exp.id}/start/`, { method: 'POST', body: {} });
  console.log('started', redact(started));
} else if (step === 'results') {
  try { console.log('refresh', redact(await fsm.refreshResults(state.experimentId))); } catch (e) { console.log('refresh error', e.status, redact(e.body)); }
  try { console.log('exp refresh', redact(await fsm.refreshExposures(state.experimentId))); } catch (e) { console.log('exposure refresh error', e.status, redact(e.body)); }
  await new Promise((r) => setTimeout(r, Number(process.argv[3] || 20) * 1000));
  console.log('exposures', redact(await fsm.getExposures(state.experimentId)));
  console.log('results', redact(await fsm.getResults(state.experimentId)));
  console.log('warehouse', redact(await fsm.api(`api/v1/environments/${cfg.envKey}/warehouse-connections/`)));
} else if (step === 'complete') {
  const body = JSON.parse(process.argv[3] || '{}');
  try { console.log('complete', redact(await fsm.completeExperiment(state.experimentId, body))); } catch (e) { console.log('complete error', e.status, redact(e.body)); }
  console.log('experiment', redact(await fsm.getExperiment(state.experimentId)));
}
