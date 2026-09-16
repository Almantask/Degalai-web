/** Must match `cacheName` values in vite.config.ts workbox runtimeCaching. */
export const DATA_CACHE_NAMES = ["kur-degalai-history", "kur-degalai-data"] as const;

export type RefreshWebsiteDeps = {
  deleteCache?: (name: string) => Promise<unknown>;
  updateWorkers?: () => Promise<unknown>;
  reload: () => void;
};

/** Drop stale PWA data, look for a new service worker, then reload the page. */
export async function refreshWebsite(deps: RefreshWebsiteDeps): Promise<void> {
  try {
    if (deps.deleteCache) {
      await Promise.all(DATA_CACHE_NAMES.map((name) => deps.deleteCache!(name)));
    }
  } catch {
    /* private mode or missing Cache Storage */
  }
  try {
    await deps.updateWorkers?.();
  } catch {
    /* no service worker */
  }
  deps.reload();
}

export function browserRefreshDeps(
  win: Pick<Window, "caches" | "navigator" | "location"> = window,
): RefreshWebsiteDeps {
  return {
    deleteCache: async (name) => {
      await win.caches?.delete(name);
    },
    updateWorkers: async () => {
      const sw = win.navigator.serviceWorker;
      if (!sw) return;
      const regs = await sw.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    },
    reload: () => win.location.reload(),
  };
}
