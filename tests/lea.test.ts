import { describe, expect, it, vi } from "vitest";
import {
  fetchLeaRange,
  fetchLeaWorkbook,
  findLeaExcelUrl,
  leaAdapter,
  leaObservedAt,
  leaPowerBiAvailable,
  leaRowsForDate,
  leaSourceId,
  parseLeaWorkbook,
} from "../scripts/adapters/lea.ts";

const DATA_PAGE = "https://www.ena.lt/dk-pr-pr-duomenys/";
const SHARE = "https://ltenergagen.sharepoint.com/:x:/s/team/prices.aspx?e=1&amp;wid=2";

type SheetRow = {
  number: number;
  values?: unknown[];
  getCell: (col: number) => { value: unknown };
};

const excel = vi.hoisted(() => ({
  workbooks: [] as SheetRow[][][],
}));

vi.mock("exceljs", () => ({
  default: {
    stream: {
      xlsx: {
        WorkbookReader: class {
          sheets: SheetRow[][];
          constructor() {
            this.sheets = excel.workbooks.shift() ?? [];
          }
          async *[Symbol.asyncIterator]() {
            for (const rows of this.sheets) {
              yield {
                async *[Symbol.asyncIterator]() {
                  for (const row of rows) yield row;
                },
              };
            }
          }
        },
      },
    },
  },
}));

function xlRow(number: number, values?: unknown[]): SheetRow {
  return {
    number,
    values,
    getCell(col: number) {
      return { value: values?.[col] };
    },
  };
}

const header = xlRow(4, [
  undefined,
  "Įmonė",
  "Savivaldybė",
  "Adresas",
  "Degalų tipas",
  "Kaina",
  "Duomenų data",
  "Pastaba",
]);

function priced(opts: {
  number?: number;
  company?: unknown;
  muni?: unknown;
  addr?: unknown;
  fuel?: unknown;
  price?: unknown;
  date?: unknown;
}): SheetRow {
  return xlRow(opts.number ?? 5, [
    undefined,
    opts.company === undefined ? "UAB Circle K" : opts.company,
    opts.muni === undefined ? "Vilniaus m. sav." : opts.muni,
    opts.addr === undefined ? "Gedimino pr. 1" : opts.addr,
    opts.fuel === undefined ? "95 benzinas" : opts.fuel,
    opts.price === undefined ? 1.879 : opts.price,
    opts.date === undefined ? "2026-09-16" : opts.date,
  ]);
}

function queueWorkbook(rows: SheetRow[], extra: SheetRow[][] = []): void {
  excel.workbooks.push([rows, ...extra]);
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", impl);
  try {
    return await run();
  } finally {
    log.mockRestore();
    vi.unstubAllGlobals();
  }
}

function pageThen(download: (url: string, init?: RequestInit) => unknown): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url.startsWith(DATA_PAGE)) return new Response(`<a href="${SHARE}">file</a>`);
    return download(url, init) as Response;
  }) as typeof fetch;
}

describe("leaObservedAt", () => {
  it("stamps working-day snapshots at 10:00 Vilnius time", () => {
    expect(leaObservedAt("2026-09-16")).toBe("2026-09-16T10:00:00+03:00");
    expect(leaObservedAt("2026-01-15")).toBe("2026-01-15T10:00:00+02:00");
  });
});

describe("leaSourceId", () => {
  it("sorts tokens and drops characters that are not part of a word", () => {
    expect(leaSourceId("UAB B", "Vilnius", "Gedimino 1")).toBe("lea:1-b-gedimino-uab-vilnius");
    expect(leaSourceId("A\u00a0B", "C", "D")).toBe("lea:a-b-c-d");
    expect(leaSourceId("!!!", "@@@", "###")).toBe("lea:");
  });
});

describe("findLeaExcelUrl", () => {
  it("builds a download link from the SharePoint href on the data page", async () => {
    const url = await withFetch(
      async () => new Response(`<a href="${SHARE}">file</a>`),
      () => findLeaExcelUrl(),
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("download")).toBe("1");
    expect(parsed.searchParams.get("e")).toBe("1");
    expect(parsed.searchParams.get("wid")).toBe("2");
  });

  it("fails when the data page has no workbook link", async () => {
    await expect(
      withFetch(
        async () => new Response("<p>none</p>"),
        () => findLeaExcelUrl(),
      ),
    ).rejects.toThrow(/No SharePoint Excel link/);
  });
});

