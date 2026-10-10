/** Stand-in for Vite's `virtual:pwa-register`. Forwards to the test's spy. */
export function registerSW(options?: { immediate?: boolean }): void {
  const hook = (globalThis as { __registerSW?: (options?: { immediate?: boolean }) => void })
    .__registerSW;
  hook?.(options);
}
