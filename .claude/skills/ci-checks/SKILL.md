---
name: ci-checks
description: Check a change in this repository by calling the CI workflow on the pushed branch, never by running the checks locally. Use whenever a change needs checking (lint, i18n keys, unit tests, typecheck, build, Playwright e2e), before saying a change works, before opening or updating a pull request, and when asked to "run the tests", "run the checks" or "verify".
---

# Checks run in CI, not locally

In this repository, the checks you would run locally are run by calling CI. Do not run
`npm run check`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` or
`npm run test:e2e` in the session to decide whether a change works: a session's sandbox is not
CI. Its network can block OSRM, Photon and the OpenFreeMap tiles, and its preinstalled Chromium
need not match the Playwright version, so a local run can fail on code that is fine, or pass on
code that is not. The CI run on the pushed commit is the verdict.

Changing files is not checking them: `npx prettier --write` before a commit is fine.

## How

1. Commit the change and push it to the working branch.
2. Call the **CI** workflow (`.github/workflows/ci.yml`) on that branch:
   - GitHub MCP: `actions_run_trigger` with `method: "run_workflow"`, `workflow_id: "ci.yml"`,
     `ref: "<branch>"`;
   - or `gh workflow run ci.yml --ref <branch>`.

   Every run — a pull request, a push to `main`, and a called run — has two jobs:
   `check` (i18n keys, lint, unit tests with coverage, offline dependency wiring,
   typecheck, build) and `e2e` (`npm run test:e2e` in a Chromium that matches
   Playwright). Pull requests do not publish the coverage badges.

3. Find the run: `actions_list` with `method: "list_workflow_runs"`, `resource_id: "ci.yml"` and
   `workflow_runs_filter: { branch: "<branch>" }`. Take the newest run whose `head_sha` is the
   commit you pushed. A pull request run and a called run execute the same jobs.
4. Wait for it: read it with `actions_get` (`method: "get_workflow_run"`) until `status` is
   `completed`, a minute or more apart. It takes a few minutes.
5. Read the result. When `conclusion` is not `success`, get the failing output with
   `get_job_logs` (`run_id`, `failed_only: true`, `return_content: true`), fix the cause, push,
   and call CI again.

## Reporting

- A change is checked when the CI run on its latest commit is green. Say so with the run's
  link (`html_url`).
- When it is red, say which job and test failed and why, with the log lines that show it.
- Never report a local run as the check.
- If CI cannot be called (no access, the dispatch is refused), a pull request's CI run is the
  same check, browser tests included. Say so with that run's link. Do not fall back to a local
  run.

## Outside services

The tests that call live services (`npm run test:deps`, beyond the offline `wiring` part) run in
the **Dependencies** workflow (`dependencies.yml`). It runs by itself on a push that changes how
a service is called (see its `paths`); otherwise call it the same way, with
`workflow_id: "dependencies.yml"`.
