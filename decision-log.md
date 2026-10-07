# Decision log

Decisions about how the app and its pipeline work, with the evidence behind each. Newest first.

## 2026-10-07: Overpass from overpass-api.de only

**Decision.** `scripts/osm.ts` queries only `overpass-api.de`. The mirrors
`overpass.kumi.systems` and `overpass.private.coffee` are dropped for now.

**Why.** Neither mirror answered a single request in the two first runs of the dependency
tests (Dependencies workflow,
[run 37607658548](https://github.com/Almantask/Degalai-web/actions/runs/37607658548) and
[run 37609931499](https://github.com/Almantask/Degalai-web/actions/runs/37609931499)):

| Endpoint                  | Requests | Answered | Failed                   |
| ------------------------- | -------- | -------- | ------------------------ |
| `overpass-api.de`         | 7        | 2        | 5 × HTTP 504             |
| `overpass.kumi.systems`   | 10       | 0        | 10 × 30 s client timeout |
| `overpass.private.coffee` | 10       | 0        | 10 × 30 s client timeout |

Each fetch spent about two minutes on the mirrors (two 30 s tries each) before failing anyway.

**Consequences.**

- A 5xx skips straight to the next endpoint, and now there is none, so one HTTP 504 from
  `overpass-api.de` fails the fetch at once. The pipeline then keeps the last good station and
  charger lists, as it did when every endpoint failed. OSM refreshes on every hourly run on
  Sundays (UTC), so a failed fetch is tried again the next hour.
- The dependency tests (`tests/deps/pipeline.test.ts`) still fail when Overpass does not
  answer; that now means `overpass-api.de` is down or overloaded.

**Revisit** if `overpass-api.de` keeps returning 504s. Options:

- retry a 5xx on the same endpoint after a pause;
- raise the 30 s request timeout towards the query's own `[timeout:90]` and test the mirrors
  again (they may only be slower);
- add a mirror that answers within the timeout.
