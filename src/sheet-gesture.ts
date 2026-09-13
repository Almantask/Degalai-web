export const SHEET_DRAG_THRESHOLD_PX = 40;
export const SHEET_COMPACT_MQ = "(max-width: 899px)";

/** +1 if dragging down minimizes (bottom sheet), -1 if dragging up minimizes (top sheet). */
export type MinimizeSign = 1 | -1;

export function sheetFromDrag(
  deltaY: number,
  minimizeSign: MinimizeSign,
  wasMin: boolean,
  threshold = SHEET_DRAG_THRESHOLD_PX,
): boolean {
  const towardMin = deltaY * minimizeSign;
  if (towardMin >= threshold) return true;
  if (towardMin <= -threshold) return false;
  return wasMin;
}

export function sheetDragTranslate(
  deltaY: number,
  minimizeSign: MinimizeSign,
  wasMin: boolean,
  maxPx = 120,
): number {
  const towardMin = deltaY * minimizeSign;
  if (wasMin) {
    const towardExpand = Math.min(maxPx, Math.max(0, -towardMin));
    if (towardExpand === 0) return 0;
    return -minimizeSign * towardExpand;
  }
  const toward = Math.min(maxPx, Math.max(0, towardMin));
  return minimizeSign * toward;
}

export function isSheetDrag(deltaX: number, deltaY: number, slop = 8): boolean {
  if (Math.abs(deltaX) < slop && Math.abs(deltaY) < slop) return false;
  return Math.abs(deltaY) >= Math.abs(deltaX);
}
