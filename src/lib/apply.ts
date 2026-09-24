// 自动方案 -> 工程 seats 的合并：锁定座位完全不动；
// 未参与求解的宾客（declined / pending 未纳入）保持原位或回到未排座。

import type { SeatingProject, SolveAssignment } from '../types';

export function applyAssignment(
  p: SeatingProject,
  assignment: SolveAssignment[],
): {
  seats: Record<string, (string | null)[]>;
  unseatedGuestIds: string[];
} {
  const seats: Record<string, (string | null)[]> = {};
  for (const t of p.venue.tables) seats[t.id] = new Array(t.seats).fill(null);

  // 1) 锁定座位原样保留（宾客与空座占位都保留）
  const lockedGuestAt = new Map<string, { table: string; seat: number }>();
  for (const t of p.venue.tables) {
    const row = p.seats[t.id] ?? new Array(t.seats).fill(null);
    const locks = p.lockedSeats[t.id] ?? [];
    for (let i = 0; i < t.seats; i++) {
      if (locks[i]) {
        seats[t.id][i] = row[i] ?? null; // null 也保留：儿童椅/预留占位
        const gid = row[i];
        if (gid) lockedGuestAt.set(gid, { table: t.id, seat: i });
      }
    }
  }

  // 2) 未锁定、但也不在本次方案中的宾客：原先在非锁定座位的内容清空
  //    （declined / 未纳入的 pending 不应占座）
  const solvedGuests = new Set(assignment.map((a) => a.guestId));

  // 3) 按桌顺序填空座；若同一宾客在 assignment 中给了具体座位则尊重
  const byTable = new Map<string, SolveAssignment[]>();
  for (const a of assignment) {
    const arr = byTable.get(a.tableId) ?? [];
    arr.push(a);
    byTable.set(a.tableId, arr);
  }

  const unseatedGuestIds: string[] = [];
  const placed = new Set<string>();

  for (const t of p.venue.tables) {
    const row = seats[t.id];
    const locks = p.lockedSeats[t.id] ?? [];
    const freeIndexes: number[] = [];
    for (let i = 0; i < t.seats; i++) if (!locks[i]) freeIndexes.push(i);

    const list = byTable.get(t.id) ?? [];
    // 先放指定座位
    for (const a of list) {
      if (lockedGuestAt.has(a.guestId)) continue; // 锁定客已在原位
      if (a.seatIndex >= 0 && freeIndexes.includes(a.seatIndex) && row[a.seatIndex] === null) {
        row[a.seatIndex] = a.guestId;
        placed.add(a.guestId);
      }
    }
    // 其余顺序填空
    let cursor = 0;
    for (const a of list) {
      if (placed.has(a.guestId) || lockedGuestAt.has(a.guestId)) continue;
      while (cursor < freeIndexes.length && row[freeIndexes[cursor]] !== null) cursor++;
      if (cursor >= freeIndexes.length) {
        unseatedGuestIds.push(a.guestId);
        continue;
      }
      row[freeIndexes[cursor]] = a.guestId;
      placed.add(a.guestId);
      cursor++;
    }
  }

  // assignment 里未出现、又没锁定的活跃宾客若原本有座会自然清空（seats 重建自锁定态）
  void solvedGuests;

  return { seats, unseatedGuestIds };
}

/** 当前已入座宾客 id 集合 */
export function seatedGuestIds(p: SeatingProject): Set<string> {
  const s = new Set<string>();
  for (const t of p.venue.tables) for (const g of p.seats[t.id] ?? []) if (g) s.add(g);
  return s;
}
