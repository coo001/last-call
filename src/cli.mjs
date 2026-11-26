import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnv, requireEnv } from './env.mjs';
import { createClient } from './flagsmith.mjs';
import { decide, fromFlagsmith, pct } from './verdict.mjs';
import { verdictMarkdown, plainWords } from './narrate.mjs';
import { planCleanup } from './cleanup.mjs';

const root = process.cwd();
const dir = (...p) => path.join(root, '.lastcall', ...p);
const flagOf = (argv, name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]) : def; };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readOne(fsm, cfg, exp, { refresh, simulated }) {
  let refreshed = false; let refreshNote = '';
  if (refresh && exp.status === 'running') {
    try { await fsm.refreshResults(exp.id); await fsm.refreshExposures(exp.id).catch(() => {}); refreshed = true; }
    catch (e) { refreshNote = e.status === 429 ? 'Flagsmith allows one refresh every 5 minutes; using the last computed results.' : `refresh failed (${e.status}); using the last computed results.`; }
  }
  let results = await fsm.getResults(exp.id);
  if (refreshed) { // results are computed asynchronously: wait until as_of moves past the request
    for (let i = 0; i < 12; i++) { const r = results?.results; if (r?.as_of && r.refresh_requested_at && r.as_of >= r.refresh_requested_at) break; await sleep(2500); results = await fsm.getResults(exp.id); }
  }
  const exposures = await fsm.getExposures(exp.id).catch(() => null);
  // configured split: read the experiment's rollout segment override on the flag
  const allocation = await readAllocation(fsm, cfg, exp).catch(() => null);
  const input = fromFlagsmith({ experiment: exp, results, exposures, allocation, simulatedTraffic: simulated });
  return { input, verdict: decide(input), refreshNote };
}

async function readAllocation(fsm, cfg, exp) {
  const opts = exp.feature.multivariate_options || [];
  if (cfg.allocationOverride) return cfg.allocationOverride;
  const states = await fsm.api(`api/v1/environments/${cfg.envKey}/featurestates/?feature=${exp.feature.id}`);
  const segs = await fsm.api(`api/v1/features/feature-segments/?environment=${cfg.envId}&feature=${exp.feature.id}`).catch(() => null);
  const segIds = new Set((segs?.results || []).map((s) => s.id));
  let st = null;
  for (const fseg of segIds) { const r = await fsm.api(`api/v1/features/featurestates/?environment=${cfg.envId}&feature=${exp.feature.id}&feature_segment=${fseg}`).catch(() => null); if (r?.results?.[0]) { st = r.results[0]; break; } }
  st = st || states.results?.[0];
  const alloc = {}; let used = 0;
  for (const mv of st?.multivariate_feature_state_values || []) { const o = opts.find((x) => x.id === mv.multivariate_feature_option); if (o) { alloc[o.key] = mv.percentage_allocation / 100; used += mv.percentage_allocation / 100; } }
  alloc.control = Math.max(0, 1 - used);
  return used > 0 ? alloc : null;
}

async function context(argv) {
  const cfg = loadEnv(); requireEnv(cfg);
  const verbose = flagOf(argv, 'verbose', false);
  const fsm = createClient(cfg, { log: verbose ? (m) => console.error('  ' + m) : undefined });
  const envs = await fsm.api(`api/v1/environments/?project=${cfg.projectId}`);
  const env = envs.results.find((e) => e.api_key === cfg.envKey);
  cfg.envId = env?.id; cfg.envName = env?.name;
  const link = (id) => `${cfg.dashboard}/project/${cfg.projectId}/environment/${cfg.envKey}/experiments/${id}`;
  return { cfg, fsm, link };
}
const publicLink = (cfg, id) => `${cfg.dashboard}/project/${cfg.projectId}/environment/<environment-key>/experiments/${id}`;

