/**
 * Shields.io endpoint badges. Shields refuses to fetch `github.com` (the error image
 * says "domain is blocked"), so the README points at this worker. The worker reads the
 * public `coverage-badges` release assets and returns them. Those assets are replaced
 * without a commit.
 */

const BADGES: Record<string, { url: string; label: string }> = {
  "/coverage/unit.json": {
    url: "https://github.com/Almantask/Degalai-web/releases/download/coverage-badges/unit.json",
    label: "unit coverage",
  },
  "/coverage/e2e.json": {
    url: "https://github.com/Almantask/Degalai-web/releases/download/coverage-badges/e2e.json",
    label: "e2e coverage",
  },
};

/** A release asset larger than this is not a badge. */
const MAX_BADGE_CHARS = 8192;

interface ShieldsBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds: number;
}

function unknownBadge(label: string): ShieldsBadge {
  return { schemaVersion: 1, label, message: "unknown", color: "lightgrey", cacheSeconds: 300 };
}

function isShortText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function cacheSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86_400) {
    return 300;
  }
  return Math.round(value);
}

/** Shields endpoint JSON: schema 1, a short label and message, and a plain colour name. */
function shieldsBadge(value: unknown, label: string): ShieldsBadge {
  if (!value || typeof value !== "object") return unknownBadge(label);
  const badge = value as Record<string, unknown>;
  if (
    badge.schemaVersion !== 1 ||
    !isShortText(badge.label) ||
    !isShortText(badge.message) ||
    typeof badge.color !== "string" ||
    !/^[a-z0-9]{1,20}$/.test(badge.color)
  ) {
    return unknownBadge(label);
  }
  return {
    schemaVersion: 1,
    label: badge.label,
    message: badge.message,
    color: badge.color,
    cacheSeconds: cacheSeconds(badge.cacheSeconds),
  };
}

function json(body: ShieldsBadge): Response {
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * GET `/coverage/unit.json` and `/coverage/e2e.json`, or `null` for every other path.
 * A missing asset, or a body that is not a Shields badge, is a grey "unknown" badge
 * so the README does not show an error image before the first publish.
 */
export async function serveCoverageBadge(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const badge = BADGES[new URL(request.url).pathname];
  if (!badge) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }
  try {
    const upstream = await fetchImpl(badge.url, {
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": "kur-degalai-cron" },
    });
    if (!upstream.ok) return json(unknownBadge(badge.label));
    const text = await upstream.text();
    if (text.length > MAX_BADGE_CHARS) return json(unknownBadge(badge.label));
    return json(shieldsBadge(JSON.parse(text), badge.label));
  } catch (error) {
    console.error(`coverage badge: ${String(error)}`);
    return json(unknownBadge(badge.label));
  }
}
