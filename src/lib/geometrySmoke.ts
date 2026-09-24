// 供几何烟测打包的薄封装（直接复用生产代码）
import { pointInPolygon, findZoneViolations } from './geometry';
import { createSampleProject } from './sample';
import type { ForbiddenZone, VenueTable } from '../types';
import type { Pt } from './geometry';

const roundTable = (t: { x: number; y: number; radius: number }): VenueTable => ({
  id: 'rt',
  name: 'RT',
  shape: 'round',
  x: t.x,
  y: t.y,
  radius: t.radius,
  halfHeight: 0,
  seats: 4,
  isHead: false,
  positionLocked: false,
});

const rectTable = (t: { x: number; y: number; halfW: number; halfH: number }): VenueTable => ({
  id: 'tt',
  name: 'TT',
  shape: 'rect',
  x: t.x,
  y: t.y,
  radius: t.halfW,
  halfHeight: t.halfH,
  seats: 4,
  isHead: false,
  positionLocked: false,
});

const zone = (x: number, y: number, w: number, h: number): ForbiddenZone => ({
  id: 'z',
  name: 'Z',
  kind: 'aisle',
  points: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

export const rectPoly = (x: number, y: number, w: number, h: number): Pt[] =>
  [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

export const pointInPoly = (p: { x: number; y: number }, pts: Pt[]) => pointInPolygon(p, pts);

export const pointIn = (p: { x: number; y: number }, pts: [number, number][]) =>
  pointInPolygon(p, pts.map(([x, y]) => ({ x, y })));

export const rectZone = zone;

export const roundTableViolates = (
  t: { x: number; y: number; radius: number },
  z: ForbiddenZone,
  chairMargin = 28,
) => findZoneViolations([roundTable(t)], [z]).length > 0;

export const rectTableViolates = (
  t: { x: number; y: number; halfW: number; halfH: number },
  z: ForbiddenZone,
) => findZoneViolations([rectTable(t)], [z]).length > 0;

export const sampleViolations = () => {
  const p = createSampleProject({ withConflict: false });
  return [
    ...new Set(
      findZoneViolations(p.venue.tables, p.venue.zones).map((v) =>
        p.venue.tables.find((t) => t.id === v.tableId)?.name,
      ),
    ),
  ];
};
