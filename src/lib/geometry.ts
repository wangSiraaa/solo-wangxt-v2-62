// ───────────────────────────────────────────────────────────────────────────
// 场地几何检查
// 注意：这里只做“桌子是否压到项目提供的禁止占用多边形 / 是否出界 / 桌间是否重叠”
// 的纯几何判断，不构成任何消防安全认证或合规结论。
// 多边形由项目数据提供（过道、消防出口缓冲区、舞台等）。
// ───────────────────────────────────────────────────────────────────────────

import type { Point, TableDef, Venue } from '../types';

export interface GeometryIssue {
  tableId: string;
  kind: 'out-of-bounds' | 'forbidden-zone' | 'table-overlap';
  targetId?: string;
  detail: string;
}

interface Circle {
  cx: number;
  cy: number;
  r: number;
}

interface Box {
  // 当前桌形不支持旋转，使用轴对齐矩形
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type Footprint =
  | { kind: 'circle'; circle: Circle }
  | { kind: 'box'; box: Box };

function tableFootprint(t: TableDef): Footprint {
  if (t.shape === 'rect') {
    const hx = t.length ?? t.radius;
    const hy = t.radius;
    return {
      kind: 'box',
      box: { minX: t.x - hx, maxX: t.x + hx, minY: t.y - hy, maxY: t.y + hy },
    };
  }
  return { kind: 'circle', circle: { cx: t.x, cy: t.y, r: t.radius } };
}

/** 射线法判断点是否在多边形内 */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInBox(p: Point, b: Box): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** 圆与线段是否相交（含内部） */
function circleIntersectsSegment(c: Circle, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || Number.EPSILON;
  let t = ((c.cx - a.x) * dx + (c.cy - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return (px - c.cx) ** 2 + (py - c.cy) ** 2 <= c.r ** 2;
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function circleIntersectsPolygon(c: Circle, poly: Point[]): boolean {
  if (pointInPolygon({ x: c.cx, y: c.cy }, poly)) return true;
  if (poly.some((p) => (p.x - c.cx) ** 2 + (p.y - c.cy) ** 2 <= c.r ** 2)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (circleIntersectsSegment(c, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  return false;
}

function boxIntersectsPolygon(b: Box, poly: Point[]): boolean {
  // 多边形任一顶点在矩形内
  if (poly.some((p) => pointInBox(p, b))) return true;
  // 矩形任一角在多边形内
  const corners: Point[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  if (corners.some((p) => pointInPolygon(p, poly))) return true;
  // 任一边穿矩形
  const boxEdges: [Point, Point][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let i = 0; i < poly.length; i++) {
    const e: [Point, Point] = [poly[i], poly[(i + 1) % poly.length]];
    if (boxEdges.some(([a, b2]) => segmentsIntersect(a, b2, e[0], e[1]))) return true;
  }
  return false;
}

function footprintIntersectsPolygon(fp: Footprint, poly: Point[]): boolean {
  return fp.kind === 'circle'
    ? circleIntersectsPolygon(fp.circle, poly)
    : boxIntersectsPolygon(fp.box, poly);
}

function footprintInsideVenue(fp: Footprint, venue: Venue): boolean {
  if (fp.kind === 'circle') {
    const { cx, cy, r } = fp.circle;
    return cx - r >= 0 && cy - r >= 0 && cx + r <= venue.width && cy + r <= venue.height;
  }
  const b = fp.box;
  return (
    b.minX >= 0 && b.minY >= 0 && b.maxX <= venue.width && b.maxY <= venue.height
  );
}

function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = a.circle.cx - b.circle.cx;
    const dy = a.circle.cy - b.circle.cy;
    return Math.hypot(dx, dy) < a.circle.r + b.circle.r;
  }
  if (a.kind === 'box' && b.kind === 'box') {
    return (
      a.box.minX < b.box.maxX &&
      a.box.maxX > b.box.minX &&
      a.box.minY < b.box.maxY &&
      a.box.maxY > b.box.minY
    );
  }
  const circle = a.kind === 'circle' ? a.circle : b.kind === 'circle' ? b.circle : null;
  const box = a.kind === 'box' ? a.box : b.kind === 'box' ? b.box : null;
  if (circle && box) {
    const nearestX = Math.max(box.minX, Math.min(circle.cx, box.maxX));
    const nearestY = Math.max(box.minY, Math.min(circle.cy, box.maxY));
    return (nearestX - circle.cx) ** 2 + (nearestY - circle.cy) ** 2 < circle.r ** 2;
  }
  return false;
}

/** 判断单张桌子的几何问题（可用于拖动时实时校验） */
export function checkTableGeometry(
  table: TableDef,
  allTables: TableDef[],
  venue: Venue,
): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  const fp = tableFootprint(table);

  if (!footprintInsideVenue(fp, venue)) {
    issues.push({
      tableId: table.id,
      kind: 'out-of-bounds',
      detail: `「${table.label}」超出场地边界`,
    });
  }

  for (const zone of venue.forbiddenZones) {
    if (footprintIntersectsPolygon(fp, zone.polygon)) {
      issues.push({
        tableId: table.id,
        kind: 'forbidden-zone',
        targetId: zone.id,
        detail: `「${table.label}」压入禁止占用区域：${zone.label}`,
      });
    }
  }

  for (const other of allTables) {
    if (other.id === table.id) continue;
    if (footprintsOverlap(fp, tableFootprint(other))) {
      issues.push({
        tableId: table.id,
        kind: 'table-overlap',
        targetId: other.id,
        detail: `「${table.label}」与「${other.label}」重叠`,
      });
    }
  }

  return issues;
}

/** 全场地几何检查，返回去重后的问题列表 */
export function checkAllGeometry(tables: TableDef[], venue: Venue): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    for (const issue of checkTableGeometry(t, tables, venue)) {
      const key = `${issue.kind}:${issue.tableId}:${issue.targetId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
  }
  return issues;
}

/**
 * 尝试为桌子寻找一个不违反几何约束的最近位置（用于“挪到最近合法位置”辅助）。
 * 找不到返回 null。
 */
export function nearestLegalPosition(
  table: TableDef,
  allTables: TableDef[],
  venue: Venue,
): Point | null {
  const step = 8;
  for (let radius = step; radius <= Math.max(venue.width, venue.height); radius += step) {
    const candidates = Math.max(8, Math.floor((2 * Math.PI * radius) / step));
    for (let i = 0; i < candidates; i++) {
      const angle = (i / candidates) * Math.PI * 2;
      const p = {
        x: Math.round(table.x + Math.cos(angle) * radius),
        y: Math.round(table.y + Math.sin(angle) * radius),
      };
      const moved = { ...table, x: p.x, y: p.y };
      if (checkTableGeometry(moved, allTables, venue).length === 0) return p;
    }
  }
  return null;
}
