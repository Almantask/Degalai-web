import {
  cheapestOnDashed,
  detourCandidates,
  detourWindow,
  isOnTheWay,
  mapRouteStationIds,
  orderRouteRows,
  topCheapStations,
} from "../src/route-list.ts";

function row(id: string, price: number, kind: "on" | "detour") {
  return { station: { id }, price, kind };
}

describe("orderRouteRows", () => {
  it("returns empty highlights for no stations", () => {
    expect(orderRouteRows([])).toEqual({
      cheapestOn: undefined,
      cheapestOverall: undefined,
      ordered: [],
    });
  });

  it("pins the cheapest on-route station first when it is also cheapest overall", () => {
    const a = row("a", 1.41, "on");
    const b = row("b", 1.55, "on");
    const c = row("c", 1.48, "detour");
    const { cheapestOn, cheapestOverall, ordered } = orderRouteRows([b, c, a]);
    expect(cheapestOn?.station.id).toBe("a");
    expect(cheapestOverall?.station.id).toBe("a");
    expect(ordered.map((r) => r.station.id)).toEqual(["a", "c", "b"]);
  });

  it("pins cheapest on-route then cheaper overall detour, then the rest by price", () => {
    const onCheap = row("on-cheap", 1.5, "on");
    const onDear = row("on-dear", 1.7, "on");
    const detourCheap = row("detour", 1.32, "detour");
    const detourMid = row("mid", 1.6, "detour");
    const { cheapestOn, cheapestOverall, ordered } = orderRouteRows([
      onDear,
      detourMid,
      detourCheap,
      onCheap,
    ]);
    expect(cheapestOn?.station.id).toBe("on-cheap");
    expect(cheapestOverall?.station.id).toBe("detour");
    expect(ordered.map((r) => r.station.id)).toEqual(["on-cheap", "detour", "mid", "on-dear"]);
  });

  it("falls back to cheapest overall when nothing is on the route", () => {
    const a = row("a", 1.4, "detour");
    const b = row("b", 1.2, "detour");
    const { cheapestOn, cheapestOverall, ordered } = orderRouteRows([a, b]);
    expect(cheapestOn).toBeUndefined();
    expect(cheapestOverall?.station.id).toBe("b");
    expect(ordered.map((r) => r.station.id)).toEqual(["b", "a"]);
  });
});

describe("topCheapStations", () => {
  it("returns the five cheapest by price then id", () => {
    const rows = [
      row("d", 1.5, "detour"),
      row("a", 1.2, "on"),
      row("c", 1.4, "detour"),
      row("b", 1.2, "detour"),
      row("e", 1.8, "on"),
      row("f", 1.1, "detour"),
    ];
    expect(topCheapStations(rows).map((r) => r.station.id)).toEqual(["f", "a", "b", "c", "d"]);
  });

  it("returns every row when there are fewer than the limit", () => {
    expect(topCheapStations([row("a", 2, "on")]).map((r) => r.station.id)).toEqual(["a"]);
  });
});

describe("mapRouteStationIds", () => {
  it("keeps the five cheapest on the way", () => {
    const rows = [
      row("d", 1.5, "on"),
      row("a", 1.2, "on"),
      row("c", 1.4, "on"),
      row("b", 1.25, "on"),
      row("e", 1.8, "on"),
      row("f", 1.1, "on"),
    ];
    expect([...mapRouteStationIds(rows)].sort()).toEqual(["a", "b", "c", "d", "f"]);
  });

  it("adds a list-picked station even when it is not in the top five", () => {
    const rows = [
      row("a", 1.1, "on"),
      row("b", 1.2, "on"),
      row("c", 1.3, "on"),
      row("d", 1.4, "on"),
      row("e", 1.5, "on"),
      row("picked", 1.9, "on"),
    ];
    const ids = mapRouteStationIds(rows, new Set(["picked"]));
    expect(ids.has("picked")).toBe(true);
    expect(ids.size).toBe(6);
  });

  it("ignores extra ids that are not on the way", () => {
    const ids = mapRouteStationIds([row("a", 1.2, "on")], new Set(["off-route"]));
    expect([...ids]).toEqual(["a"]);
  });
});

