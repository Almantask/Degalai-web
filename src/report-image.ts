/** A picture for feedback: shrunk and re-encoded in the browser before it is sent. */

/** The worker refuses bigger pictures (worker/src/report-image.ts). */
export const MAX_IMAGE_BYTES = 1_500_000;
/** Longest side first tried, then the smaller fallback if the file is still too big. */
const ATTEMPTS = [
  { side: 1600, quality: 0.85 },
  { side: 1200, quality: 0.7 },
] as const;

/** Width and height scaled down (never up) so the longer side is at most `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Redraws the picture as WebP (JPEG where the browser cannot encode WebP). Redrawing also drops
 * EXIF data such as a phone photo's GPS position. Throws if it cannot be read or stays too big.
 */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const { side, quality } of ATTEMPTS) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D canvas");
      // JPEG has no transparency: white reads better than black behind a transparent screenshot.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await encode(canvas, quality);
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    throw new Error("Picture too large");
  } finally {
    bitmap.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the picture"));
    reader.readAsDataURL(blob);
  });
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  // Browsers that cannot write WebP hand back a PNG instead.
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("Could not encode the picture");
  return jpeg;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
