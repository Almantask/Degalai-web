import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCliEntry, runCli } from "../scripts/cli.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCliEntry", () => {
  it("is false when node was not given a script", () => {
    expect(isCliEntry("file:///app/scripts/pipeline.ts", undefined)).toBe(false);
  });

  it("is false when the script is a different file", () => {
    expect(isCliEntry("file:///app/scripts/pipeline.ts", "/app/scripts/other.ts")).toBe(false);
  });

  it("is true when the module url is the script node is running", () => {
    const script = "/tmp/pipeline.ts";
    expect(isCliEntry(pathToFileURL(script).href, script)).toBe(true);
  });
});

describe("runCli", () => {
  it("does nothing when the module was imported", () => {
    const task = vi.fn();
    runCli(false, task);
    expect(task).not.toHaveBeenCalled();
  });

  it("runs the task when the module is the program", async () => {
    const task = vi.fn(() => "ok");
    runCli(true, task);
    expect(task).toHaveBeenCalledOnce();
  });

  it("logs the rejection and exits 1", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const boom = new Error("boom");
    runCli(true, () => Promise.reject(boom));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(error).toHaveBeenCalledWith(boom);
  });
});
