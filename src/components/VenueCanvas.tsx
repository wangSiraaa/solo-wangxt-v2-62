import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text, Group } from 'react-konva';
import type { SeatingProject, VenueTable } from '../types';
import { findZoneViolations, seatPosition, tablesOverlap, zoneToPts } from '../lib/geometry';
import { guestLabel } from '../lib/ids';
import type { ProjectApi } from '../state/store';
import { applyAssignment } from '../lib/apply';
import { seatGuest, toggleSeatLock, unseatGuest } from '../lib/seatingOps';

interface Props {
  store: ProjectApi;
  selectedGuestId: string | null;
  onSelectGuest: (id: string | null) => void;
  notify: (msg: string, kind?: 'error' | 'ok') => void;
  layoutMode: boolean;
  onEditTable: (t: VenueTable) => void;
}

const COLORS = {
  floor: '#f7f3eb',
  zone: 'rgba(210, 77, 66, .16)',
  zoneStroke: '#cf5246',
  zoneText: '#a93226',
  table: '#efe2cb',
  tableStroke: '#b4864b',
  head: '#f3d999',
  headStroke: '#b48608',
  seat: '#fff',
  seatStroke: '#b6a892',
  locked: '#d8c9ae',
  lockedStroke: '#7d6b54',
  stay: '#e8e2d6',
  move: '#bfe3c8',
  leave: '#f3c6c0',
  text: '#3b3328',
  violationStroke: '#c0392b',
};

interface SeatSel {
  tableId: string;
  seat: number;
}

