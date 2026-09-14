import { mapRouteStationIds, orderRouteRows, topCheapStations } from "../src/route-list.ts";

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