describe("parseLeaWorkbook", () => {
  it("reads prices, reuses a station's id, and skips rows that are not a price", async () => {
    const serial = 45000;
    const serialDay = new Date(Math.round((serial - 25569) * 86400 * 1000))
      .toISOString()
      .slice(0, 10);
    queueWorkbook([
      xlRow(1, [
        null,
        new Date("2026-01-01T00:00:00Z"),
        { text: "note" },
        { result: { text: "nested" } },
        { result: "x" },
        { foo: 1 },
        "hello",
        7,
      ]),
      xlRow(2),
      xlRow(3, [undefined, "Adresas"]),
      header,
      priced({ company: "UAB Circle K", fuel: "95 benzinas", price: 1.879, date: "2026-09-16" }),
      priced({
        company: "UAB Circle K",
        fuel: "Dyzelinas",
        price: "1,999",
        date: new Date("2026-09-16T00:00:00Z"),
      }),
      priced({
        company: "Orlen",
        addr: "Kauno g. 1",
        fuel: "98",
        price: 1.9,
        date: serial,
      }),
      priced({
        company: "Viada",
        addr: "Taikos pr. 1",
        fuel: "SND",
        price: 0.899,
        date: "note 2026-09-15 extra",
      }),
      priced({
        company: "A\u00a0B",
        addr: "D",
        muni: "C",
        fuel: "diesel",
        price: 1.5,
        date: "45100",
      }),
      priced({ fuel: "AdBlue", price: 0.9 }),
      priced({ price: null }),
      priced({ price: "-" }),
      priced({ company: "", price: 1.2 }),
      priced({ addr: "", price: 1.2 }),
      priced({ date: 12 }),
      priced({ date: "n/a" }),
      priced({ date: 40000 }),
      priced({ date: 60000 }),
      priced({ price: { result: "1.5" } }),
    ]);
    const byDate = await parseLeaWorkbook(Buffer.from("workbook"));
    expect(byDate.get("2026-09-16")?.map((row) => row.fuel)).toEqual(["95", "D"]);
    expect(byDate.get("2026-09-16")?.[0].sourceStationId).toBe(
      byDate.get("2026-09-16")?.[1].sourceStationId,
    );
    expect(byDate.get(serialDay)?.[0]).toMatchObject({ fuel: "98", price: 1.9, brand: "orlen" });
    expect(byDate.get("2026-09-15")?.[0]).toMatchObject({ fuel: "LPG", price: 0.899 });
    expect([...byDate.keys()]).toContain(
      new Date(Math.round((45100 - 25569) * 86400 * 1000)).toISOString().slice(0, 10),
    );
  });

  it("fails when the workbook has no sheet", async () => {
    excel.workbooks.push([]);
    await expect(parseLeaWorkbook(Buffer.from("x"))).rejects.toThrow(/no sheets/);
  });

  it("fails when no row looks like the LEA header", async () => {
    queueWorkbook([xlRow(1, ["not", "a", "header"])]);
    await expect(parseLeaWorkbook(Buffer.from("x"))).rejects.toThrow(/header row/);
  });

  it("fails when the sheet has a header but no prices", async () => {
    queueWorkbook([header, priced({ date: "n/a" })]);
    await expect(parseLeaWorkbook(Buffer.from("x"))).rejects.toThrow(/0 rows/);
  });

  it("rejects a date cell that is not a real date", async () => {
    queueWorkbook([header, priced({ date: new Date(Number.NaN) })]);
    await expect(parseLeaWorkbook(Buffer.from("x"))).rejects.toThrow(RangeError);
  });
});

