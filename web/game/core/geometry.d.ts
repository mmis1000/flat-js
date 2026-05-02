import { Rect } from './types';
export declare function rectFitsArenaInset(r: Rect, inset: number): boolean;
export declare function rectsSeparatedByGap(a: Rect, b: Rect, gap: number): boolean;
export declare function rectHitsCircle(r: Rect, cx: number, cy: number, cr: number): boolean;
export declare function circleHitsRect(cx: number, cy: number, cr: number, r: Rect): boolean;
export declare function botCenterClearOfRects(bx: number, by: number, rects: Rect[], clearance: number): boolean;
export declare function rayAabb(ox: number, oy: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number, interior: boolean): number | null;
export declare function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, cr: number): number | null;
