import { orderRouteRows } from "../src/route-list.ts";

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
