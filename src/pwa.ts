const DISMISS_KEY = "kur-degalai-install-hint";

export type InstallOffer = "hidden" | "prompt" | "ios";

export function isStandalone(
  media: (query: string) => boolean,
  navigatorStandalone?: boolean,
): boolean {
  return (
    media("(display-mode: standalone)") ||
    media("(display-mode: fullscreen)") ||
    media("(display-mode: minimal-ui)") ||
    navigatorStandalone === true
  );
}

export function isIosSafari(
  ua: string,
  device?: { platform?: string; maxTouchPoints?: number },
): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (device?.platform === "MacIntel" && (device.maxTouchPoints ?? 0) > 1);
  if (!ios) return false;
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return safari;
}

export function installOffer(opts: {
  standalone: boolean;
  dismissed: boolean;
  canPrompt: boolean;
  iosSafari: boolean;
}): InstallOffer {
  if (opts.standalone || opts.dismissed) return "hidden";
  if (opts.canPrompt) return "prompt";
  if (opts.iosSafari) return "ios";
  return "hidden";
}

export function loadInstallDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistInstallDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode */
  }
}
