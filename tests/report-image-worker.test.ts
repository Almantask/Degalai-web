import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_TTL_SECONDS,
  MAX_IMAGE_BYTES,
  parseImage,
  serveImage,
  sniffImageType,
  storeImage,
  type ImageMetadata,
  type ImageStore,
} from "../worker/src/report-image.ts";
import { handleReport, type ReportEnv } from "../worker/src/report.ts";

const ORIGIN = "https://almantask.github.io";
const WORKER = "https://kur-degalai-cron.example.workers.dev";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")]);
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function dataUrl(type: string, bytes: Uint8Array): string {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** An in-memory stand-in for the KV namespace. */
function memoryStore(failPut = false) {
  const items = new Map<string, { value: Uint8Array; metadata?: ImageMetadata; ttl?: number }>();
  const store: ImageStore = {
    async put(key, value, options) {
      if (failPut) throw new Error("KV write limit");
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      items.set(key, { value: bytes, metadata: options?.metadata, ttl: options?.expirationTtl });
    },
    async getWithMetadata(key) {
      const item = items.get(key);
      if (!item) return { value: null, metadata: null };
      const value = item.value.buffer.slice(
        item.value.byteOffset,
        item.value.byteOffset + item.value.byteLength,
      ) as ArrayBuffer;
      return { value, metadata: item.metadata ?? null };
    },
  };
  return { store, items };
}

describe("parseImage", () => {
  it("accepts PNG, JPEG and WebP whose bytes match the label", () => {
    expect(parseImage(dataUrl("image/png", PNG))?.type).toBe("image/png");
    expect(parseImage(dataUrl("image/jpeg", JPEG))?.type).toBe("image/jpeg");
    expect(parseImage(dataUrl("image/webp", WEBP))?.bytes).toEqual(WEBP);
  });

  it("refuses SVG, mislabelled bytes, junk and oversized pictures", () => {
    expect(parseImage(dataUrl("image/svg+xml", SVG))).toBeNull();
    expect(parseImage(dataUrl("image/png", SVG))).toBeNull();
    expect(parseImage(dataUrl("image/png", JPEG))).toBeNull();
    expect(parseImage("data:image/png;base64,***")).toBeNull();
    expect(parseImage("https://example.com/cat.png")).toBeNull();
    expect(parseImage(42)).toBeNull();
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    expect(parseImage(dataUrl("image/jpeg", big))).toBeNull();
  });

  it("knows the formats by their first bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(SVG)).toBeNull();
  });
});

describe("storeImage and serveImage", () => {
  it("stores for a year and serves the bytes with locked-down headers", async () => {
    const { store, items } = memoryStore();
    const url = await storeImage(store, { bytes: WEBP, type: "image/webp" }, WORKER);
    expect(url).toMatch(
      /^https:\/\/kur-degalai-cron\.example\.workers\.dev\/report\/image\/[0-9a-f-]{36}\.webp$/,
    );
    expect([...items.values()][0].ttl).toBe(IMAGE_TTL_SECONDS);

    const res = (await serveImage(new Request(url!), store))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
  });

  it("returns 404 for unknown ids or the wrong extension, and null for other paths", async () => {
    const { store } = memoryStore();
    const url = (await storeImage(store, { bytes: PNG, type: "image/png" }, WORKER))!;
    expect((await serveImage(new Request(url.replace(/\.png$/, ".jpg")), store))!.status).toBe(404);
    const unknown = `${WORKER}/report/image/00000000-0000-4000-8000-000000000000.png`;
    expect((await serveImage(new Request(unknown), store))!.status).toBe(404);
    expect(await serveImage(new Request(`${WORKER}/report/image/../secret`), store)).toBeNull();
    expect(await serveImage(new Request(`${WORKER}/`), store)).toBeNull();
  });

  it("gives no URL when KV fails or is not bound", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await storeImage(memoryStore(true).store, { bytes: PNG, type: "image/png" }, WORKER),
    ).toBeNull();
    expect(await storeImage(undefined, { bytes: PNG, type: "image/png" }, WORKER)).toBeNull();
    error.mockRestore();
  });
});

describe("handleReport with a picture", () => {
  const form = {
    category: "bug",
    description: "The list shows the wrong price for this station",
    email: "vardas@pastas.lt",
    website: "",
  };

  function post(body: unknown): Request {
    return new Request(`${WORKER}/report`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function env(images?: ImageStore): ReportEnv {
    return {
      GITHUB_TOKEN: "t",
      GITHUB_REPO: "Almantask/Degalai-web",
      REPORT_ORIGINS: ORIGIN,
      REPORT_IMAGES: images,
    };
  }

  function github() {
    return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        { number: 9, html_url: "https://github.com/Almantask/Degalai-web/issues/9" },
        { status: 201 },
      ),
    );
  }

  const issueBody = (fetchImpl: ReturnType<typeof github>) =>
    (JSON.parse(fetchImpl.mock.calls[0][1]!.body as string) as { body: string }).body;

  it("stores the picture and shows it in the issue", async () => {
    const { store, items } = memoryStore();
    const fetchImpl = github();
    const res = await handleReport(
      post({ ...form, image: dataUrl("image/png", PNG) }),
      env(store),
      fetchImpl,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, number: 9, imageSaved: true });
    expect(items.size).toBe(1);
    const [id] = items.keys();
    expect(issueBody(fetchImpl)).toContain(
      `### Picture\n\n![Picture from the reporter](${WORKER}/report/image/${id}.png)`,
    );
  });

  it("still files the report, saying so, when the picture cannot be stored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = github();
    const res = await handleReport(
      post({ ...form, image: dataUrl("image/jpeg", JPEG) }),
      env(memoryStore(true).store),
      fetchImpl,
    );
    expect(await res.json()).toMatchObject({ ok: true, imageSaved: false });
    expect(issueBody(fetchImpl)).toContain("_A picture was attached but could not be stored._");
    error.mockRestore();
  });

  it("refuses a bad picture before storing anything or calling GitHub", async () => {
    const { store, items } = memoryStore();
    const fetchImpl = github();
    const res = await handleReport(
      post({ ...form, image: dataUrl("image/png", SVG) }),
      env(store),
      fetchImpl,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "image" });
    expect(items.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leaves the picture section and imageSaved out when there is no picture", async () => {
    const fetchImpl = github();
    const res = await handleReport(
      post({ ...form, image: "" }),
      env(memoryStore().store),
      fetchImpl,
    );
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.imageSaved).toBeUndefined();
    expect(issueBody(fetchImpl)).not.toContain("### Picture");
  });
});
