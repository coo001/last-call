// Turns a verdict into Markdown. Numbers and the decision come from verdict.mjs and are printed by
// this template. The optional LLM only writes the short "In plain words" paragraph, and its text is
// dropped if it contains a number that is not already in the verdict.
import { pct } from './verdict.mjs';

const LABEL = { SHIP: 'SHIP', KEEP_RUNNING: 'KEEP RUNNING', STOP: 'STOP: do not trust this data', NOT_RUNNING: 'NOT RUNNING' };

export function verdictMarkdown(input, verdict, { plain, links = {} } = {}) {
  const rate = (a) => (a.n ? `${((a.conversions / a.n) * 100).toFixed(1)}%` : '-');
  const rows = Object.entries(input.arms).map(([k, a]) => {
    const i = input.inference[k];
    return `| \`${k}\`${k === input.experiment.controlKey ? ' (control)' : ''} | ${a.n} | ${a.conversions} | ${rate(a)} | ${i ? pct(i.lift) : 'baseline'} | ${i ? `${pct(i.ciLow)} to ${pct(i.ciHigh)}` : '-'} | ${i ? `${(i.chanceToWin * 100).toFixed(1)}%` : '-'} |`;
  });
  const lines = [
    `## Last Call verdict: ${LABEL[verdict.decision]}${verdict.winner ? ` \`${verdict.winner}\`` : ''}`,
    '',
    `**Experiment:** ${input.experiment.name} (#${input.experiment.id}, flag \`${input.experiment.flag}\`)${links.experiment ? ` · [open in Flagsmith](${links.experiment})` : ''}`,
    `**Hypothesis:** ${input.experiment.hypothesis || '-'}`,
    `**Metric:** \`${input.metric.name}\` (${input.metric.aggregation || 'occurrence'}, expected to ${input.metric.expectedDirection})`,
    `**Results as of:** ${input.asOf || 'not computed yet'}`,
    '',
    `**Why:** ${verdict.reason}`,
    ...(plain ? ['', `**In plain words** (written by an LLM from the numbers below): ${plain}`] : []),
    '',
    '| Variation | Identities | Converted | Rate | Lift vs control | 95% credible interval | Chance to beat control |',
    '|---|---:|---:|---:|---:|---|---:|',
    ...rows,
    '',
    'Lift, credible interval and chance to beat control are read from Flagsmith\'s Bayesian results API. Last Call does not recompute them.',
    '',
    '**Checks, in the order they are applied**',
    ...verdict.checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} · ${c.name}: ${c.detail}`),
  ];
  if (verdict.decision === 'KEEP_RUNNING' && verdict.moreIdentitiesEstimate != null) {
    lines.push('', `Rough estimate by Last Call (not from Flagsmith): about **${verdict.moreIdentitiesEstimate.toLocaleString('en-US')} more identities** before the interval could clear zero, if the lift stays where it is. It is a square-root rule of thumb, not a power calculation.`);
  }
  if (input.simulatedTraffic) lines.push('', '> Traffic in this experiment is **simulated** by `scripts/simulate-traffic.mjs`. The events are real Flagsmith events; the users are not real people.');
  return lines.join('\n');
}

export async function plainWords(input, verdict, { apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash' } = {}) {
  if (!apiKey) return null;
  const facts = { decision: verdict.decision, winner: verdict.winner || null, reason: verdict.reason, hypothesis: input.experiment.hypothesis, metric: input.metric.name, arms: input.arms, inference: input.inference, moreIdentitiesEstimate: verdict.moreIdentitiesEstimate ?? null };
  const prompt = `You explain an A/B test result to a product teammate in two short sentences. The decision is already made by fixed rules; do not change it, do not add advice, do not invent numbers, and use only numbers that appear in the JSON. Say what was tested, what the decision is and the one reason. No markdown.\n\n${JSON.stringify(facts)}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) return null;
    const text = (await res.json())?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
    if (!text) return null;
    // guard: every number in the text must already be a number we showed
    const allowed = JSON.stringify(facts) + verdict.reason + Object.values(input.arms).map((a) => ((a.conversions / a.n) * 100).toFixed(1)).join(' ')
      + Object.values(input.inference).map((i) => [i.lift, i.ciLow, i.ciHigh, i.chanceToWin].map((x) => `${(x * 100).toFixed(1)} ${(x * 100).toFixed(0)} ${Math.abs(x * 100).toFixed(1)}`).join(' ')).join(' ');
    const nums = text.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.some((n) => !allowed.includes(n))) return null;
    return text.replace(/\s+/g, ' ');
  } catch { return null; }
}
