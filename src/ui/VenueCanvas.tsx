import { useMemo } from 'react';
import { Group, Layer, Rect, Circle, Line, Text, Star, RegularPolygon } from 'react-konva';
import type {
  SeatAssignment,
  TableDef,
  Venue,
  WeddingProject,
} from '../types';
import type { GeometryIssue } from '../lib/geometry';

interface VenueCanvasProps {
  project: WeddingProject;
  venue: Venue;
  geometryIssues: GeometryIssue[];
  selectedTableId: string | null;
  selectedGuestId: string | null;
  candidateAssignments: SeatAssignment[] | null;
  onSelectTable: (id: string | null) => void;
  onDragMoveTable: (id: string, x: number, y: number) => void;
  onDragEndTable: () => void;
  onSeatClick: (tableId: string, seatIndex: number) => void;
}

const ZONE_COLOR: Record<string, string> = {
  aisle: 'rgba(120, 110, 95, 0.18)',
  exit: 'rgba(176, 70, 58, 0.22)',
  stage: 'rgba(70, 60, 110, 0.16)',
  other: 'rgba(120, 120, 120, 0.15)',
};
const ZONE_STROKE: Record<string, string> = {
  aisle: '#8c8170',
  exit: '#b0463a',
  stage: '#5b4f7a',
  other: '#888',
};

interface SeatLayout {
  x: number;
  y: number;
  r: number;
}

export function seatLayout(table: TableDef, seatIndex: number): SeatLayout {
  const count = table.capacity;
  const seatR = 11;
  if (table.shape === 'rect') {
    // 长桌：上下两侧排布（坐标相对桌心）
    const hx = table.length ?? table.radius;
    const hy = table.radius;
    const perSide = Math.max(1, Math.ceil(count / 2));
    const side = seatIndex < perSide ? -1 : 1;
    const idx = seatIndex < perSide ? seatIndex : seatIndex - perSide;
    const usable = hx * 2 - 24;
    const x = count <= 1 ? 0 : -hx + 12 + (usable * idx) / Math.max(1, perSide - 1);
    return { x, y: side * (hy + seatR + 4), r: seatR };
  }
  // 圆桌：绕圆排布（坐标相对桌心）
  const ring = table.radius + seatR + 5;
  const angle = -Math.PI / 2 + (seatIndex / count) * Math.PI * 2;
  return {
    x: Math.cos(angle) * ring,
    y: Math.sin(angle) * ring,
    r: seatR,
  };
}