export async function review(argv) {
  const { cfg, fsm } = await context(argv);
  const simulated = !flagOf(argv, 'real-traffic', false);
  const only = flagOf(argv, 'experiment', null);
  const list = (await fsm.listExperiments()).results.filter((e) => e.status === 'running' && (!only || String(e.id) === String(only)));
  if (!list.length) { console.log('No running experiments in this environment.'); return []; }
  const out = [];
  for (const exp of list) out.push({ exp, ...(await readOne(fsm, cfg, exp, { refresh: !flagOf(argv, 'no-refresh', false), simulated })) });
  console.log(`\nLast Call · ${cfg.envName} · ${list.length} running experiment${list.length > 1 ? 's' : ''}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('EXPERIMENT', 26) + pad('FLAG', 20) + pad('IDENTITIES', 12) + pad('BEST', 14) + pad('CHANCE', 9) + pad('95% INTERVAL', 22) + 'VERDICT');
  for (const { exp, input, verdict } of out) {
    const best = Object.entries(input.inference).sort((a, b) => b[1].chanceToWin - a[1].chanceToWin)[0];
    console.log(pad(exp.name.slice(0, 24), 26) + pad(input.experiment.flag, 20) + pad(verdict.total, 12) + pad(best?.[0] || '-', 14) + pad(best ? `${(best[1].chanceToWin * 100).toFixed(1)}%` : '-', 9) + pad(best ? `${pct(best[1].ciLow)} to ${pct(best[1].ciHigh)}` : '-', 22) + verdict.decision.replace('_', ' ') + (verdict.winner ? ` ${verdict.winner}` : ''));
  }
  fs.mkdirSync(dir('verdicts'), { recursive: true });
  for (const { exp, input, verdict, refreshNote } of out) {
    console.log(`\n#${exp.id} ${exp.name}: ${verdict.reason}`);
    for (const c of verdict.checks) console.log(`   ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
    if (verdict.moreIdentitiesEstimate != null) console.log(`   Rough estimate: about ${verdict.moreIdentitiesEstimate.toLocaleString('en-US')} more identities needed (Last Call's own rule of thumb).`);
    if (refreshNote) console.log(`   Note: ${refreshNote}`);
    const plain = flagOf(argv, 'llm', false) ? await plainWords(input, verdict) : null;
    const md = verdictMarkdown(input, verdict, { plain, links: { experiment: publicLink(cfg, exp.id) } });
    fs.writeFileSync(dir('verdicts', `${input.experiment.flag}.md`), md + '\n');
    fs.writeFileSync(dir('verdicts', `${input.experiment.flag}.json`), JSON.stringify({ input, verdict: { ...verdict, rules: undefined }, plain, generatedAt: new Date().toISOString() }, null, 2) + '\n');
  }
  if (simulated) console.log('\nTraffic is treated as simulated (pass --real-traffic to drop the label).');
  console.log(`Verdicts written to .lastcall/verdicts/. Next: last-call propose --experiment <id>`);
  console.log(`Flagsmith CLI calls made: ${fsm.calls.length}`);
  return out;
}

export async function propose(argv) {
  const { cfg, fsm } = await context(argv);
  const id = flagOf(argv, 'experiment', null); if (!id || id === true) throw new Error('Usage: last-call propose --experiment <id>');
  const exp = await fsm.getExperiment(id);
  const { input, verdict } = await readOne(fsm, cfg, exp, { refresh: false, simulated: !flagOf(argv, 'real-traffic', false) });
  const flag = input.experiment.flag;
  if (verdict.decision !== 'SHIP') {
    console.log(`#${id} ${exp.name}: ${verdict.decision.replace('_', ' ')}. No pull request.\n${verdict.reason}`);
    fs.mkdirSync(dir('verdicts'), { recursive: true });
    fs.writeFileSync(dir('verdicts', `${flag}.md`), verdictMarkdown(input, verdict, { links: { experiment: publicLink(cfg, exp.id) } }) + '\n');
    return { verdict };
  }
  if (!flagOf(argv, 'allow-dirty', false) && git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).lastcall')) throw new Error('Tracked files have uncommitted changes. Commit or stash first, or pass --allow-dirty.');
  const plan = planCleanup(root, flag, verdict.winner);
  const changed = plan.filter((p) => p.changed);
  const leftovers = plan.filter((p) => p.leftoverLines.length);
  const option = input.experiment.options.find((o) => o.key === verdict.winner);
  const decision = {
    version: 1, experimentId: exp.id, experimentName: exp.name, featureId: input.experiment.featureId, flag,
    rolloutDecision: verdict.rolloutDecision, winner: verdict.winner, rolloutVariant: verdict.rolloutDecision === 'variant' ? option.id : null,
    resultsAsOf: input.asOf, chanceToWin: input.inference[verdict.winner]?.chanceToWin ?? null,
    ciLow: input.inference[verdict.winner]?.ciLow ?? null, ciHigh: input.inference[verdict.winner]?.ciHigh ?? null,
    simulatedTraffic: input.simulatedTraffic, proposedAt: new Date().toISOString(),
  };
  const plain = flagOf(argv, 'llm', false) ? await plainWords(input, verdict) : null;
  const chance = decision.chanceToWin != null ? ` (${(decision.chanceToWin * 100).toFixed(1)}%)` : '';
  const title = `Last Call: ship \`${verdict.winner}\` for ${flag}${chance}`;
  const body = [
    verdictMarkdown(input, verdict, { plain, links: { experiment: publicLink(cfg, exp.id) } }), '',
    '## What merging this pull request does', '',
    `1. Deletes the losing code for \`${flag}\` (${changed.length} file${changed.length === 1 ? '' : 's'} in this diff).`,
    `2. After the merge, the \`last-call apply\` workflow calls \`POST /experiments/${exp.id}/complete/\` through the Flagsmith CLI with \`rollout_decision: ${decision.rolloutDecision}\`. Flagsmith ends the experiment, unlocks the flag and serves \`${verdict.winner}\` to everyone on the same flag.`,
    '', '**Nothing has changed in Flagsmith yet.** Closing this pull request leaves the experiment running.', '',
    ...(leftovers.length ? ['## Left for a human', '', ...leftovers.map((p) => `- \`${p.file}\` still mentions \`${flag}\` on line ${p.leftoverLines.join(', ')}. Last Call only rewrites the \`pick()\` pattern and does not guess at anything else.`), ''] : []),
    ...plan.flatMap((p) => p.notes.map((n) => `- note: ${n}`)),
  ].join('\n');
  if (flagOf(argv, 'dry-run', false)) { console.log(title + '\n\n' + body); for (const p of changed) console.log(`\n--- ${p.file}\n${p.after}`); return { verdict, decision, plan }; }

  const branch = `last-call/${flag}`; const baseBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('checkout', '-q', '-B', branch);
  for (const p of changed) fs.writeFileSync(path.join(root, p.file), p.after);
  for (const p of changed) execFileSync(process.execPath, ['--check', path.join(root, p.file)], { stdio: 'pipe' }); // the rewrite must still parse
  fs.mkdirSync(dir('decisions'), { recursive: true }); fs.mkdirSync(dir('verdicts'), { recursive: true });
  fs.writeFileSync(dir('decisions', `${flag}.json`), JSON.stringify(decision, null, 2) + '\n');
  fs.writeFileSync(dir('verdicts', `${flag}.md`), verdictMarkdown(input, verdict, { plain, links: { experiment: publicLink(cfg, exp.id) } }) + '\n');
  fs.writeFileSync(dir(`pr-${flag}.md`), `# ${title}\n\n${body}\n`);
  git('add', '--', ...changed.map((p) => p.file), '.lastcall/decisions', '.lastcall/verdicts');
  git('commit', '-q', '-m', `Last Call: ship ${verdict.winner} for ${flag}`, '-m', `Experiment #${exp.id}. Removes the losing variation code. Merging triggers last-call apply.`);
  console.log(`${title}\n`);
  console.log(`Branch ${branch} committed (${changed.map((p) => p.file).join(', ') || 'no code changes'}).`);
  console.log(git('diff', '--stat', `${baseBranch}..${branch}`));
  if (flagOf(argv, 'open-pr', false)) {
    git('push', '-u', 'origin', branch);
    console.log(execFileSync('gh', ['pr', 'create', '--title', title, '--body-file', dir(`pr-${flag}.md`), '--base', baseBranch], { cwd: root, encoding: 'utf8' }));
  } else console.log(`\nPull request body: .lastcall/pr-${flag}.md\nOpen it with: last-call propose --experiment ${exp.id} --open-pr   (needs git remote + gh)`);
  git('checkout', '-q', baseBranch);
  return { verdict, decision, plan, branch };
}

// Runs after a human merged the pull request. Reads only the decision files that are on this commit.
export async function apply(argv) {
  const { fsm, cfg } = await context(argv);
  const only = flagOf(argv, 'flag', null);
  const files = fs.existsSync(dir('decisions')) ? fs.readdirSync(dir('decisions')).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`)) : [];
  if (!files.length) { console.log('No decision files. Nothing to apply.'); return []; }
  const done = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(dir('decisions', f), 'utf8'));
    const exp = await fsm.getExperiment(d.experimentId);
    const tag = `#${d.experimentId} ${d.flag}`;
    if (exp.feature.id !== d.featureId || exp.feature.name !== d.flag) { console.log(`${tag}: REFUSED, the decision file does not match the experiment's flag.`); process.exitCode = 1; continue; }
    if (exp.status === 'completed') {
      const same = exp.rollout_decision === d.rolloutDecision && (exp.rollout_variant ?? null) === (d.rolloutVariant ?? null);
      console.log(`${tag}: already completed (${exp.rollout_decision}${exp.rollout_variant ? ` ${exp.rollout_variant}` : ''}) ${same ? '- nothing to do.' : '- with a DIFFERENT decision than this file. Not touching it.'}`);
      if (!same) process.exitCode = 1; done.push({ ...d, status: 'already-completed' }); continue;
    }
    if (exp.status !== 'running') { console.log(`${tag}: status is "${exp.status}". Not touching it.`); process.exitCode = 1; continue; }
    // Re-check: the result that was approved must still be a SHIP for the same winner.
    const { input, verdict } = await readOne(fsm, cfg, exp, { refresh: false, simulated: d.simulatedTraffic });
    if (verdict.decision !== 'SHIP' || verdict.winner !== d.winner) { console.log(`${tag}: REFUSED, the current verdict is ${verdict.decision}${verdict.winner ? ` ${verdict.winner}` : ''}, not SHIP ${d.winner}. ${verdict.reason}`); process.exitCode = 1; continue; }
    if (flagOf(argv, 'dry-run', false)) { console.log(`${tag}: would complete with ${d.rolloutDecision}${d.rolloutVariant ? ` ${d.rolloutVariant}` : ''} (dry run).`); continue; }
    const body = d.rolloutDecision === 'variant' ? { rollout_decision: 'variant', rollout_variant: d.rolloutVariant } : { rollout_decision: d.rolloutDecision };
    const res = await fsm.completeExperiment(d.experimentId, body);
    console.log(`${tag}: experiment ended at ${res.ended_at}. Flagsmith now serves "${d.winner}" to everyone on ${d.flag} (rollout_decision=${res.rollout_decision}).`);
    console.log(`   results as of ${input.asOf}; ${publicLink(cfg, d.experimentId)}`);
    done.push({ ...d, status: 'completed', endedAt: res.ended_at });
  }
  return done;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const cmds = { review, propose, apply };
  if (!cmds[cmd]) {
    console.log(`Last Call: finish your Flagsmith experiments.\n\n  last-call review [--experiment <id>] [--no-refresh] [--llm] [--real-traffic]\n      Read every running experiment and print a verdict: SHIP, KEEP RUNNING or STOP.\n  last-call propose --experiment <id> [--open-pr] [--dry-run] [--llm]\n      For a SHIP verdict: commit the deletion of the losing code on a branch, with the verdict as PR body.\n  last-call apply [--flag <name>] [--dry-run]\n      After the PR is merged: end the experiment and roll out the winner on the same flag.\n\nNothing changes in Flagsmith before "apply".`);
    return;
  }
  await cmds[cmd](rest);
}