describe("isOnTheWay", () => {
  // Vienybės a. → Pramonės pr. 3, Kaunas: the fastest route crosses Žaliakalnis. Circle K on
  // K. Baršausko g. is near that line but across the road and down the hill.
  it("goes by road detour, not by distance from the route line", () => {
    expect(isOnTheWay(0.3, { extraKm: 3.4 })).toBe(false);
    expect(isOnTheWay(1.2, { extraKm: 0.6 })).toBe(true);
  });

  it("allows less than 1 km of extra road", () => {
    expect(isOnTheWay(0.1, { extraKm: 0.99 })).toBe(true);
    expect(isOnTheWay(0.1, { extraKm: 1 })).toBe(false);
  });

  it("drops a station the router cannot reach", () => {
    expect(isOnTheWay(0.1, null)).toBe(false);
  });

  it("falls back to 500 m from the line without a router answer", () => {
    expect(isOnTheWay(0.5, undefined)).toBe(true);
    expect(isOnTheWay(0.6, undefined)).toBe(false);
  });
});

describe("detourCandidates", () => {
  it("keeps stations within 2 km of the line, closest first, up to the limit", () => {
    const rows = [
      { id: "far", lineKm: 2.5 },
      { id: "b", lineKm: 1.2 },
      { id: "a", lineKm: 0.1 },
      { id: "c", lineKm: 1.9 },
    ];
    expect(detourCandidates(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(detourCandidates(rows, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("detourWindow", () => {
  // A road due east along 54.9° N, about 6.4 km long.
  const line = [
    { lat: 54.9, lon: 23.9 },
    { lat: 54.9, lon: 24.0 },
  ];

  it("leaves 1 km before the station and rejoins 1 km after, heading along the route", () => {
    const w = detourWindow(line, { lat: 54.9005, lon: 23.95 });
    expect(w.alongKm).toBeCloseTo(3.2, 1);
    expect(w.leave.lon).toBeCloseTo(23.95 - 1 / 64, 3);
    expect(w.rejoin.lon).toBeCloseTo(23.95 + 1 / 64, 3);
    expect(w.leave.bearing).toBeCloseTo(90, 0);
    expect(w.rejoin.bearing).toBeCloseTo(90, 0);
  });

  it("stays on the route near its ends", () => {
    const w = detourWindow(line, { lat: 54.9, lon: 23.901 });
    expect(w.leave).toMatchObject({ lat: 54.9, lon: 23.9 });
    const end = detourWindow(line, { lat: 54.9, lon: 23.999 });
    expect(end.rejoin).toMatchObject({ lat: 54.9, lon: 24.0 });
  });
});

describe("cheapestOnDashed", () => {
  const near = (id: string, price: number, detourKm?: number | null, dashedKm = 0.05) => ({
    station: { id },
    price,
    dashedKm,
    detourKm,
  });

  // Vienybės a. → Pramonės pr. 3 over Žaliakalnis: a dashed line to Circle K runs along the river,
  // past Neste on Tunelio g. and Viada on K. Baršausko g.
  it("picks the cheapest station on the dashed line that beats the one it leads to", () => {
    const pick = cheapestOnDashed(2.274, [
      near("viada", 2.269, 0.2),
      near("neste", 2.244, 0.1),
      near("dearer", 2.299, 0.1),
    ]);
    expect(pick?.station.id).toBe("neste");
  });

  it("skips a station off the line, across the road from it, or unreachable", () => {
    expect(cheapestOnDashed(2.27, [near("off-line", 2.1, 0.1, 0.4)])).toBeUndefined();
    expect(cheapestOnDashed(2.27, [near("across", 2.1, 1.3)])).toBeUndefined();
    expect(cheapestOnDashed(2.27, [near("unreachable", 2.1, null)])).toBeUndefined();
  });

  it("goes by closeness to the line when the router did not answer", () => {
    expect(cheapestOnDashed(2.27, [near("unchecked", 2.1, undefined)])?.station.id).toBe(
      "unchecked",
    );
  });

  it("marks nothing when the line's own station is the cheapest", () => {
    expect(cheapestOnDashed(2.27, [near("dearer", 2.3, 0.1)])).toBeUndefined();
  });
});
