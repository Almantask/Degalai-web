import { sheetDragTranslate, sheetFromDrag, isSheetDrag } from "../src/sheet-gesture.ts";

describe("sheetFromDrag", () => {
  it("minimizes a bottom sheet when dragged down far enough", () => {
    expect(sheetFromDrag(50, 1, false)).toBe(true);
  });

  it("expands a bottom sheet when dragged up far enough", () => {
    expect(sheetFromDrag(-50, 1, true)).toBe(false);
  });

  it("minimizes a top sheet when dragged up far enough", () => {
    expect(sheetFromDrag(-50, -1, false)).toBe(true);
  });

  it("expands a top sheet when dragged down far enough", () => {
    expect(sheetFromDrag(50, -1, true)).toBe(false);
  });

  it("keeps the current state for a short drag", () => {
    expect(sheetFromDrag(10, 1, false)).toBe(false);
    expect(sheetFromDrag(-10, 1, true)).toBe(true);
    expect(sheetFromDrag(-10, -1, false)).toBe(false);
  });
});

describe("sheetDragTranslate", () => {
  it("moves a bottom sheet down while collapsing", () => {
    expect(sheetDragTranslate(40, 1, false)).toBe(40);
  });

  it("moves a bottom sheet up while expanding", () => {
    expect(sheetDragTranslate(-40, 1, true)).toBe(-40);
  });

  it("moves a top sheet up while collapsing", () => {
    expect(sheetDragTranslate(-40, -1, false)).toBe(-40);
  });

  it("ignores movement away from the other state", () => {
    expect(sheetDragTranslate(40, 1, true)).toBe(0);
    expect(sheetDragTranslate(-40, -1, true)).toBe(0);
  });
});

describe("isSheetDrag", () => {
  it("ignores tiny movement so a tap can still toggle", () => {
    expect(isSheetDrag(2, 3)).toBe(false);
  });

  it("accepts vertical movement and rejects mostly horizontal pans", () => {
    expect(isSheetDrag(4, 20)).toBe(true);
    expect(isSheetDrag(24, 6)).toBe(false);
  });
});
