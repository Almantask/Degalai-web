import { describe, expect, it, vi } from "vitest";
import { DATA_CACHE_NAMES, refreshWebsite } from "../src/refresh.ts";

describe("refreshWebsite", () => {
  it("clears price caches, updates the service worker, then reloads", async () => {
    const deleted: string[] = [];
    const updateWorkers = vi.fn(async () => undefined);
    const reload = vi.fn();
    await refreshWebsite({
      deleteCache: async (name) => {
        deleted.push(name);
      },
      updateWorkers,
      reload,
    });
    expect(deleted.sort()).toEqual([...DATA_CACHE_NAMES].sort());
    expect(updateWorkers).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("still reloads if cache or worker updates fail", async () => {
    const reload = vi.fn();
    await refreshWebsite({
      deleteCache: async () => {
        throw new Error("no caches");
      },
      updateWorkers: async () => {
        throw new Error("no sw");
      },
      reload,
    });
    expect(reload).toHaveBeenCalledOnce();
  });
});
