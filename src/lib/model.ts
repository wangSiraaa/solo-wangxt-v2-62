// 从工程状态构建 MILP 问题；同时做无需求解即可判定的硬冲突预检。

import type {
  Diagnostics,
  SeatingProject,
  SolveProblem,
} from '../types';

const PENALTY = {
  /** 未排座（pending 不参与时不会出现；容量不足时启用） */
  unseated: 100,
  /** 希望同桌未满足 */
  like: 20,
  /** 希望分开未满足 */
  dislike: 25,
  /** 靠近主桌偏好：每"远离一桌距离档" */
  nearPerStep: 5,
};

export function penaltyConfig() {
  return { ...PENALTY };
}

export function buildSolveInput(p: SeatingProject): {
  problem: SolveProblem;
  diagnostics: Diagnostics;
} {
  // 参与自动排座的宾客：accepted 必参加；pending 按开关决定；declined 从不
  const activeGuests = p.guests.filter(
    (g) => g.rsvp === 'accepted' || (p.includePending && g.rsvp === 'pending'),
  );
  const activeIds = new Set(activeGuests.map((g) => g.id));

  const head = p.venue.tables.find((t) => t.isHead) ?? null;

  // 锁定信息：锁定座位上的宾客必须留在原桌；锁定的空座不可占用
  const tables = p.venue.tables.map((t) => {
    const row = p.seats[t.id] ?? new Array(t.seats).fill(null);
    const locks = p.lockedSeats[t.id] ?? [];
    const lockedGuests: string[] = [];
    let lockedSeatCount = 0;
    for (let i = 0; i < t.seats; i++) {
      if (locks[i]) {
        lockedSeatCount++;
        const gid = row[i] ?? null;
        if (gid && activeIds.has(gid)) lockedGuests.push(gid);
      }
    }
    return {
      id: t.id,
      x: t.x,
      y: t.y,
      seats: t.seats,
      lockedGuests,
      lockedSeatCount,
    };
  });

  // 锁定宾客所在桌查表
  const lockTable = new Map<string, string>();
  for (const t of tables) for (const gid of t.lockedGuests) lockTable.set(gid, t.id);

  const pairOf = (a: string, b: string): [string, string] | null =>
    activeIds.has(a) && activeIds.has(b) ? [a, b] : null;

  const samePairs: [string, string][] = [];
  const apartPairs: [string, string][] = [];
  const likePairs: [string, string][] = [];
  const dislikePairs: [string, string][] = [];

  // 家庭同行 = 硬同桌（同家庭两两）
  const byFamily = new Map<string, string[]>();
  for (const g of activeGuests) {
    if (!g.familyId) continue;
    const arr = byFamily.get(g.familyId) ?? [];
    arr.push(g.id);
    byFamily.set(g.familyId, arr);
  }
  for (const ids of byFamily.values()) {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) samePairs.push([ids[i], ids[j]]);
  }

  for (const r of p.relations) {
    const pr = pairOf(r.a, r.b);
    if (!pr) continue;
    if (r.kind === 'same') samePairs.push(pr);
    else if (r.kind === 'apart') apartPairs.push(pr);
    else if (r.kind === 'like') likePairs.push(pr);
    else dislikePairs.push(pr);
  }

  const nearGuestIds = p.nearPrefs.map((n) => n.guestId).filter((id) => activeIds.has(id));

  const problem: SolveProblem = {
    guests: activeGuests.map((g) => ({ id: g.id })),
    tables,
    headTableId: head?.id ?? null,
    samePairs,
    apartPairs,
    likePairs,
    dislikePairs,
    nearGuestIds,
  };

  return { problem, diagnostics: preDiagnose(problem) };
}

/**
 * 不求解的硬冲突预检（样例"无解"场景的可读原因）：
 * 1) 硬 same / apart 矛盾三角（A同B、B同C、A分C）
 * 2) 锁定与硬条件冲突（锁在不同桌却必须同桌；锁同桌却必须分桌）
 * 3) 某 same 连通块人数超过任何单桌容量
 * 4) 总容量（扣除锁定空座）不足
 */
export function preDiagnose(s: SolveProblem): Diagnostics {
  const reasons: string[] = [];
  const gids = s.guests.map((g) => g.id);
  const set = new Set(gids);

  // 并查集
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    parent.set(x, parent.get(x) ?? x);
    const r = parent.get(x)!;
    if (r === x) return x;
    const top = find(r);
    parent.set(x, top);
    return top;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  gids.forEach(find);
  for (const [a, b] of s.samePairs) if (set.has(a) && set.has(b)) union(a, b);

  const lockTable = new Map<string, string>();
  for (const t of s.tables) for (const gid of t.lockedGuests) lockTable.set(gid, t.id);

  // apart 落在同一 same 连通块 => 无解
  for (const [a, b] of s.apartPairs) {
    if (set.has(a) && set.has(b) && find(a) === find(b)) {
      reasons.push(`硬冲突：宾客必须同桌又必须分桌（${a} ↔ ${b} 的关系链矛盾）`);
    }
    const ta = lockTable.get(a);
    const tb = lockTable.get(b);
    if (ta && tb && ta === tb) {
      reasons.push(`硬冲突：已锁定同桌，但存在必须分桌关系（${a} ↔ ${b}）`);
    }
  }

  // same 但锁在不同桌
  for (const [a, b] of s.samePairs) {
    const ta = lockTable.get(a);
    const tb = lockTable.get(b);
    if (ta && tb && ta !== tb) {
      reasons.push(`硬冲突：必须同桌，但双方已锁定在不同桌（${a} ↔ ${b}）`);
    }
  }

  // same 连通块 vs 容量
  const groups = new Map<string, string[]>();
  for (const id of gids) {
    const root = find(id);
    const arr = groups.get(root) ?? [];
    arr.push(id);
    groups.set(root, arr);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    // 组内锁定桌必须一致（上面已报），容量按可去的桌考虑
    const lockedHere = ids
      .map((id) => lockTable.get(id))
      .filter((v): v is string => !!v);
    const lockedTable = lockedHere[0] ?? null;
    let maxCap: number;
    if (lockedTable) {
      const t = s.tables.find((x) => x.id === lockedTable)!;
      maxCap = t.seats;
    } else {
      maxCap = Math.max(...s.tables.map((t) => t.seats));
    }
    if (ids.length > maxCap) {
      reasons.push(
        `硬冲突：必须同桌的一组有 ${ids.length} 人，但${
          lockedTable ? '锁定桌' : '最大桌'
        }只有 ${maxCap} 座`,
      );
    }
  }

  // 总容量：扣除全部锁定座位
  const totalCap = s.tables.reduce((n, t) => n + (t.seats - t.lockedSeatCount), 0);
  // 锁定宾客已占锁定座（已在扣除中），其余宾客需要空座
  const lockedGuests = new Set(lockTable.keys());
  const needSeats = gids.filter((id) => !lockedGuests.has(id)).length;
  if (needSeats > totalCap) {
    reasons.push(`硬冲突：需要 ${needSeats} 个可用座位，但只剩 ${totalCap} 座（含锁定/儿童椅占位）`);
  }

  return { feasible: reasons.length === 0, reasons };
}

