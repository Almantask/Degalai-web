/** Pictures attached to feedback: kept in Workers KV and served at /report/image/<id>.<ext>. */

/** The parts of a Workers KV namespace binding used here. */
export interface ImageStore {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { expirationTtl?: number; metadata?: ImageMetadata },
  ): Promise<void>;
  getWithMetadata(
    key: string,
    type: "arrayBuffer",
  ): Promise<{ value: ArrayBuffer | null; metadata: ImageMetadata | null }>;
}

export interface ImageMetadata {
  type: ImageType;
}

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export interface ReportImage {
  bytes: Uint8Array;
  type: ImageType;
}

/** The site shrinks pictures well below this before sending. */
export const MAX_IMAGE_BYTES = 1_500_000;
/** Pictures go after a year; the issues they belong to are long settled by then. */
export const IMAGE_TTL_SECONDS = 365 * 24 * 60 * 60;

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const IMAGE_PATH = /^\/report\/image\/([0-9a-f-]{36})\.(png|jpg|webp)$/;

/**
 * A PNG, JPEG or WebP data URL whose bytes really are that format, or `null`. SVG and anything
 * else is refused: the worker serves these from its own origin.
 */
export function parseImage(value: unknown): ReportImage | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  const type = sniffImageType(bytes);
  return type && type === match[1] ? { bytes, type } : null;
}

/** The format from the file's first bytes, whatever its name or label says. */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Stores the picture and returns its public URL on this worker, or `null` if KV failed. */
export async function storeImage(
  store: ImageStore | undefined,
  image: ReportImage,
  workerOrigin: string,
): Promise<string | null> {
  if (!store) return null;
  const id = crypto.randomUUID();
  try {
    await store.put(id, image.bytes, {
      expirationTtl: IMAGE_TTL_SECONDS,
      metadata: { type: image.type },
    });
  } catch (err) {
    console.error(`Storing the picture failed: ${String(err)}`);
    return null;
  }
  return `${workerOrigin}/report/image/${id}.${EXTENSIONS[image.type]}`;
}

/** GET /report/image/<id>.<ext>, or `null` when the path is not an image path. */
export async function serveImage(
  request: Request,
  store: ImageStore | undefined,
): Promise<Response | null> {
  const match = IMAGE_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const found = store ? await store.getWithMetadata(match[1], "arrayBuffer") : null;
  const type = found?.metadata?.type;
  if (!found?.value || !type || EXTENSIONS[type] !== match[2]) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(request.method === "HEAD" ? null : found.value, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // A visitor's upload, so it may never run anything, even if opened directly.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
