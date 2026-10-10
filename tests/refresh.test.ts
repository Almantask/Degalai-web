import { describe, expect, it, vi } from "vitest";
import { browserRefreshDeps, DATA_CACHE_NAMES, refreshWebsite } from "../src/refresh.ts";

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

  it("reloads after a timeout if cache work never finishes", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const done = refreshWebsite({
      deleteCache: () => new Promise(() => undefined),
      reload,
      nowaitMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(reload).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe("browserRefreshDeps", () => {
  it("deletes caches, updates workers when present, and reloads", async () => {
    const reload = vi.fn();
    const updated: string[] = [];
    const deleted: string[] = [];
    const withWorker = browserRefreshDeps({
      caches: {
        delete: async (name: string) => {
          deleted.push(name);
          return true;
        },
      },
      navigator: {
        serviceWorker: {
          getRegistrations: async () => [
            {
              update: async () => {
                updated.push("sw");
              },
            },
          ],
        },
      },
      location: { reload },
    } as unknown as Window);
    await withWorker.deleteCache!("kur-degalai-data");
    await withWorker.updateWorkers!();
    withWorker.reload();
    expect(deleted).toEqual(["kur-degalai-data"]);
    expect(updated).toEqual(["sw"]);
    expect(reload).toHaveBeenCalledOnce();

    const bareReload = vi.fn();
    const bare = browserRefreshDeps({
      navigator: {},
      location: { reload: bareReload },
    } as unknown as Window);
    await bare.deleteCache!("kur-degalai-history");
    await bare.updateWorkers!();
    bare.reload();
    expect(bareReload).toHaveBeenCalledOnce();

    const defaultReload = vi.fn();
    vi.stubGlobal("window", {
      caches: { delete: async () => false },
      navigator: {},
      location: { reload: defaultReload },
    });
    const fromWindow = browserRefreshDeps();
    await fromWindow.updateWorkers!();
    fromWindow.reload();
    expect(defaultReload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
