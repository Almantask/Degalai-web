import { describe, expect, it } from "vitest";
import { REPORT_LABELS } from "../../worker/src/report.ts";
import { readAll, workerVar } from "./repo.ts";

// Live: GitHub has what the cron worker, the feedback form and the workflows call it with.
// GITHUB_TOKEN is optional; it lifts the rate limit.

const repo = workerVar("GITHUB_REPO");
const token = process.env.GITHUB_TOKEN;

async function api<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "kur-degalai-deps",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** Repo files that name labels: workflows and issue templates. */
const githubFiles = [
  ...readAll(".github/workflows", ".yml").values(),
  ...readAll(".github/ISSUE_TEMPLATE", ".yml").values(),
].join("\n");

/** Labels put on issues: feedback from the worker, issue templates, pipeline failures. */
function labelsInUse(): string[] {
  const named = [...githubFiles.matchAll(/labels:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    m[1].split(",").map((l) => l.trim().replace(/^["']|["']$/g, "")),
  );
  return [...new Set([...Object.values(REPORT_LABELS).flat(), ...named])].filter(Boolean).sort();
}

describe(`GitHub repository ${repo}`, () => {
  it("exists with issues on", async () => {
    const { status, body } = await api<{ has_issues: boolean }>("");
    expect(status).toBe(200);
    expect(body.has_issues).toBe(true);
  });

  it("has the branch the cron dispatches", async () => {
    const ref = workerVar("GITHUB_REF");
    expect((await api(`/branches/${ref}`)).status, ref).toBe(200);
  });

  it("keeps the dispatched workflow enabled", async () => {
    const name = workerVar("GITHUB_WORKFLOW");
    const { status, body } = await api<{ state: string }>(`/actions/workflows/${name}`);
    expect(status, name).toBe(200);
    // GitHub disables a scheduled workflow after 60 days without repository activity.
    expect(body.state, name).toBe("active");
  });

  it("has every label issues are filed with", async () => {
    const { status, body } = await api<Array<{ name: string }>>("/labels?per_page=100");
    expect(status).toBe(200);
    const existing = new Set(body.map((l) => l.name));
    expect(
      labelsInUse().filter((l) => !existing.has(l)),
      "missing labels",
    ).toEqual([]);
  });
});