describe("fetchLeaWorkbook", () => {
  it("follows redirects, keeps cookies, and parses the file", async () => {
    queueWorkbook([header, priced({})]);
    const cookies: string[] = [];
    const byDate = await withFetch(
      pageThen((_url, init) => {
        cookies.push(new Headers(init?.headers).get("cookie") ?? "");
        if (cookies.length === 1) {
          const headers = new Headers({ location: "https://files.example/lea.xlsx" });
          headers.append("set-cookie", "a=b; Path=/");
          headers.append("set-cookie", "; Path=/");
          return new Response(null, { status: 302, headers });
        }
        return new Response(Buffer.from("PK workbook"));
      }),
      () => fetchLeaWorkbook(),
    );
    expect(cookies).toEqual(["", "a=b"]);
    expect(byDate.get("2026-09-16")).toHaveLength(1);
  });

  it("downloads a file whose response cannot list cookies", async () => {
    queueWorkbook([header, priced({})]);
    const byDate = await withFetch(
      pageThen(
        () =>
          ({
            status: 200,
            ok: true,
            headers: { get: () => "application/octet-stream" },
            arrayBuffer: async () => new TextEncoder().encode("PK").buffer,
          }) as unknown as Response,
      ),
      () => fetchLeaWorkbook(),
    );
    expect(byDate.get("2026-09-16")).toHaveLength(1);
  });

  it("rejects an HTML content type from SharePoint", async () => {
    await expect(
      withFetch(
        pageThen(
          () =>
            new Response("<html>login</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ),
        () => fetchLeaWorkbook(),
      ),
    ).rejects.toThrow(/HTML instead of Excel/);
  });

  it("rejects an HTML body even when the content type looks like a file", async () => {
    await expect(
      withFetch(
        pageThen(
          () =>
            new Response("<html>login</html>", {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            }),
        ),
        () => fetchLeaWorkbook(),
      ),
    ).rejects.toThrow(/HTML instead of Excel/);
  });

  it("rejects a failed download", async () => {
    await expect(
      withFetch(
        pageThen(() => new Response("no", { status: 503 })),
        () => fetchLeaWorkbook(),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("rejects a redirect that has no location", async () => {
    await expect(
      withFetch(
        pageThen(() => new Response(null, { status: 302 })),
        () => fetchLeaWorkbook(),
      ),
    ).rejects.toThrow(/Redirect without location/);
  });

  it("rejects a download that redirects more than eight times", async () => {
    let hops = 0;
    await expect(
      withFetch(
        pageThen(() => {
          hops += 1;
          return new Response(null, {
            status: 302,
            headers: { location: `https://files.example/hop-${hops}` },
          });
        }),
        () => fetchLeaWorkbook(),
      ),
    ).rejects.toThrow(/Too many redirects/);
    expect(hops).toBe(8);
  });
});

describe("fetchLeaRange", () => {
  it("keeps days inside the half-open range", async () => {
    queueWorkbook([
      header,
      priced({ date: "2026-09-15" }),
      priced({ date: "2026-09-16", fuel: "98" }),
      priced({ date: "2026-09-17", fuel: "Dyzelinas" }),
    ]);
    const out = await withFetch(
      pageThen(() => new Response(Buffer.from("PK"))),
      () => fetchLeaRange("2026-09-16", "2026-09-17"),
    );
    expect([...out.keys()]).toEqual(["2026-09-16"]);
  });
});

describe("leaRowsForDate", () => {
  it("returns no rows when the workbook has no days", () => {
    expect(leaRowsForDate(new Map(), "2026-09-16")).toEqual([]);
  });
});

describe("leaAdapter", () => {
  it("returns the requested day from the workbook", async () => {
    queueWorkbook([
      header,
      priced({ date: "2026-09-16" }),
      priced({ date: "2026-09-17", fuel: "98" }),
    ]);
    const rows = await withFetch(
      pageThen(() => new Response(Buffer.from("PK"))),
      () => leaAdapter("2026-09-16").fetch(),
    );
    expect(rows.map((row) => row.fuel)).toEqual(["95"]);
  });

  it("falls back to the latest workbook day", async () => {
    queueWorkbook([header, priced({ date: "2026-09-16" })]);
    const rows = await withFetch(
      pageThen(() => new Response(Buffer.from("PK"))),
      () => leaAdapter("2026-09-20").fetch(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].observedAt).toContain("2026-09-16");
  });
});

describe("leaPowerBiAvailable", () => {
  it("detects a Power BI embed on the map page", async () => {
    await expect(
      withFetch(
        async () => new Response(`<iframe src="https://app.powerbi.com/view?r=abc">`),
        () => leaPowerBiAvailable(),
      ),
    ).resolves.toBe(true);
    await expect(
      withFetch(
        async () => new Response("<p>no embed</p>"),
        () => leaPowerBiAvailable(),
      ),
    ).resolves.toBe(false);
  });
});
