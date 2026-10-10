import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPriceReports,
  reportStillFresh,
  reportsToObservations,
} from "../scripts/adapters/reports.ts";
import type { PriceReport, Station } from "../src/types.ts";

const station: Station = {
  id: "osm:way:138809868",
  name: "Circle K Karaliaus Mindaugo pr.",
  brand: "circle-k",
  lat: 54.8941634,
  lon: 23.9142006,
  address: "Karaliaus Mindaugo pr. 34A, Kaunas",
  city: "Kaunas",
  fuels: ["95", "D"],
  sourceIds: {},
};

const report: PriceReport = {
  stationId: "osm:way:138809868",
  fuel: "D",
  price: 2.254,
  observedAt: "2026-09-17T09:00:00+03:00",
  expiresAt: "2026-09-18T09:00:00+03:00",
};

describe("loadPriceReports", () => {
  it("loads price reports and drops values that are not one", () => {
    const dir = mkdtempSync(join(tmpdir(), "reports-"));
    try {
      const path = join(dir, "reports.json");
      expect(loadPriceReports(join(dir, "missing.json"))).toEqual([]);
      writeFileSync(path, "{}");
      expect(loadPriceReports(path)).toEqual([]);
      const kept = [
        { fuel: "95", price: 1.2, observedAt: "2026-09-17T00:00:00Z", stationId: "a" },
        { fuel: "98", price: 1.3, observedAt: "2026-09-17T00:00:00Z", address: "A" },
        {
          fuel: "D",
          price: 1.4,
          observedAt: "2026-09-17T00:00:00Z",
          stationId: "b",
          address: "B",
        },
        { fuel: "LPG", price: 0.8, observedAt: "2026-09-17T00:00:00Z", stationId: "c" },
      ];
      writeFileSync(
        path,
        JSON.stringify([
          null,
          "nope",
          ...kept,
          { fuel: "EV", price: 0.3, observedAt: "2026-09-17T00:00:00Z", stationId: "d" },
          { fuel: "95", price: "1.2", observedAt: "2026-09-17T00:00:00Z", stationId: "e" },
          { fuel: "95", price: 1.2, observedAt: 1, stationId: "f" },
          { fuel: "95", price: 1.2, observedAt: "2026-09-17T00:00:00Z" },
        ]),
      );
      expect(loadPriceReports(path)).toEqual(kept);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reportStillFresh", () => {
  it("uses expiresAt when set", () => {
    expect(reportStillFresh(report, new Date("2026-09-17T12:00:00Z"))).toBe(true);
    expect(reportStillFresh(report, new Date("2026-09-18T07:00:00Z"))).toBe(false);
  });

  it("falls back to 24 hours after observedAt", () => {
    const open: PriceReport = { ...report, expiresAt: undefined };
    expect(reportStillFresh(open, new Date("2026-09-17T12:00:00Z"))).toBe(true);
    expect(reportStillFresh(open, new Date("2026-09-18T07:00:01Z"))).toBe(false);
  });
});

describe("reportsToObservations", () => {
  it("binds a report to the OSM station id", () => {
    const [obs] = reportsToObservations([report], [station], new Date("2026-09-17T12:00:00Z"));
    expect(obs).toMatchObject({
      sourceStationId: "osm:way:138809868",
      fuel: "D",
      price: 2.254,
      source: "report",
    });
  });

  it("drops expired reports", () => {
    expect(reportsToObservations([report], [station], new Date("2026-09-19T00:00:00Z"))).toEqual(
      [],
    );
  });

  it("binds by address when stationId is missing", () => {
    const open: PriceReport = {
      brand: "Circle K",
      address: "Karaliaus Mindaugo pr. 34A, Kaunas",
      city: "Kaunas",
      fuel: "D",
      price: 2.254,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    const [obs] = reportsToObservations([open], [station], new Date("2026-09-17T12:00:00Z"));
    expect(obs.sourceStationId).toBe(station.id);
    expect(obs.source).toBe("report");
  });

  it("keeps a report that has coordinates but no station", () => {
    const open: PriceReport = {
      address: "Nauja g. 1",
      city: "Klaipėda",
      name: "Nauja",
      fuel: "95",
      price: 1.5,
      lat: 55.7,
      lon: 21.1,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    const [obs] = reportsToObservations([open], [station], new Date("2026-09-17T12:00:00Z"));
    expect(obs).toMatchObject({
      sourceStationId: "report:Nauja g. 1",
      name: "Nauja",
      address: "Nauja g. 1",
      city: "Klaipėda",
      lat: 55.7,
      lon: 21.1,
      brand: "independent",
      source: "report",
    });
  });

  it("drops a report that matches no station and has no coordinates", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const base = {
      fuel: "D" as const,
      price: 1.5,
      observedAt: "2026-09-17T09:00:00+03:00",
      address: "Niekur 1",
    };
    expect(
      reportsToObservations([base, { ...base, address: "Kita 2", lat: 55.1 }], [], now),
    ).toEqual([]);
  });
});
