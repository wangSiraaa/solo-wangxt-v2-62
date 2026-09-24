// ───────────────────────────────────────────────────────────────────────────
// 手工排座操作（纯函数：WeddingProject → WeddingProject）
// 全部返回新项目对象，便于压入撤销栈；锁定座位相关操作会被拒绝并返回原因。
// ───────────────────────────────────────────────────────────────────────────

import type {
  Guest,
  GuestRelation,
  ProximityStrength,
  SeatAssignment,
  TableDef,
  TablePreference,
  WeddingProject,
} from '../types';
import { uid } from './ids';

export interface ActionResult {
  project: WeddingProject;
  ok: boolean;
  reason?: string;
}

function clone(project: WeddingProject): WeddingProject {
  return structuredClone(project);
}

function touched(project: WeddingProject): WeddingProject {
  return { ...project, updatedAt: Date.now() };
}

export function findAssignment(project: WeddingProject, guestId: string) {
  return project.assignments.find((a) => a.guestId === guestId) ?? null;
}

export function seatAt(
  project: WeddingProject,
  tableId: string,
  seatIndex: number,
): SeatAssignment | null {
  return (
    project.assignments.find(
      (a) => a.tableId === tableId && a.seatIndex === seatIndex,
    ) ?? null
  );
}

function occupiedCount(project: WeddingProject, tableId: string): number {
  return project.assignments.filter((a) => a.tableId === tableId).length;
}

