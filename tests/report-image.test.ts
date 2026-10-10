// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, blobToDataUrl, shrinkImage } from "../src/report-image.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ctx2d(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function bitmap(width = 2000, height = 1000) {
  return { width, height, close: vi.fn() };
}

function stubBitmap(image = bitmap()) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => image),
  );
  return image;
}

function stubEncode(
  blobFor: (type: string) => Blob | null,
  context: CanvasRenderingContext2D | null,
) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  HTMLCanvasElement.prototype.toBlob = (callback, type) => {
    callback(blobFor(String(type)));
  };
}

describe("shrinkImage", () => {
  it("returns a webp the browser can encode", async () => {
    const image = stubBitmap();
    const webp = new Blob(["webp"], { type: "image/webp" });
    stubEncode((type) => (type === "image/webp" ? webp : null), ctx2d());
    await expect(shrinkImage(new Blob(["pic"]))).resolves.toBe(webp);
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("falls back to jpeg when webp is not produced", async () => {
    const image = stubBitmap();
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    stubEncode(
      (type) => (type === "image/jpeg" ? jpeg : new Blob(["png"], { type: "image/png" })),
      ctx2d(),
    );
    await expect(shrinkImage(new Blob(["pic"]))).resolves.toBe(jpeg);
    image.close.mockClear();
    stubEncode((type) => (type === "image/jpeg" ? jpeg : null), ctx2d());
    await expect(shrinkImage(new Blob(["pic"]))).resolves.toBe(jpeg);
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("throws when the canvas has no 2d context", async () => {
    const image = stubBitmap();
    stubEncode(() => null, null);
    await expect(shrinkImage(new Blob(["pic"]))).rejects.toThrow("No 2D canvas");
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("throws when the picture stays too large", async () => {
    const image = stubBitmap();
    const big = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/webp" });
    stubEncode(() => big, ctx2d());
    await expect(shrinkImage(new Blob(["pic"]))).rejects.toThrow("Picture too large");
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("throws when the picture cannot be encoded", async () => {
    const image = stubBitmap();
    stubEncode(() => null, ctx2d());
    await expect(shrinkImage(new Blob(["pic"]))).rejects.toThrow("Could not encode the picture");
    expect(image.close).toHaveBeenCalledOnce();
  });
});

describe("blobToDataUrl", () => {
  it("reads the blob as a data url", async () => {
    const url = await blobToDataUrl(new Blob(["hi"], { type: "text/plain" }));
    expect(url.startsWith("data:")).toBe(true);
  });

  it("rejects when the reader fails", async () => {
    class BrokenReader {
      result: string | null = null;
      error: Error | null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(error: Error | null) {
        this.error = error;
      }
      readAsDataURL() {
        this.onerror?.();
      }
    }
    vi.stubGlobal(
      "FileReader",
      class extends BrokenReader {
        constructor() {
          super(new Error("unreadable"));
        }
      },
    );
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toThrow("unreadable");
    vi.stubGlobal(
      "FileReader",
      class extends BrokenReader {
        constructor() {
          super(null);
        }
      },
    );
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toThrow("Could not read the picture");
  });
});
