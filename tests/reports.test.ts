import { describe, expect, it } from "vitest";
import { reportStillFresh, reportsToObservations } from "../scripts/adapters/reports.ts";
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
});
