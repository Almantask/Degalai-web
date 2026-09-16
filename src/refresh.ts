/** Must match `cacheName` values in vite.config.ts workbox runtimeCaching. */
export const DATA_CACHE_NAMES = ["kur-degalai-history", "kur-degalai-data"] as const;

/** Don’t wait forever for Cache Storage / service worker update before reloading. */
export const REFRESH_PREP_MS = 1500;

export type RefreshWebsiteDeps = {
  deleteCache?: (name: string) => Promise<unknown>;
  updateWorkers?: () => Promise<unknown>;
  reload: () => void;
  nowaitMs?: number;
};

/** Drop stale PWA data, look for a new service worker, then reload the page. */
export async function refreshWebsite(deps: RefreshWebsiteDeps): Promise<void> {
  await withTimeout(prepareRefresh(deps), deps.nowaitMs ?? REFRESH_PREP_MS);
  deps.reload();
}

async function prepareRefresh(deps: RefreshWebsiteDeps): Promise<void> {
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
}

function withTimeout(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    task.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
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