function firstFreeSeatIndex(project: WeddingProject, table: TableDef): number | null {
  const used = new Set(
    project.assignments
      .filter((a) => a.tableId === table.id)
      .map((a) => a.seatIndex),
  );
  for (let i = 0; i < table.capacity; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** 把宾客手工安排到桌（可指定座位序号，默认首个空位） */
export function seatGuest(
  project: WeddingProject,
  guestId: string,
  tableId: string,
  opts?: { seatIndex?: number; lock?: boolean },
): ActionResult {
  const table = project.tables.find((t) => t.id === tableId);
  if (!table) return { project, ok: false, reason: '桌子不存在' };

  const guest = project.guests.find((g) => g.id === guestId);
  if (!guest) return { project, ok: false, reason: '宾客不存在' };
  if (guest.rsvp === 'declined') {
    return { project, ok: false, reason: '该宾客已婉拒，不能安排座位' };
  }

  const current = findAssignment(project, guestId);
  const next = clone(project);

  const idx =
    opts?.seatIndex ??
    (() => {
      // 若挪回原桌原位
      if (current?.tableId === tableId) return current.seatIndex;
      return firstFreeSeatIndex(next, table);
    })();

  if (idx === null || idx === undefined) {
    return { project, ok: false, reason: `「${table.label}」已满` };
  }
  if (idx >= table.capacity) {
    return { project, ok: false, reason: '座位序号超出容量' };
  }

  const target = seatAt(next, tableId, idx);
  if (target) {
    if (target.locked) {
      return { project, ok: false, reason: '目标座位已锁定' };
    }
    if (target.childChair && !target.guestId) {
      return { project, ok: false, reason: '该座位是儿童椅占位' };
    }
  }

  // 从原位移除（锁定原位不允许手工移动，需先解锁）
  if (current) {
    if (current.locked) {
      return { project, ok: false, reason: '该宾客座位已锁定，请先解锁再移动' };
    }
    next.assignments = next.assignments.filter((a) => a.id !== current.id);
  }

  // 若目标有普通宾客，两人换位（目标宾客去源位/自动空位）
  if (target?.guestId) {
    const otherId = target.guestId;
    next.assignments = next.assignments.filter((a) => a.id !== target.id);
    if (current) {
      next.assignments.push({
        ...target,
        id: `seat:${otherId}`,
        tableId: current.tableId,
        seatIndex: current.seatIndex,
        guestId: otherId,
        locked: false,
      });
    } else {
      const free = firstFreeSeatIndex(next, table);
      if (free !== null) {
        next.assignments.push({
          ...target,
          id: `seat:${otherId}`,
          tableId: table.id,
          seatIndex: free,
          guestId: otherId,
          locked: false,
        });
      }
    }
  }

  next.assignments.push({
    id: `seat:${guestId}`,
    tableId,
    seatIndex: idx,
    guestId,
    childChair: guest.isChild,
    locked: opts?.lock ?? current?.locked ?? false,
  });

  return { project: touched(next), ok: true };
}

/** 把宾客撤下（回到侧栏未排座区） */
export function unseatGuest(project: WeddingProject, guestId: string): ActionResult {
  const current = findAssignment(project, guestId);
  if (!current) return { project, ok: true };
  if (current.locked) {
    return { project, ok: false, reason: '已锁定的座位不能撤下，请先解锁' };
  }
  const next = clone(project);
  next.assignments = next.assignments.filter((a) => a.guestId !== guestId);
  return { project: touched(next), ok: true };
}

/** 锁定 / 解锁宾客座位 */
export function setSeatLock(
  project: WeddingProject,
  guestId: string,
  locked: boolean,
): ActionResult {
  const current = findAssignment(project, guestId);
  if (!current) return { project, ok: false, reason: '宾客尚未入座' };
  const next = clone(project);
  const a = next.assignments.find((x) => x.guestId === guestId)!;
  a.locked = locked;
  return { project: touched(next), ok: true };
}

/** 在某桌添加儿童椅占位（给未登记为宾客的婴幼儿使用） */
export function addChildChair(project: WeddingProject, tableId: string): ActionResult {
  const table = project.tables.find((t) => t.id === tableId);
  if (!table) return { project, ok: false, reason: '桌子不存在' };
  if (occupiedCount(project, tableId) >= table.capacity) {
    return { project, ok: false, reason: `「${table.label}」已满` };
  }
  const next = clone(project);
  const idx = firstFreeSeatIndex(next, table);
  if (idx === null) return { project, ok: false, reason: '没有空位' };
  next.assignments.push({
    id: uid('chair'),
    tableId,
    seatIndex: idx,
    guestId: null,
    childChair: true,
    // 儿童椅占位默认锁定（属于手工布置，自动排座不能挪动）
    locked: true,
  });
  return { project: touched(next), ok: true };
}

export function removeChildChair(project: WeddingProject, assignmentId: string): ActionResult {
  const a = project.assignments.find((x) => x.id === assignmentId);
  if (!a) return { project, ok: false, reason: '座位不存在' };
  if (!a.childChair || a.guestId) {
    return { project, ok: false, reason: '仅可移除空的儿童椅占位' };
  }
  const next = clone(project);
  next.assignments = next.assignments.filter((x) => x.id !== assignmentId);
  return { project: touched(next), ok: true };
}

/** 移动桌子（场地几何检查由调用方在结果上再校验；这里只负责改坐标） */
export function moveTable(
  project: WeddingProject,
  tableId: string,
  x: number,
  y: number,
): ActionResult {
  const next = clone(project);
  const t = next.tables.find((x2) => x2.id === tableId);
  if (!t) return { project, ok: false, reason: '桌子不存在' };
  t.x = Math.round(x);
  t.y = Math.round(y);
  return { project: touched(next), ok: true };
}

export function updateTable(
  project: WeddingProject,
  tableId: string,
  patch: Partial<TableDef>,
): ActionResult {
  const next = clone(project);
  const t = next.tables.find((x) => x.id === tableId);
  if (!t) return { project, ok: false, reason: '桌子不存在' };
  Object.assign(t, patch);
  // 容量缩小时，超出的座位分配保留但会在校验中提示
  return { project: touched(next), ok: true };
}

export function addTable(project: WeddingProject, table: TableDef): ActionResult {
  const next = clone(project);
  next.tables.push(table);
  return { project: touched(next), ok: true };
}

/** 应用一份自动方案（只替换未锁定部分；锁定的分配原样保留） */
export function applyAutoAssignments(
  project: WeddingProject,
  auto: SeatAssignment[],
): WeddingProject {
  const next = clone(project);
  const locked = next.assignments.filter((a) => a.locked);
  next.assignments = [...locked, ...auto.filter((a) => !a.locked)];
  return touched(next);
}

// ── 宾客/关系/忌口的数据维护 ────────────────────────────────────────────────

export function addGuest(
  project: WeddingProject,
  guest: Omit<Guest, 'displayName'> & { displayName?: string },
): WeddingProject {
  const next = clone(project);
  const sameCount = next.guests.filter((g) => g.name === guest.name).length;
  const full: Guest = {
    ...guest,
    displayName: sameCount === 0 ? guest.name : `${guest.name} #${sameCount + 1}`,
  } as Guest;
  next.guests.push(full);
  return touched(next);
}

export function updateGuest(
  project: WeddingProject,
  guestId: string,
  patch: Partial<Guest>,
): WeddingProject {
  const next = clone(project);
  const g = next.guests.find((x) => x.id === guestId);
  if (g) Object.assign(g, patch);
  return touched(next);
}

export function removeGuest(project: WeddingProject, guestId: string): WeddingProject {
  const next = clone(project);
  next.guests = next.guests.filter((g) => g.id !== guestId);
  next.relations = next.relations.filter(
    (r) => r.guestA !== guestId && r.guestB !== guestId,
  );
  next.tablePreferences = next.tablePreferences.filter((p) => p.guestId !== guestId);
  next.assignments = next.assignments.filter((a) => a.guestId !== guestId);
  // 注意：不删除 dietary —— 忌口独立存储，删宾客时保留以备导出/审计
  return touched(next);
}

// ── 关系 / 偏好维护 ─────────────────────────────────────────────────────────

export function addRelation(
  project: WeddingProject,
  rel: Omit<GuestRelation, 'id'>,
): WeddingProject {
  const next = clone(project);
  const exists = next.relations.some(
    (r) =>
      ((r.guestA === rel.guestA && r.guestB === rel.guestB) ||
        (r.guestA === rel.guestB && r.guestB === rel.guestA)) &&
      r.kind === rel.kind,
  );
  if (!exists) {
    next.relations.push({ ...rel, id: uid('rel') });
  }
  return touched(next);
}

export function deleteRelation(project: WeddingProject, id: string): WeddingProject {
  const next = clone(project);
  next.relations = next.relations.filter((r) => r.id !== id);
  return touched(next);
}

export function addTablePreference(
  project: WeddingProject,
  guestId: string,
  tableId: string | undefined,
  strength: ProximityStrength = 'near',
): WeddingProject {
  const next = clone(project);
  const exists = next.tablePreferences.some(
    (p) => p.guestId === guestId && (p.tableId ?? null) === (tableId ?? null),
  );
  if (!exists) {
    const pref: TablePreference = {
      id: uid('pref'),
      guestId,
      tableId,
      strength,
      weight: 6,
    };
    next.tablePreferences.push(pref);
  }
  return touched(next);
}

export function deleteTablePreference(project: WeddingProject, id: string): WeddingProject {
  const next = clone(project);
  next.tablePreferences = next.tablePreferences.filter((p) => p.id !== id);
  return touched(next);
}
