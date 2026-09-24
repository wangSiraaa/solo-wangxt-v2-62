// 手工席位操作（纯函数式更新，配合 store.commit 使用）

import type { Guest, SeatingProject } from '../types';
import { nextNameSeq, uid } from './ids';

function ensureSeats(p: SeatingProject, tableId: string): (string | null)[] {
  if (!p.seats[tableId]) p.seats[tableId] = [];
  const t = p.venue.tables.find((x) => x.id === tableId);
  const n = t?.seats ?? p.seats[tableId].length;
  const row = p.seats[tableId];
  while (row.length < n) row.push(null);
  if (row.length > n) row.length = n;
  if (!p.lockedSeats[tableId]) p.lockedSeats[tableId] = new Array(n).fill(false);
  const locks = p.lockedSeats[tableId];
  while (locks.length < n) locks.push(false);
  return row;
}

export function findGuestSeat(
  p: SeatingProject,
  guestId: string,
): { tableId: string; seat: number } | null {
  for (const t of p.venue.tables) {
    const row = p.seats[t.id] ?? [];
    const i = row.indexOf(guestId);
    if (i >= 0) return { tableId: t.id, seat: i };
  }
  return null;
}

/** 手工落座。锁定座位不可被覆盖；返回失败原因（用于 UI 提示） */
export function seatGuest(
  prev: SeatingProject,
  guestId: string,
  tableId: string,
  seat?: number,
): SeatingProject {
  const p: SeatingProject = structuredClone(prev);
  const cur = findGuestSeat(p, guestId);
  const targetRow = ensureSeats(p, tableId);
  const targetLocks = p.lockedSeats[tableId];

  let idx = seat;
  if (idx === undefined) {
    idx = targetRow.findIndex((g, i) => g === null && !targetLocks[i]);
    if (idx < 0) throw new Error('该桌没有空位（锁定座位与儿童椅占位不可占用）');
  } else {
    if (targetLocks[idx]) throw new Error('该座位已锁定，不能放入');
  }

  const occupant = targetRow[idx];

  // 从原位移除
  if (cur) {
    if (p.lockedSeats[cur.tableId]?.[cur.seat]) {
      throw new Error('该宾客的座位已锁定，不能移动（请先解锁）');
    }
    p.seats[cur.tableId][cur.seat] = null;
  }

  // 若目标位已有宾客，把被挤者换到移动者原位（交换）
  if (occupant && occupant !== guestId) {
    if (cur) {
      p.seats[cur.tableId][cur.seat] = occupant;
      if (p.lockedSeats[cur.tableId]?.[cur.seat]) {
        // 不应发生（移动者在锁定位已被拦截）
      }
    } else {
      // 直接放到一个空位；没有空位则放回，报错
      const anywhere = p.venue.tables.find((t) => {
        const row = ensureSeats(p, t.id);
        return row.some((g, i) => g === null && !p.lockedSeats[t.id][i]);
      });
      if (!anywhere) throw new Error('没有可交换的空位');
      const row = ensureSeats(p, anywhere.id);
      const k = row.findIndex((g, i) => g === null && !p.lockedSeats[anywhere.id][i]);
      row[k] = occupant;
    }
  }

  targetRow[idx] = guestId;
  return p;
}

/** 移除席位（回到未排座侧栏）。锁定座位需先解锁。 */
export function unseatGuest(prev: SeatingProject, guestId: string): SeatingProject {
  const cur = findGuestSeat(prev, guestId);
  if (!cur) return prev;
  if (prev.lockedSeats[cur.tableId]?.[cur.seat]) {
    throw new Error('座位已锁定，不能移除（请先解锁）');
  }
  const p = structuredClone(prev);
  p.seats[cur.tableId][cur.seat] = null;
  return p;
}

export function toggleSeatLock(
  prev: SeatingProject,
  tableId: string,
  seat: number,
): SeatingProject {
  const p = structuredClone(prev);
  ensureSeats(p, tableId);
  p.lockedSeats[tableId][seat] = !p.lockedSeats[tableId][seat];
  return p;
}

export function addGuest(
  prev: SeatingProject,
  data: Partial<Guest> & { name: string },
): SeatingProject {
  const p = structuredClone(prev);
  const g: Guest = {
    id: uid('g'),
    name: data.name.trim(),
    nameSeq: nextNameSeq(p.guests, data.name.trim()),
    familyId: data.familyId ?? null,
    rsvp: data.rsvp ?? 'accepted',
    isChild: data.isChild ?? false,
    dietary: data.dietary ?? '',
    tags: data.tags ?? '',
  };
  p.guests.push(g);
  return p;
}

export function updateGuest(prev: SeatingProject, guestId: string, patch: Partial<Guest>): SeatingProject {
  const p = structuredClone(prev);
  const g = p.guests.find((x) => x.id === guestId);
  if (g) Object.assign(g, patch);
  // 忌口直接改在 guest 上——与席位完全独立
  return p;
}

export function removeGuest(prev: SeatingProject, guestId: string): SeatingProject {
  const p = structuredClone(prev);
  p.guests = p.guests.filter((g) => g.id !== guestId);
  p.relations = p.relations.filter((r) => r.a !== guestId && r.b !== guestId);
  p.nearPrefs = p.nearPrefs.filter((n) => n.guestId !== guestId);
  for (const t of p.venue.tables) {
    const row = p.seats[t.id] ?? [];
    const i = row.indexOf(guestId);
    if (i >= 0) row[i] = null;
  }
  return p;
}
