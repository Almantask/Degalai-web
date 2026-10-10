import { beforeEach, describe, expect, it, vi } from "vitest";

const { dispatchWorkflow, handleReport, serveCoverageBadge, serveImage } = vi.hoisted(() => ({
  dispatchWorkflow: vi.fn(),
  handleReport: vi.fn(),
  serveCoverageBadge: vi.fn(),
  serveImage: vi.fn(),
}));

vi.mock("../worker/src/dispatch.ts", () => ({ dispatchWorkflow }));
vi.mock("../worker/src/report.ts", () => ({ handleReport }));
vi.mock("../worker/src/coverage.ts", () => ({ serveCoverageBadge }));
vi.mock("../worker/src/report-image.ts", () => ({ serveImage }));

import worker from "../worker/src/index.ts";

const env = {
  GITHUB_TOKEN: "t",
  GITHUB_REPO: "Almantask/Degalai-web",
  GITHUB_WORKFLOW: "daily.yml",
  GITHUB_REF: "main",
  REPORT_ORIGINS: "https://almantask.github.io",
  REPORT_IMAGES: {
    async put() {},
    async getWithMetadata() {
      return { value: null, metadata: null };
    },
  },
};

beforeEach(() => {
  dispatchWorkflow.mockReset();
  handleReport.mockReset();
  serveCoverageBadge.mockReset();
  serveImage.mockReset();
});

describe("scheduled", () => {
  it("dispatches the data workflow", async () => {
    dispatchWorkflow.mockResolvedValue(undefined);
    await worker.scheduled(undefined, env);
    expect(dispatchWorkflow).toHaveBeenCalledOnce();
    expect(dispatchWorkflow).toHaveBeenCalledWith(env);
  });
});

describe("fetch", () => {
  it("sends /report to the feedback handler", async () => {
    const report = new Response("filed", { status: 201 });
    handleReport.mockResolvedValue(report);
    const request = new Request("https://w.dev/report?x=1");
    const res = await worker.fetch(request, env);
    expect(res).toBe(report);
    expect(handleReport).toHaveBeenCalledWith(request, env);
    expect(serveCoverageBadge).not.toHaveBeenCalled();
    expect(serveImage).not.toHaveBeenCalled();
  });

  it("returns a coverage badge when that path matches", async () => {
    const badge = new Response("badge");
    serveCoverageBadge.mockResolvedValue(badge);
    const request = new Request("https://w.dev/coverage/unit.json");
    const res = await worker.fetch(request, env);
    expect(res).toBe(badge);
    expect(serveCoverageBadge).toHaveBeenCalledWith(request);
    expect(serveImage).not.toHaveBeenCalled();
  });

  it("returns an image when the badge handler declines", async () => {
    serveCoverageBadge.mockResolvedValue(null);
    const image = new Response("img");
    serveImage.mockResolvedValue(image);
    const request = new Request("https://w.dev/report/image/id.png");
    const res = await worker.fetch(request, env);
    expect(res).toBe(image);
    expect(serveImage).toHaveBeenCalledWith(request, env.REPORT_IMAGES);
  });

  it("returns 404 when nothing handles the path", async () => {
    serveCoverageBadge.mockResolvedValue(null);
    serveImage.mockResolvedValue(null);
    const res = await worker.fetch(new Request("https://w.dev/nope"), env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
