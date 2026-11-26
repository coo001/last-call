## Last Call verdict: SHIP `short`

**Experiment:** Invite button copy (#548, flag `invite_cta`) · [open in Flagsmith](https://app.flagsmith.com/project/56447/environment/<environment-key>/experiments/548)
**Hypothesis:** A shorter invite button ("Send invite") gets more people to send at least one invite than "Invite your teammates to this trip".
**Metric:** `invite_sent` (occurrence, expected to increase)
**Results as of:** 2026-11-26T06:39:18.388995Z

**Why:** short has a 99.5% chance to beat control and its 95% credible interval (+16.2% to +114.2%) is clear of zero.

| Variation | Identities | Converted | Rate | Lift vs control | 95% credible interval | Chance to beat control |
|---|---:|---:|---:|---:|---|---:|
| `control` (control) | 664 | 60 | 9.0% | baseline | - | - |
| `short` | 737 | 110 | 14.9% | +65.2% | +16.2% to +114.2% | 99.5% |

Lift, credible interval and chance to beat control are read from Flagsmith's Bayesian results API. Last Call does not recompute them.

**Checks, in the order they are applied**
- PASS · Sample ratio: p = 0.0511 from Last Call's chi-square cross-check (Flagsmith returned null); warn below 0.001
- PASS · Quarantined identities: 0 excluded (0.00%); Last Call's limit is 1%
- PASS · Minimum sample: every arm has at least 50 identities and 5 conversions
- PASS · Chance to beat control: short: 99.5%; winning at 95% or more, losing at 5% or less
- PASS · 95% credible interval: short: +16.2% to +114.2%; clear of zero

> Traffic in this experiment is **simulated** by `scripts/simulate-traffic.mjs`. The events are real Flagsmith events; the users are not real people.
