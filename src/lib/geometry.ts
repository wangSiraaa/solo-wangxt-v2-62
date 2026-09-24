// 纯几何工具：仅用于"是否压到禁止占用多边形"的几何检查。
// 注意：本工具不做任何消防/疏散安全认证，仅按项目提供的多边形做占用判定。

import type { ForbiddenZone, VenueTable } from '../types';

export interface Pt {
  x: number;
  y: number;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const hit =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function polygonIntersectsPolygon(a: Pt[], b: Pt[]): boolean {
  for (const p of a) if (pointInPolygon(p, b)) return true;
  for (const p of b) if (pointInPolygon(p, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a2 = a[(i + 1) % a.length];
    for (let k = 0; k < b.length; k++) {
      if (segmentsIntersect(a[i], a2, b[k], b[(k + 1) % b.length])) return true;
    }
  }
  return false;
}

/** 桌子的占地多边形（含椅子环绕余量） */
export function tableFootprint(t: VenueTable, chairMargin = 28): Pt[] {
  if (t.shape === 'round') {
    const r = t.radius + chairMargin;
    const n = 24;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: t.x + r * Math.cos(a), y: t.y + r * Math.sin(a) });
    }
    return pts;
  }
  const hw = t.radius + chairMargin;
  const hh = t.halfHeight + chairMargin;
  return [
    { x: t.x - hw, y: t.y - hh },
    { x: t.x + hw, y: t.y - hh },
    { x: t.x + hw, y: t.y + hh },
    { x: t.x - hw, y: t.y + hh },
  ];
}

export function zoneToPts(z: ForbiddenZone): Pt[] {
  return z.points.map((p: [number, number]) => ({ x: p[0], y: p[1] }));
}

export interface ZoneViolation {
  tableId: string;
  zoneId: string;
  zoneName: string;
  kind: ForbiddenZone['kind'];
}

/** 检查所有桌子是否压到禁止占用多边形（纯几何检查） */
export function findZoneViolations(
  tables: VenueTable[],
  zones: ForbiddenZone[],
): ZoneViolation[] {
  const out: ZoneViolation[] = [];
  for (const t of tables) {
    const fp = tableFootprint(t);
    for (const z of zones) {
      if (polygonIntersectsPolygon(fp, zoneToPts(z))) {
        out.push({ tableId: t.id, zoneId: z.id, zoneName: z.name, kind: z.kind });
      }
    }
  }
  return out;
}

/** 两桌占地（含椅子余量）是否重叠 */
export function tablesOverlap(a: VenueTable, b: VenueTable): boolean {
  if (a.shape === 'round' && b.shape === 'round') {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return d < a.radius + b.radius + 56;
  }
  return polygonIntersectsPolygon(tableFootprint(a), tableFootprint(b));
}

export function seatPosition(t: VenueTable, seatIndex: number): Pt {
  const n = t.seats;
  if (t.shape === 'round') {
    const a = -Math.PI / 2 + (seatIndex / n) * Math.PI * 2;
    const r = t.radius + 22;
    return { x: t.x + r * Math.cos(a), y: t.y + r * Math.sin(a) };
  }
  // 矩形：沿长边均匀分布，上下两边
  const hw = t.radius;
  const hh = t.halfHeight;
  const perLong = Math.ceil(n / 2);
  const perShort = Math.max(0, Math.floor((n - perLong * 2) / 2));
  void perShort;
  if (seatIndex < perLong) {
    const x = perLong === 1 ? t.x : t.x - hw + (seatIndex / (perLong - 1)) * hw * 2;
    return { x, y: t.y - hh - 22 };
  }
  const k = seatIndex - perLong;
  if (k < perLong) {
    const x = perLong === 1 ? t.x : t.x - hw + (k / (perLong - 1)) * hw * 2;
    return { x, y: t.y + hh + 22 };
  }
  // 余量座位放到短边
  const side = Math.floor((k - perLong) / Math.max(1, perLong));
  const y = t.y - hh + ((k - perLong) % Math.max(1, perLong)) / Math.max(1, perLong) * hh * 2;
  return { x: t.x + (side % 2 === 0 ? -hw - 22 : hw + 22), y };
}
