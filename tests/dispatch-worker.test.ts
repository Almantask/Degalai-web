import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchWorkflow, type DispatchEnv } from "../worker/src/dispatch.ts";

const env: DispatchEnv = {
  GITHUB_TOKEN: "tok",
  GITHUB_REPO: "Almantask/Degalai-web",
  GITHUB_WORKFLOW: "daily.yml",
  GITHUB_REF: "main",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchWorkflow", () => {
  it("posts the workflow dispatch and logs it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatchWorkflow(env, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/Almantask/Degalai-web/actions/workflows/daily.yml/dispatches",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
          "User-Agent": "kur-degalai-cron",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );
    expect(log).toHaveBeenCalledWith("Dispatched daily.yml on Almantask/Degalai-web@main");
  });

  it("throws the status and body when GitHub refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(dispatchWorkflow(env, fetchImpl)).rejects.toThrow(
      "workflow_dispatch failed: 403 nope",
    );
  });
});
