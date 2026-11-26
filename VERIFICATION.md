# What was checked against real Flagsmith Cloud

Checked on 2026-11-26 (UTC 06:10 to 06:30) on a **free plan** organisation (`plan: free`, 1 seat, 50,000 API calls a month), project `last-call`, Development environment, API version header `Flagsmith-Version: 2.295.2`. Every Admin API call went through Flagsmith CLI v2.0.0 (`flagsmith api <path>`, non-interactive with `FLAGSMITH_API_KEY`). Raw run: `verification/rehearsal-transcript.txt`.

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

## What this changed in the plan

- The plan assumed ending an experiment and setting the flag were two steps, and that the first might not have an API. They are **one** call: `complete` takes the rollout decision (`control`, `variant` or `disable`). So "merge, then end and roll out" is a single request and cannot stop half way.
- `srm_p_value` came back `null` in all four experiments (240 to 1,401 identities). The docs say the check starts at 100 identities; we do not know whether `null` means "not computed" or "no mismatch". Last Call therefore uses Flagsmith's value when it is present and otherwise runs its own chi-square check against the configured split, and says which one it used.
- The CLI prints no status line for a 4xx and still exits 0. `src/flagsmith.mjs` reads the status from the CLI's error text.
- The Flagsmith MCP server was not used: the docs say it cannot start experiments, and the CLI covers every call above.

## Not checked

- `is_final` stayed `false` right after completion; we did not wait to see when results freeze.
- The GitHub Action (`.github/workflows/last-call-apply.yml`) has not run on GitHub yet. The same command was run locally after a local `git merge`.
- Behaviour with more than one treatment, with non-occurrence metrics (count, sum, mean) and with guardrail metrics.
