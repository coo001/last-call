# Last Call

**Your experiment hit 99.5%. Who ends it, rolls out the winner and deletes the losing code?**

Flagsmith's docs leave the last step of an experiment to you: click End Experiment, update the flag so everyone gets the winner, then "clean up the flag and remove the losing variations". Last Call is an agent for that step. It reads a running experiment through the **Flagsmith CLI**, gives one of three verdicts, and for a winner it prepares a pull request that deletes the losing code. **Merging the pull request is the approval.** After the merge it ends the experiment and Flagsmith serves the winner to everyone on the same flag.

Built for Toggle Wars, Track 02 (AI Agents and Feature Flags).

```
$ npx last-call review

Last Call · Development · 2 running experiments

EXPERIMENT                FLAG                IDENTITIES  BEST          CHANCE   95% INTERVAL          VERDICT
Pricing headline          pricing_headline    423         annual_first  64.5%    -33.4% to +49.0%      KEEP RUNNING
Invite button copy        invite_cta          1401        short         99.5%    +16.2% to +114.2%     SHIP short
```

These are live numbers from Flagsmith Cloud (free plan), read on 2026-11-26. The traffic behind them is **simulated**; see [What is real and what is simulated](#what-is-real-and-what-is-simulated).

## Five minutes for judges

No Flagsmith account needed for the first three steps.

```bash
git clone <this repo> && cd last-call && npm install
npm test                      # 15 tests: the decision rule and the code cleanup
npm run demo                  # http://localhost:4173 demo app, http://localhost:4173/verdict latest verdicts
```

- `verification/rehearsal-transcript.txt` is an unedited run of the whole flow on real Flagsmith Cloud: verdict, cleanup commit, merge, experiment ended, second run a no-op.
- `VERIFICATION.md` lists every Flagsmith endpoint that was called and what came back.
- `.lastcall/verdicts/` holds the two verdicts above as Markdown and JSON.

With your own Flagsmith project (free plan is enough):

```bash
cp .env.example .env          # admin API key, environment key, project id
npm run setup                 # creates 2 flags, 2 metrics, 2 experiments and starts them
node scripts/simulate-traffic.mjs --flag invite_cta --event invite_sent --users 1400 --rates control=0.10,short=0.16 --prefix sim-invite
node scripts/simulate-traffic.mjs --flag pricing_headline --event plan_selected --users 500 --rates control=0.20,annual_first=0.225 --prefix sim-price
npx last-call review          # about a minute after the traffic
npx last-call propose --experiment <id>     # branch + commit + PR body; add --open-pr to open it with gh
# merge the pull request, then (the GitHub Action does this for you):
npx last-call apply
```

## What it does

| Step | Command | What happens | Changes Flagsmith? |
|---|---|---|---|
| 1. Read | `last-call review` | Lists running experiments, refreshes results (Flagsmith allows one refresh per 5 minutes; a 429 falls back to the last computed results), prints the verdict and the checks behind it | No |
| 2. Propose | `last-call propose --experiment <id>` | Only for SHIP. Deletes the losing branch in code, writes `.lastcall/decisions/<flag>.json`, commits both on `last-call/<flag>`, writes the PR body (the verdict). For KEEP RUNNING or STOP it prints the reason and opens nothing | No |
| 3. Approve | a human merges the PR | | No |
| 4. Apply | `last-call apply` (GitHub Action on merge) | Re-reads the experiment, refuses if the flag does not match the decision file or the verdict is no longer SHIP for the same winner, then calls `complete` | **Yes, one call** |

The cleanup, as produced for the rehearsal flag:

```diff
-import { pick } from '../lib/pick.mjs';
 export async function rehearsalBanner(flags, userId) {
-  const flag = await flags.getExperimentFlag('rehearsal_cta', userId);
-  const text = pick(flag, {
-    control: 'Try the planner',
-    bold: 'Plan your trip now',
-  });
+  const text = 'Plan your trip now';
   return `<a class="banner">${text}</a>`;
 }
```

## How it uses Flagsmith

Flagsmith is the source of every number and the target of the only write. All Admin API calls go through `flagsmith api` (CLI v2), so the CLI's credential handling is the only place the admin key is used.

| Flagsmith piece | Used for |
|---|---|
| CLI v2 `flagsmith api` | Transport for every call below (`src/flagsmith.mjs`) |
| `GET /environments/<env>/experiments/` | Find running experiments, their flag, variations and metric |
| `POST .../results/refresh/`, `GET .../results/` | Lift, 95% credible interval, chance to beat control, `srm_p_value` |
| `GET .../exposures/` | Quarantined (excluded) identities |
| Flag states and the experiment's rollout segment | The configured split, for the sample-ratio cross-check |
| `POST .../experiments/<id>/complete/` | Ends the experiment and rolls the winner out on the same flag, in one request |
| Node SDK `getExperimentFlag`, `trackEvent` | The demo app and the traffic simulator send real exposure and conversion events |
| Managed warehouse (Flagsmith Cloud) | Stores those events; nothing to host |

## The decision rule

One reading only: Flagsmith's Bayesian engine. Last Call does not compute lift, the credible interval or the chance to win. It reads them from the results API and applies fixed gates in this order (`src/verdict.mjs`, no LLM involved):

| Order | Gate | Fails when | Verdict |
|---|---|---|---|
| 1 | Sample ratio | `srm_p_value` < 0.001. If Flagsmith returns `null`, Last Call runs a chi-square check on the configured split (from 100 identities) and says so | STOP |
| 2 | Quarantined identities | more than 1% of identities saw two variations (Last Call's own threshold) | STOP |
| 3 | Minimum sample | any arm under 50 identities or 5 conversions (Flagsmith's "collecting data" floor) | KEEP RUNNING |
| 4 | Win | chance to beat control ≥ 95% **and** the 95% credible interval is clear of zero | SHIP the variation |
| 5 | Loss | every variation ≤ 5% and its interval entirely on the losing side | SHIP control |
| 6 | Otherwise | | KEEP RUNNING |

Gate 4 needs both conditions, so 96% with an interval that still touches zero is not a win. For KEEP RUNNING, Last Call adds a rough count of how many more identities it would take for the interval to clear zero if the lift stayed the same. That number is Last Call's own square-root rule of thumb, it is labelled as such everywhere it appears, and it is not a power calculation.

The three boundary cases named in the tests: 99.5% with a clear interval ships; an interval crossing zero keeps running even at 84%; a 912 / 640 split on a 50/50 experiment stops before any win is read.

## Track 02 checklist

| What the track looks for | Where |
|---|---|
| Flagsmith CLI, API or MCP server | Every call is `flagsmith api ...` through CLI v2; see the table above and `VERIFICATION.md` |
| Saves real time | Four manual steps (read the result, End Experiment, change the flag, remove the losing code) become one review and one merge. We have not measured minutes saved with real teams |
| A human approves changes | Nothing is written to Flagsmith before the merge. `apply` reads only decision files that are on the merged commit |
| Clear output | One table, one verdict word, the checks that led to it, and the same text as the PR body |

## Why this step

- Flagsmith's own docs describe the ending as manual: "To roll out the winner, update the flag so every user gets the winning variation. Once it's permanent, clean up the flag and remove the losing variations." ([Analyse an Experiment](https://docs.flagsmith.com/experimentation/analyse-an-experiment))
- "When a rollout is complete or an experiment has ended, the flag should be removed from your code and from Flagsmith. In practice, flags accumulate." ([Stale Flag Detection](https://docs.flagsmith.com/managing-flags/stale-flags), which is on the Scale-up and Enterprise plans and still ends with removing the call sites by hand)
- The Flagsmith repository itself carries issues of this kind, for example [#6717 "Remove stale feature flag: environment_metrics"](https://github.com/Flagsmith/flagsmith/issues/6717).

This is evidence that the chore exists. It is not evidence that teams want this tool; we have no users yet.

## What is real and what is simulated

| | Real | Simulated |
|---|---|---|
| Flagsmith project, flags, experiments, results, the `complete` call | Yes, Flagsmith Cloud free plan | |
| Exposure and conversion events | Real events through the Node SDK into the managed warehouse | The users are generated by `scripts/simulate-traffic.mjs` with fixed conversion rates (10% vs 16%, and 20% vs 22.5%) |
| Statistics | Flagsmith's own engine | |
| Human approval | A real `git merge`; the full run so far used a local merge | The GitHub Action has not run on GitHub yet |
| The demo app "Trailmix" | Renders by real flag values | It is not a product |

Every verdict produced from this traffic carries the line "Traffic in this experiment is simulated".

## What it does not do

- It does not create or start experiments. Flagsmith's coding-agent prompt already does that.
- It does not decide with an LLM. With `--llm` and a `GEMINI_API_KEY`, a model writes two plain sentences under the verdict; the text is dropped if it contains a number that is not in the results. Without a key everything works from the template.
- It does not rewrite arbitrary code. The cleanup understands one pattern, `pick(flag, { control: ..., variation: ... })`. Any other line that still mentions the flag is listed in the PR under "Left for a human".
- It does not delete the flag in Flagsmith. After the rollout the flag still serves the winner, so old clients keep working; removing the flag is a later, separate decision.

## Limits

- Tested with one treatment and one occurrence metric per experiment. Guardrail metrics are not read yet.
- `srm_p_value` was `null` in every run we made, so the STOP path has only been exercised in unit tests.
- Experimentation is in beta; the endpoints above may change.

## AI disclosure

Code and text in this repository were written with AI coding assistants and reviewed by the author. The optional `--llm` sentence uses Gemini. No AI-generated data is presented as real: simulated traffic is labelled wherever it appears.

## Layout

```
bin/last-call.mjs        CLI entry
src/flagsmith.mjs        Flagsmith CLI wrapper     src/verdict.mjs   decision rule
src/cleanup.mjs          losing-code removal       src/narrate.mjs   verdict Markdown, optional LLM sentence
demo/                    Trailmix demo app and /verdict page
scripts/                 setup-experiments, simulate-traffic, probe
.github/workflows/       last-call-apply.yml (runs apply after a merge)
```

MIT licence.
