// Creates the two demo experiments (flag + keyed variation + metric + experiment) and starts them.
// Safe to re-run: anything that already exists is reused.
import { loadEnv, requireEnv } from '../src/env.mjs';
import { createClient } from '../src/flagsmith.mjs';

const cfg = loadEnv(); requireEnv(cfg);
const fsm = createClient(cfg, { log: (m) => console.log('  ' + m) });
const E = `api/v1/environments/${cfg.envKey}`;
const P = `api/v1/projects/${cfg.projectId}`;

const custom = process.env.LASTCALL_SETUP_JSON ? JSON.parse(process.env.LASTCALL_SETUP_JSON) : null;
export const DEMO = custom || [
  { flag: 'invite_cta', variant: 'short', event: 'invite_sent', name: 'Invite button copy',
    hypothesis: 'A shorter invite button ("Send invite") gets more people to send at least one invite than "Invite your teammates to this trip".' },
  { flag: 'pricing_headline', variant: 'annual_first', event: 'plan_selected', name: 'Pricing headline',
    hypothesis: 'Leading with the annual price gets more visitors to pick a plan than leading with the monthly price.' },
];

const features = (await fsm.listFeatures()).results;
const metrics = (await fsm.api(`${E}/experiment-metrics/`)).results;
const experiments = (await fsm.listExperiments()).results;
for (const d of DEMO) {
  if (experiments.some((x) => x.feature?.name === d.flag && x.status === 'completed')) { console.log(`${d.flag}: experiment already completed, skipping`); continue; }
  let feature = features.find((f) => f.name === d.flag);
  if (!feature) feature = await fsm.api(`${P}/features/`, { method: 'POST', body: { name: d.flag, initial_value: 'control', default_enabled: true, type: 'MULTIVARIATE' } });
  const options = await fsm.listMvOptions(feature.id);
  let opt = (options.results || options).find((o) => o.key === d.variant);
  if (!opt) opt = await fsm.api(`${P}/features/${feature.id}/mv-options/`, { method: 'POST', body: { feature: feature.id, type: 'unicode', string_value: d.variant, key: d.variant, default_percentage_allocation: 0 } });
  let metric = metrics.find((m) => m.name === d.event);
  if (!metric) metric = await fsm.api(`${E}/experiment-metrics/`, { method: 'POST', body: { name: d.event, aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: d.event } } });
  let exp = experiments.find((x) => (x.feature?.id ?? x.feature) === feature.id);
  if (!exp) exp = await fsm.api(`${E}/experiments/`, { method: 'POST', body: { feature: feature.id, name: d.name, hypothesis: d.hypothesis, metrics: [{ metric: metric.id, expected_direction: 'increase' }], experiment_rollout: { enabled: true, rollout_percentage: 100, feature_state_value: { type: 'string', value: 'control' }, multivariate_feature_state_values: [{ multivariate_feature_option: opt.id, percentage_allocation: 50 }] } } });
  if (exp.status === 'created') exp = await fsm.api(`${E}/experiments/${exp.id}/start/`, { method: 'POST', body: {} });
  console.log(`${d.flag}: feature ${feature.id}, experiment ${exp.id}, status ${exp.status}`);
}