export default function VenueCanvas(props: VenueCanvasProps) {
  const {
    project,
    venue,
    geometryIssues,
    selectedTableId,
    selectedGuestId,
    candidateAssignments,
    onSelectTable,
    onDragMoveTable,
    onDragEndTable,
  } = props;

  const guestById = useMemo(
    () => new Map(project.guests.map((g) => [g.id, g])),
    [project.guests],
  );

  // 候选方案（自动）与当前（手工）两套桌→座位映射，供叠加预览
  const shownAssignments = candidateAssignments ?? project.assignments;
  const seatMap = useMemo(() => {
    const m = new Map<string, SeatAssignment>();
    for (const a of shownAssignments) m.set(`${a.tableId}:${a.seatIndex}`, a);
    return m;
  }, [shownAssignments]);

  const issuesByTable = useMemo(() => {
    const m = new Map<string, GeometryIssue[]>();
    for (const i of geometryIssues) {
      const list = m.get(i.tableId) ?? [];
      list.push(i);
      m.set(i.tableId, list);
    }
    return m;
  }, [geometryIssues]);

  return (
    <Layer>
      {/* 场地底板 */}
      <Rect
        x={0}
        y={0}
        width={venue.width}
        height={venue.height}
        fill="#fbf8f2"
        stroke="#cfc4b0"
        strokeWidth={2}
        cornerRadius={4}
      />

      {/* 禁止占用多边形 */}
      {venue.forbiddenZones.map((zone) => {
        const flat = zone.polygon.flatMap((p) => [p.x, p.y]);
        return (
          <Group key={zone.id} listening={false}>
            <Line
              points={flat}
              closed
              fill={ZONE_COLOR[zone.kind] ?? ZONE_COLOR.other}
              stroke={ZONE_STROKE[zone.kind] ?? ZONE_STROKE.other}
              strokeWidth={1.5}
              dash={[6, 4]}
            />
            {(() => {
              const cx = zone.polygon.reduce((s, p) => s + p.x, 0) / zone.polygon.length;
              const cy = zone.polygon.reduce((s, p) => s + p.y, 0) / zone.polygon.length;
              return (
                <Text
                  x={cx - 80}
                  y={cy - 9}
                  width={160}
                  align="center"
                  text={zone.label}
                  fontSize={11}
                  fontStyle="bold"
                  fill={ZONE_STROKE[zone.kind] ?? ZONE_STROKE.other}
                />
              );
            })()}
          </Group>
        );
      })}

      {/* 桌子 */}
      {project.tables.map((table) => {
        const selected = table.id === selectedTableId;
        const issues = issuesByTable.get(table.id) ?? [];
        const hasError = issues.length > 0;
        const tableAssignments = shownAssignments.filter((a) => a.tableId === table.id);

        return (
          <Group
            key={table.id}
            x={table.x}
            y={table.y}
            draggable
            onDragMove={(e) => onDragMoveTable(table.id, e.target.x(), e.target.y())}
            onDragEnd={onDragEndTable}
            onClick={(e) => {
              e.cancelBubble = true;
              onSelectTable(table.id);
            }}
          >
            {/* 桌体 */}
            {table.shape === 'round' ? (
              <Circle
                x={0}
                y={0}
                radius={table.radius}
                fill={table.isHeadTable ? '#f3e4d3' : '#ffffff'}
                stroke={hasError ? '#b0463a' : selected ? '#8a5a3b' : '#b9a98e'}
                strokeWidth={selected ? 3 : 1.5}
                shadowColor="rgba(60,45,30,0.2)"
                shadowBlur={6}
                shadowOffsetY={2}
              />
            ) : (
              <Rect
                x={-(table.length ?? table.radius)}
                y={-table.radius}
                width={(table.length ?? table.radius) * 2}
                height={table.radius * 2}
                cornerRadius={10}
                fill={table.isHeadTable ? '#f3e4d3' : '#ffffff'}
                stroke={hasError ? '#b0463a' : selected ? '#8a5a3b' : '#b9a98e'}
                strokeWidth={selected ? 3 : 1.5}
                shadowColor="rgba(60,45,30,0.2)"
                shadowBlur={6}
                shadowOffsetY={2}
              />
            )}

            {/* 主桌星标 */}
            {table.isHeadTable && (
              <Star
                x={0}
                y={-6}
                numPoints={5}
                innerRadius={5}
                outerRadius={10}
                fill="#b78b3c"
              />
            )}
            <Text
              x={-table.radius}
              y={table.isHeadTable ? 6 : -9}
              width={table.radius * 2}
              align="center"
              text={table.label}
              fontSize={12}
              fontStyle="bold"
              fill="#5c4a36"
            />
            <Text
              x={-table.radius}
              y={table.isHeadTable ? 22 : 6}
              width={table.radius * 2}
              align="center"
              text={`${tableAssignments.length}/${table.capacity}`}
              fontSize={10}
              fill={tableAssignments.length > table.capacity ? '#b0463a' : '#9a8c76'}
            />

            {/* 座位 */}
            {Array.from({ length: table.capacity }, (_, seatIndex) => {
              const layout = seatLayout(table, seatIndex);
              const a = seatMap.get(`${table.id}:${seatIndex}`);
              const guest = a?.guestId ? guestById.get(a.guestId) : null;
              const isSelectedGuest = a?.guestId && a.guestId === selectedGuestId;

              let fill = '#f1ece2';
              let stroke = '#c9bda8';
              if (a) {
                if (a.locked) {
                  fill = '#e7e1d6';
                  stroke = '#6b6256';
                } else if (candidateAssignments) {
                  fill = '#fdf0e3';
                  stroke = '#c89b7b';
                } else {
                  fill = '#e8f0fa';
                  stroke = '#86a2c6';
                }
              }
              if (isSelectedGuest) {
                stroke = '#8a5a3b';
              }

              return (
                <Group
                  key={seatIndex}
                  x={layout.x}
                  y={layout.y}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    onSelectTable(table.id);
                    props.onSeatClick(table.id, seatIndex);
                  }}
                  onMouseEnter={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = 'default';
                  }}
                >
                  {a?.childChair ? (
                    <RegularPolygon
                      sides={3}
                      radius={layout.r}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSelectedGuest ? 2.5 : 1.5}
                    />
                  ) : (
                    <Circle
                      radius={layout.r}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSelectedGuest ? 2.5 : 1.5}
                    />
                  )}
                  {a?.locked && (
                    <Text
                      x={-5}
                      y={-12}
                      width={10}
                      align="center"
                      text="🔒"
                      fontSize={9}
                    />
                  )}
                  {guest && (
                    <Text
                      x={-28}
                      y={layout.r + 2}
                      width={56}
                      align="center"
                      text={guest.displayName}
                      fontSize={9}
                      fill={guest.rsvp === 'pending' ? '#9a7420' : '#5c4a36'}
                    />
                  )}
                  {a?.childChair && !guest && (
                    <Text
                      x={-20}
                      y={layout.r + 2}
                      width={40}
                      align="center"
                      text="童椅"
                      fontSize={9}
                      fill="#6b6256"
                    />
                  )}
                </Group>
              );
            })}

            {/* 几何错误标 */}
            {hasError && (
              <Group x={table.radius - 4} y={-table.radius - 6}>
                <Circle radius={9} fill="#b0463a" />
                <Text x={-9} y={-7} width={18} align="center" text="!" fill="#fff" fontSize={12} fontStyle="bold" />
              </Group>
            )}
          </Group>
        );
      })}
    </Layer>
  );
}