export function VenueCanvas({
  store,
  selectedGuestId,
  onSelectGuest,
  notify,
  layoutMode,
  onEditTable,
}: Props) {
  const { project, commit, plan } = store;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);
  const [selectedSeat, setSelectedSeat] = useState<SeatSel | null>(null);

  const byId = useMemo(() => new Map(project.guests.map((g) => [g.id, g])), [project.guests]);

  const violations = useMemo(
    () => findZoneViolations(project.venue.tables, project.venue.zones),
    [project.venue.tables, project.venue.zones],
  );
  const violationTables = useMemo(() => new Set(violations.map((v) => v.tableId)), [violations]);

  // 桌间占地重叠（含椅子余量）—— 纯几何检查
  const overlaps = useMemo(() => {
    const out: { a: string; b: string }[] = [];
    const ts = project.venue.tables;
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        if (tablesOverlap(ts[i], ts[j])) out.push({ a: ts[i].id, b: ts[j].id });
    return out;
  }, [project.venue.tables]);
  const overlapTables = useMemo(() => new Set(overlaps.flatMap((o) => [o.a, o.b])), [overlaps]);

  // 自动方案预览（不落地）
  const previewSeats = useMemo(
    () => (plan ? applyAssignment(project, plan.assignment).seats : null),
    [plan, project],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const pad = 40;
      setSize({ w: el.clientWidth, h: el.clientHeight });
      const s = Math.min(
        (el.clientWidth - pad) / project.venue.width,
        (el.clientHeight - pad) / project.venue.height,
      );
      setScale(Math.max(0.2, s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.venue.width, project.venue.height]);

  const commitSafe = (fn: () => SeatingProject, ok?: string) => {
    try {
      commit(fn);
      if (ok) notify(ok, 'ok');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const onSeatClick = (tableId: string, seat: number, e: any) => {
    e.cancelBubble = true;
    const row = project.seats[tableId] ?? [];
    const occupant = row[seat] ?? null;
    const locked = project.lockedSeats[tableId]?.[seat];

    if (e.evt.shiftKey) {
      commit((p) => toggleSeatLock(p, tableId, seat), { keepPlan: true });
      setSelectedSeat({ tableId, seat });
      notify(
        locked ? '已解锁座位' : `已锁定座位${occupant ? '（自动排座不会移动该宾客）' : '（占位：自动排座不会占用）'}`,
        'ok',
      );
      return;
    }

    if (selectedGuestId) {
      if (occupant === selectedGuestId) return;
      commitSafe(
        () => seatGuest(project, selectedGuestId, tableId, seat),
        '已入座（Ctrl+Z 可撤销）',
      );
      return;
    }

    setSelectedSeat({ tableId, seat });
    if (occupant) onSelectGuest(occupant);
  };

  const violatedNames = [...new Set(
    violations.map((v) => project.venue.tables.find((t) => t.id === v.tableId)?.name).filter(Boolean),
  )].join('、');

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className={`hud ${violations.length > 0 || overlaps.length > 0 ? 'warn' : ''}`}>
        {layoutMode ? (
          <>
            <b>布局模式</b>
            <div className="small">
              拖动桌子调整位置，点击桌子编辑容量/名称。虚线多边形为项目提供的禁止占用区域
              （过道/消防出口），仅做几何相交检查，<b>不构成任何安全认证</b>。
            </div>
          </>
        ) : (
          <>
            <b>座位模式</b>
            <div className="small">
              {selectedGuestId
                ? '已选中宾客：点击任意座位入座（与原座位宾客交换）。'
                : '在左侧点选宾客后点座位入座；也可直接拖动座位上的姓名换座。'}
              <br />
              <b>Shift+点击座位</b> 切换锁定；锁定空座可作为儿童椅/预留占位。
              {project.venue.zones.length > 0 && (
                <> 红色虚线为项目提供的过道/消防出口禁止占用多边形，仅做几何检查，<b>不构成安全认证</b>。</>
              )}
            </div>
          </>
        )}
        {violations.length > 0 && (
          <div style={{ marginTop: 6, color: 'var(--danger)' }}>
            ⚠ {violations.length} 处桌子占地（含椅子余量）与禁止区域相交：{violatedNames}
            。仅几何提示，请由现场人员确认。
          </div>
        )}
        {overlaps.length > 0 && (
          <div style={{ marginTop: 4, color: 'var(--danger)' }}>
            ⚠ {overlaps.length} 对桌子占地（含椅子余量）相互重叠：
            {overlaps
              .map((o) => {
                const n = (id: string) => project.venue.tables.find((t) => t.id === id)?.name ?? '';
                return `${n(o.a)}↔${n(o.b)}`;
              })
              .join('、')}
          </div>
        )}
        {selectedSeat && !layoutMode && (
          <SeatActions
            project={project}
            sel={selectedSeat}
            store={store}
            onDone={() => setSelectedSeat(null)}
            notify={notify}
            onEditGuest={(id) => onSelectGuest(id)}
          />
        )}
      </div>

      <div className="legend">
        <span><i className="sw" style={{ background: COLORS.move }} />方案新位</span>
        <span><i className="sw" style={{ background: COLORS.stay }} />不变</span>
        <span><i className="sw" style={{ background: COLORS.leave }} />方案中移出</span>
        <span><i className="sw" style={{ background: COLORS.locked }} />锁定座</span>
        <span><i className="sw" style={{ background: COLORS.zone }} />禁止占用</span>
      </div>

      <Stage
        width={size.w}
        height={size.h}
        scaleX={scale}
        scaleY={scale}
        x={(size.w - project.venue.width * scale) / 2}
        y={20}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={project.venue.width}
            height={project.venue.height}
            fill={COLORS.floor}
            stroke="#c9bfa3"
            cornerRadius={6}
          />

          {project.venue.zones.map((z) => {
            const pts = zoneToPts(z);
            const flat = pts.flatMap((p) => [p.x, p.y]);
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            return (
              <Group key={z.id} listening={false}>
                <Line points={flat} closed fill={COLORS.zone} stroke={COLORS.zoneStroke} dash={[8, 5]} strokeWidth={2} />
                <Text
                  x={cx - 80}
                  y={cy - 11}
                  width={160}
                  align="center"
                  text={`${z.kind === 'exit' ? '消防出口' : z.kind === 'aisle' ? '过道' : '禁区'}·${z.name}`}
                  fontSize={13}
                  fontStyle="bold"
                  fill={COLORS.zoneText}
                />
              </Group>
            );
          })}

          {project.venue.tables.map((t) => (
            <TableView
              key={t.id}
              table={t}
              project={project}
              byId={byId}
              layoutMode={layoutMode}
              violated={violationTables.has(t.id)}
              overlapped={overlapTables.has(t.id)}
              selectedSeat={selectedSeat}
              previewRow={previewSeats?.[t.id] ?? null}
              onSeatClick={onSeatClick}
              onEditTable={() => onEditTable(t)}
              onDragMoveEnd={(x, y, moved) => {
                if (!moved) return;
                commit(
                  (p) => {
                    const n = structuredClone(p);
                    const tt = n.venue.tables.find((x2) => x2.id === t.id)!;
                    tt.x = Math.max(tt.radius, Math.min(n.venue.width - tt.radius, x));
                    tt.y = Math.max(tt.radius, Math.min(n.venue.height - tt.radius, y));
                    return n;
                  },
                  { keepPlan: true },
                );
              }}
              onDragSeatEnd={(guestId, x, y) => {
                const best = nearestSeat(project, x, y);
                if (!best) {
                  notify('请拖到任意桌的座位标记上', 'error');
                  return;
                }
                commitSafe(() => seatGuest(project, guestId, best.tableId, best.seat), '已换座（Ctrl+Z 撤销）');
              }}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}

function nearestSeat(
  p: SeatingProject,
  x: number,
  y: number,
): SeatSel | null {
  let best: SeatSel & { d: number } | null = null;
  for (const t of p.venue.tables) {
    for (let i = 0; i < t.seats; i++) {
      const pos = seatPosition(t, i);
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d < 42 && (!best || d < best.d)) best = { tableId: t.id, seat: i, d };
    }
  }
  return best;
}

function SeatActions({
  project,
  sel,
  store,
  onDone,
  notify,
  onEditGuest,
}: {
  project: SeatingProject;
  sel: SeatSel;
  store: ProjectApi;
  onDone: () => void;
  notify: (m: string, k?: 'error' | 'ok') => void;
  onEditGuest: (id: string) => void;
}) {
  const { commit } = store;
  const gid = project.seats[sel.tableId]?.[sel.seat] ?? null;
  const locked = project.lockedSeats[sel.tableId]?.[sel.seat];
  const table = project.venue.tables.find((t) => t.id === sel.tableId);
  const guest = gid ? project.guests.find((g) => g.id === gid) : null;

  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="pill">
        {table?.name} · {sel.seat + 1} 号座{guest ? `：${guestLabel(guest)}` : '（空）'}
      </span>
      <button onClick={() => commit((p) => toggleSeatLock(p, sel.tableId, sel.seat), { keepPlan: true })}>
        {locked ? '解锁' : '锁定'}
      </button>
      {gid && !locked && (
        <>
          <button
            onClick={() => {
              try {
                commit((p) => unseatGuest(p, gid!));
                onDone();
                notify('已移出（Ctrl+Z 撤销）', 'ok');
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          >
            移出
          </button>
          <button onClick={() => onEditGuest(gid)}>编辑宾客</button>
        </>
      )}
      <button className="ghost" onClick={onDone}>关闭</button>
    </div>
  );
}

function TableView({
  table,
  project,
  byId,
  layoutMode,
  violated,
  overlapped,
  selectedSeat,
  previewRow,
  onSeatClick,
  onEditTable,
  onDragMoveEnd,
  onDragSeatEnd,
}: {
  table: VenueTable;
  project: SeatingProject;
  byId: Map<string, SeatingProject['guests'][number]>;
  layoutMode: boolean;
  violated: boolean;
  overlapped: boolean;
  selectedSeat: SeatSel | null;
  previewRow: (string | null)[] | null;
  onSeatClick: (tableId: string, seat: number, e: unknown) => void;
  onEditTable: () => void;
  onDragMoveEnd: (x: number, y: number, moved: boolean) => void;
  onDragSeatEnd: (guestId: string, x: number, y: number) => void;
}) {
  const row = project.seats[table.id] ?? new Array(table.seats).fill(null);
  const locks = project.lockedSeats[table.id] ?? new Array(table.seats).fill(false);
  const occupiedCount = row.filter(Boolean).length;
  const badGeom = violated || overlapped;
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <Group
      x={table.x}
      y={table.y}
      draggable={layoutMode && !table.positionLocked}
      onDragStart={(e) => {
        dragStart.current = { x: e.target.x(), y: e.target.y() };
      }}
      onDragEnd={(e) => {
        const start = dragStart.current;
        const moved = !!(start && Math.hypot(e.target.x() - start.x, e.target.y() - start.y) > 2);
        onDragMoveEnd(e.target.x(), e.target.y(), moved);
        if (moved) {
          // 拖拽后的合成 click 不应打开编辑弹窗
          e.cancelBubble = true;
        }
      }}
      onClick={(e) => {
        if (layoutMode && !e.evt.shiftKey) onEditTable();
      }}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage && layoutMode) {
          stage.container().style.cursor = table.positionLocked ? 'not-allowed' : 'move';
        }
      }}
    >
      {badGeom &&
        (table.shape === 'round' ? (
          <Circle radius={table.radius + 12} stroke={COLORS.violationStroke} strokeWidth={4} dash={[10, 6]} listening={false} />
        ) : (
          <Rect
            x={-table.radius - 10}
            y={-table.halfHeight - 10}
            width={table.radius * 2 + 20}
            height={table.halfHeight * 2 + 20}
            cornerRadius={10}
            stroke={COLORS.violationStroke}
            strokeWidth={4}
            dash={[10, 6]}
            listening={false}
          />
        ))}

      {table.shape === 'round' ? (
        <Circle
          radius={table.radius}
          fill={table.isHead ? COLORS.head : COLORS.table}
          stroke={badGeom ? COLORS.violationStroke : table.isHead ? COLORS.headStroke : COLORS.tableStroke}
          strokeWidth={badGeom ? 3 : 2}
          listening={layoutMode}
        />
      ) : (
        <Rect
          x={-table.radius}
          y={-table.halfHeight}
          width={table.radius * 2}
          height={table.halfHeight * 2}
          cornerRadius={8}
          fill={table.isHead ? COLORS.head : COLORS.table}
          stroke={badGeom ? COLORS.violationStroke : table.isHead ? COLORS.headStroke : COLORS.tableStroke}
          strokeWidth={badGeom ? 3 : 2}
          listening={layoutMode}
        />
      )}
      <Text
        x={-table.radius}
        y={-14}
        width={table.radius * 2}
        align="center"
        text={`${table.name}${table.isHead ? ' 👑' : ''}`}
        fontSize={14}
        fontStyle="bold"
        fill={COLORS.text}
        listening={false}
      />
      <Text
        x={-table.radius}
        y={5}
        width={table.radius * 2}
        align="center"
        text={`${occupiedCount}/${table.seats} 座${table.positionLocked ? ' 🔒' : ''}`}
        fontSize={11}
        fill="#7a6c58"
        listening={false}
      />

      {Array.from({ length: table.seats }, (_, i) => {
        const pos = seatPosition(table, i);
        const gid = row[i] ?? null;
        const g = gid ? byId.get(gid) ?? null : null;
        const locked = !!locks[i];
        const isSel = selectedSeat?.tableId === table.id && selectedSeat.seat === i;

        let fill = locked ? COLORS.locked : COLORS.seat;
        if (previewRow) {
          const previewGid = previewRow[i] ?? null;
          if (previewGid && gid === previewGid) fill = COLORS.stay;
          else if (previewGid) fill = COLORS.move;
          else if (gid) fill = COLORS.leave;
        }

        return (
          <Group
            key={i}
            x={pos.x - table.x}
            y={pos.y - table.y}
            draggable={!layoutMode && !!gid && !locked}
            listening={!layoutMode}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage && !layoutMode) stage.container().style.cursor = 'pointer';
            }}
            onClick={(e) => onSeatClick(table.id, i, e)}
            onDragEnd={(e) => {
              // 复位图形位置（数据驱动），用指针的场地坐标找目标座位
              e.target.position({ x: pos.x - table.x, y: pos.y - table.y });
              const stage = e.target.getStage();
              const ptr = stage?.getPointerPosition();
              if (!stage || !ptr) return;
              const sx = (ptr.x - stage.x()) / stage.scaleX();
              const sy = (ptr.y - stage.y()) / stage.scaleY();
              onDragSeatEnd(gid!, sx, sy);
            }}
          >
            <Circle
              radius={17}
              fill={fill}
              stroke={isSel ? '#2b2620' : locked ? COLORS.lockedStroke : COLORS.seatStroke}
              strokeWidth={isSel ? 2.5 : 1.2}
              dash={locked ? [3, 3] : undefined}
            />
            {g ? (
              <>
                <Text text={g.isChild ? '🧒' : '👤'} fontSize={10} x={-15} y={-18} listening={false} />
                <Text
                  text={guestLabel(g)}
                  fontSize={10}
                  fill={COLORS.text}
                  width={72}
                  x={-36}
                  y={4}
                  align="center"
                  ellipsis
                  listening={false}
                />
              </>
            ) : locked ? (
              <Text text="童" fontSize={10} x={-6} y={-6} fill="#7d6b54" listening={false} />
            ) : (
              <Text text={String(i + 1)} fontSize={9} x={-4} y={-6} fill="#b0a590" listening={false} />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
