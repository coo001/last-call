// The decision rule. Pure functions, no network, no LLM.
//
// One reading only: Flagsmith's own Bayesian engine. Last Call does not compute lift, the credible
// interval or the chance to win; it reads them from GET .../experiments/<id>/results/ and applies
// fixed gates in a fixed order. The two numbers Last Call computes itself are labelled as such:
// the sample-ratio cross-check and the rough "how many more identities" estimate.

export const RULES = Object.freeze({
  minIdentitiesPerArm: 50,   // Flagsmith's "collecting data" floor
  minConversionsPerArm: 5,   // Flagsmith's floor for occurrence metrics
  srmAlpha: 0.001,           // Flagsmith warns at one-in-a-thousand
  srmMinIdentities: 100,     // Flagsmith checks SRM from 100 identities
  maxExcludedShare: 0.01,    // Last Call's own threshold: >1% quarantined identities = do not trust
  winChance: 0.95,           // Flagsmith: "winning" above 95%
  loseChance: 0.05,          // Flagsmith: "losing" below 5%
});

// --- chi-square p-value (upper tail), for the sample-ratio cross-check ---
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function gammaQ(a, x) { // regularised upper incomplete gamma
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a; let del = sum; for (let n = 1; n < 200; n++) { del *= x / (a + n); sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a)); }
  let b = x + 1 - a; let c = 1 / 1e-300; let d = 1 / b; let h = d;
  for (let i = 1; i < 200; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
export function srmPValue(observed, expectedShares) {
  const keys = Object.keys(observed); const total = keys.reduce((s, k) => s + observed[k], 0);
  if (keys.length < 2 || total === 0) return null;
  let chi = 0; for (const k of keys) { const exp = total * expectedShares[k]; if (!(exp > 0)) return null; chi += (observed[k] - exp) ** 2 / exp; }
  return gammaQ((keys.length - 1) / 2, chi / 2);
}

/**
 * @param input {
 *   experiment: { id, name, hypothesis, status, flag, controlKey },
 *   metric: { id, name, expectedDirection },
 *   arms: { [variantKey]: { n, conversions } },          // includes the control arm
 *   inference: { [variantKey]: { lift, ciLow, ciHigh, chanceToWin } }, // treatments only, vs control
 *   allocation: { [variantKey]: share 0..1 } | null,      // configured split
 *   srmPValueFromFlagsmith: number | null,
 *   excludedIdentities: number,
 *   asOf: string, simulatedTraffic: boolean }
 */
export function decide(input, rules = RULES) {
  const { arms, inference } = input;
  const controlKey = input.experiment.controlKey || 'control';
  const total = Object.values(arms).reduce((s, a) => s + a.n, 0);
  const checks = [];
  const out = (decision, reason, extra = {}) => ({ decision, reason, checks, total, rules, ...extra });

  if (input.experiment.status !== 'running') {
    return out('NOT_RUNNING', `The experiment is "${input.experiment.status}", not running. Nothing to decide.`);
  }

  // Gate 1: is the data trustworthy?
  const ownSrm = input.allocation && total >= rules.srmMinIdentities
    ? srmPValue(Object.fromEntries(Object.entries(arms).map(([k, a]) => [k, a.n])), input.allocation) : null;
  const srm = input.srmPValueFromFlagsmith ?? ownSrm;
  const srmSource = input.srmPValueFromFlagsmith != null ? 'Flagsmith srm_p_value' : ownSrm != null ? "Last Call's chi-square cross-check (Flagsmith returned null)" : 'not checked (fewer than 100 identities or unknown split)';
  const srmOk = srm == null || srm >= rules.srmAlpha;
  checks.push({ name: 'Sample ratio', pass: srmOk, detail: srm == null ? srmSource : `p = ${srm.toPrecision(3)} from ${srmSource}; warn below ${rules.srmAlpha}` });
  const excludedShare = total + input.excludedIdentities > 0 ? input.excludedIdentities / (total + input.excludedIdentities) : 0;
  const exclOk = excludedShare <= rules.maxExcludedShare;
  checks.push({ name: 'Quarantined identities', pass: exclOk, detail: `${input.excludedIdentities} excluded (${(excludedShare * 100).toFixed(2)}%); Last Call's limit is ${(rules.maxExcludedShare * 100).toFixed(0)}%` });
  if (!srmOk) return out('STOP', 'Traffic did not split the way the experiment was configured (sample ratio mismatch). Do not act on these results; find the cause first.');
  if (!exclOk) return out('STOP', 'Too many identities saw more than one variation. The groups are not comparable; fix assignment before reading the result.');

  // Gate 2: Flagsmith's "collecting data" floor
  const thin = Object.entries(arms).filter(([, a]) => a.n < rules.minIdentitiesPerArm || a.conversions < rules.minConversionsPerArm).map(([k]) => k);
  checks.push({ name: 'Minimum sample', pass: thin.length === 0, detail: thin.length ? `below ${rules.minIdentitiesPerArm} identities or ${rules.minConversionsPerArm} conversions: ${thin.join(', ')}` : `every arm has at least ${rules.minIdentitiesPerArm} identities and ${rules.minConversionsPerArm} conversions` });
  if (thin.length) return out('KEEP_RUNNING', `Still collecting data (${thin.join(', ')} is under Flagsmith's floor of ${rules.minIdentitiesPerArm} identities and ${rules.minConversionsPerArm} conversions).`, { collecting: true });

  // Gate 3: the Bayesian reading, exactly as Flagsmith defines winning / losing / inconclusive
  const sign = input.metric.expectedDirection === 'decrease' ? -1 : 1;
  const treatments = Object.entries(inference).map(([key, i]) => {
    const lo = sign === 1 ? i.ciLow : -i.ciHigh; const hi = sign === 1 ? i.ciHigh : -i.ciLow;
    return { key, chance: i.chanceToWin, lift: i.lift, ciLow: i.ciLow, ciHigh: i.ciHigh, goodLow: lo, goodHigh: hi };
  }).sort((a, b) => b.chance - a.chance);
  if (!treatments.length) return out('KEEP_RUNNING', 'Flagsmith has not computed an inference for any variation yet.', { collecting: true });
  const best = treatments[0];
  const winner = best.chance >= rules.winChance && best.goodLow > 0;
  const allLose = treatments.every((t) => t.chance <= rules.loseChance && t.goodHigh < 0);
  checks.push({ name: 'Chance to beat control', pass: winner || allLose, detail: `${best.key}: ${(best.chance * 100).toFixed(1)}%; winning at ${(rules.winChance * 100).toFixed(0)}% or more, losing at ${(rules.loseChance * 100).toFixed(0)}% or less` });
  checks.push({ name: '95% credible interval', pass: winner || allLose, detail: `${best.key}: ${pct(best.ciLow)} to ${pct(best.ciHigh)}; ${best.ciLow <= 0 && best.ciHigh >= 0 ? 'crosses zero' : 'clear of zero'}` });

  if (winner) return out('SHIP', `${best.key} has a ${(best.chance * 100).toFixed(1)}% chance to beat control and its 95% credible interval (${pct(best.ciLow)} to ${pct(best.ciHigh)}) is clear of zero.`, { winner: best.key, rolloutDecision: 'variant' });
  if (allLose) return out('SHIP', `No variation beats control (best chance ${(best.chance * 100).toFixed(1)}%, interval entirely on the losing side). Keep control and delete the variation code.`, { winner: controlKey, rolloutDecision: 'control' });

  // Inconclusive. Rough estimate only: the interval narrows with the square root of the sample.
  const half = (best.ciHigh - best.ciLow) / 2;
  const more = Math.abs(best.lift) > 0 ? Math.max(0, Math.ceil(total * ((half / Math.abs(best.lift)) ** 2 - 1))) : null;
  return out('KEEP_RUNNING', `${best.key} is at ${(best.chance * 100).toFixed(1)}% and its interval (${pct(best.ciLow)} to ${pct(best.ciHigh)}) ${best.ciLow <= 0 && best.ciHigh >= 0 ? 'crosses zero' : 'is not decisive'}. Inconclusive; do not call it.`, { leading: best.key, moreIdentitiesEstimate: more });
}

export const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

/** Maps Flagsmith's API responses to the input of decide(). */
export function fromFlagsmith({ experiment, results, exposures, allocation = null, simulatedTraffic = false }) {
  const payload = results?.results?.payload; const metric = experiment.metrics?.[0];
  const m = payload?.metrics?.find((x) => x.metric_id === metric?.metric) || payload?.metrics?.[0];
  const arms = {}; for (const [k, v] of Object.entries(m?.variants || {})) arms[k] = { n: v.n, conversions: v.sum };
  const inference = {}; for (const [k, v] of Object.entries(m?.inference || {})) inference[k] = { lift: v.lift, ciLow: v.ci_low, ciHigh: v.ci_high, chanceToWin: v.chance_to_win };
  return {
    experiment: { id: experiment.id, name: experiment.name, hypothesis: experiment.hypothesis, status: experiment.status, flag: experiment.feature?.name, featureId: experiment.feature?.id, controlKey: 'control', options: (experiment.feature?.multivariate_options || []).map((o) => ({ id: o.id, key: o.key, value: o.string_value ?? o.integer_value ?? o.boolean_value })) },
    metric: { id: metric?.metric, name: metric?.metric_name, aggregation: metric?.aggregation, expectedDirection: metric?.expected_direction || 'increase' },
    arms, inference, allocation,
    srmPValueFromFlagsmith: payload?.srm_p_value ?? null,
    excludedIdentities: exposures?.exposures?.payload?.excluded_identities ?? 0,
    asOf: results?.results?.as_of || null, isFinal: !!results?.results?.is_final, simulatedTraffic,
  };
}
