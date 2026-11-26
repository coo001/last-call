# What was checked against real Flagsmith Cloud

Checked on 2026-11-26 (UTC 06:10 to 06:30) on a **free plan** organisation (`plan: free`, 1 seat, 50,000 API calls a month), project `last-call`, Development environment, API version header `Flagsmith-Version: 2.295.2`. Every Admin API call went through Flagsmith CLI v2.0.0 (`flagsmith api <path>`, non-interactive with `FLAGSMITH_API_KEY`). Raw run: `verification/rehearsal-transcript.txt`.

This table is the **local rehearsal** (experiments #547 and #550, merge done with a local `git merge`). The **run on GitHub** (experiment #548, pull request #1, Actions run #1) is recorded in its own section below.

| # | Step | Call | Result |
|---|---|---|---|
| 1 | Experimentation on the free plan | `GET /environments/<env>/experiments/` | 200. Creating, starting and completing experiments all worked with no plan error. |
| 2 | Managed warehouse on the free plan | `GET /environments/<env>/warehouse-connections/` | 200, one connection `warehouse_type: flagsmith`. After traffic: `total_events_received: 2381`, `last_event_received_at` set. |
| 3 | Create flag + keyed variation | `POST /projects/<id>/features/`, `POST /projects/<id>/features/<id>/mv-options/` | 201, 201 |
| 4 | Create metric | `POST /environments/<env>/experiment-metrics/` | 201 |
| 5 | Create and start experiment | `POST /environments/<env>/experiments/`, `POST .../experiments/<id>/start/` | 201, then 200 with `status: running` |
| 6 | Events reach the warehouse | Node SDK `@flagsmith/nodejs` 9.5.0, `getExperimentFlag` + `trackEvent` + `flushEvents` | Exposures and conversions appeared in results about 1 minute later |
| 7 | Refresh and read results | `POST .../results/refresh/`, `GET .../results/` | 200. Payload per variation: `n`, `sum`; per treatment: `lift`, `ci_low`, `ci_high`, `chance_to_win`; plus `srm_p_value`, `as_of`, `is_final` |
| 8 | Exposures and quarantined identities | `POST .../exposures/refresh/`, `GET .../exposures/` | 200. `excluded_identities` is in the payload |
| 9 | **End the experiment** | `POST .../experiments/<id>/complete/` with `{"rollout_decision":"variant","rollout_variant":<option id>}` | 200. `status: completed`, `ended_at` set. An empty body returns 400 `rollout_decision: This field is required.` |
| 10 | **Winner on the same flag** | same call as 9 | The environment's flag state changed to 100% on the winning option. The SDK then returned the winner for an identity that had been on control, with `reason: SPLIT; weight=100.0` and no experiment metadata. |
| 11 | Second apply | `last-call apply` again | Reads `status: completed` with the same decision and does nothing |
| 12 | **The same flow on GitHub** | pull request #1 merged by a human, then the workflow `last-call-apply.yml` | Actions run #1 succeeded and ended experiment #548. See the next section |

## The run on GitHub (experiment #548)

Done once, on 2026-11-26, on the public repository. No retries. Times are UTC, read back from GitHub with `gh` and from the Action log; the record is in `verification/run-548-github-record.txt`.

| Time (UTC) | What happened | Evidence |
|---|---|---|
| 06:39:18 | Results that the verdict was read from (`as_of`) | `verification/run-548-review.txt` |
| 06:41:44 | `last-call propose --experiment 548 --open-pr` wrote the decision file and opened the pull request | [pull request #1](https://github.com/coo001/last-call/pull/1), `verification/run-548-propose.txt` |
| 06:44:06 | A human merged pull request #1 in the browser (merge commit `88c113d`) | pull request #1 |
| 06:44:09 | The push to `main` touched `.lastcall/decisions/**` and started workflow "Last Call apply" | [Actions run #1](https://github.com/coo001/last-call/actions/runs/45770249684) |
| 06:44:12 | Job `apply` started on `ubuntu-latest` | run #1 |
| 06:44:23 | `last-call apply` called `complete` once; Flagsmith set `ended_at` to 06:44:23.918 | `verification/run-548-action-apply.txt` |
| 06:44:26 | Job `apply` finished: success, 14 seconds. Whole run: 18 seconds | run #1 |
| after | Flagsmith showed "Completed" and "short rolled out to everyone" for experiment #548 | `docs/img/03-flagsmith-after.png` |
| after | `last-call apply` run again locally: "already completed - nothing to do" | `verification/run-548-apply-rerun.txt` |

The experiment ended 18 seconds after the merge. The log line of the step:

```
#548 invite_cta: experiment ended at 2026-11-26T06:44:23.918004Z. Flagsmith now serves "short" to everyone on invite_cta (rollout_decision=variant).
```

What this run does and does not show: the Action has run **once**, for one experiment, and it took the success path. The refusal paths of `apply` (flag does not match the decision file, verdict no longer SHIP for the same winner) exist in `src/cli.mjs` but were not triggered on GitHub and have no unit test yet; the 15 tests cover the decision rule and the code cleanup.

## What this changed in the plan

- The plan assumed ending an experiment and setting the flag were two steps, and that the first might not have an API. They are **one** call: `complete` takes the rollout decision (`control`, `variant` or `disable`). So "merge, then end and roll out" is a single request and cannot stop half way.
- `srm_p_value` came back `null` in all four experiments (240 to 1,401 identities). The docs say the check starts at 100 identities; we do not know whether `null` means "not computed" or "no mismatch". Last Call therefore uses Flagsmith's value when it is present and otherwise runs its own chi-square check against the configured split, and says which one it used.
- The CLI prints no status line for a 4xx and still exits 0. `src/flagsmith.mjs` reads the status from the CLI's error text.
- The Flagsmith MCP server was not used: the docs say it cannot start experiments, and the CLI covers every call above.

## Not checked

- `is_final` stayed `false` right after completion; we did not wait to see when results freeze.
- The GitHub Action has run on GitHub once (run #1, above). A second experiment going through it, a failing run, and the refusal paths of `apply` on GitHub were not checked.
- Behaviour with more than one treatment, with non-occurrence metrics (count, sum, mean) and with guardrail metrics.
