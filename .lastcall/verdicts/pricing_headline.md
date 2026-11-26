## Last Call verdict: KEEP RUNNING

**Experiment:** Pricing headline (#549, flag `pricing_headline`) · [open in Flagsmith](https://app.flagsmith.com/project/56447/environment/<environment-key>/experiments/549)
**Hypothesis:** Leading with the annual price gets more visitors to pick a plan than leading with the monthly price.
**Metric:** `plan_selected` (occurrence, expected to increase)
**Results as of:** 2026-11-26T06:39:10.504687Z

**Why:** annual_first is at 64.5% and its interval (-33.4% to +49.0%) crosses zero. Inconclusive; do not call it.

| Variation | Identities | Converted | Rate | Lift vs control | 95% credible interval | Chance to beat control |
|---|---:|---:|---:|---:|---|---:|
| `control` (control) | 202 | 39 | 19.3% | baseline | - | - |
| `annual_first` | 221 | 46 | 20.8% | +7.8% | -33.4% to +49.0% | 64.5% |

Lift, credible interval and chance to beat control are read from Flagsmith's Bayesian results API. Last Call does not recompute them.

**Checks, in the order they are applied**
- PASS · Sample ratio: p = 0.356 from Last Call's chi-square cross-check (Flagsmith returned null); warn below 0.001
- PASS · Quarantined identities: 0 excluded (0.00%); Last Call's limit is 1%
- PASS · Minimum sample: every arm has at least 50 identities and 5 conversions
- FAIL · Chance to beat control: annual_first: 64.5%; winning at 95% or more, losing at 5% or less
- FAIL · 95% credible interval: annual_first: -33.4% to +49.0%; crosses zero

Rough estimate by Last Call (not from Flagsmith): about **11,375 more identities** before the interval could clear zero, if the lift stays where it is. It is a square-root rule of thumb, not a power calculation.

> Traffic in this experiment is **simulated** by `scripts/simulate-traffic.mjs`. The events are real Flagsmith events; the users are not real people.
