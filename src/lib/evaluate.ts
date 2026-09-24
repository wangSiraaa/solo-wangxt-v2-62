// 对"已有席位方案"做软代价评估（手工方案也能显示代价，与自动方案口径一致）。

import type { CostBreakdown, SeatingProject } from '../types';
import { penaltyConfig } from './model';
import { seatedGuestIds } from './apply';

export function evaluateCurrent(p: SeatingProject): CostBreakdown {
  const P = penaltyConfig();
  const cost: CostBreakdown = { near: 0, like: 0, dislike: 0, unseated: 0, total: 0 };

  const tableOf = new Map<string, string>();
  for (const t of p.venue.tables) {
    for (const gid of p.seats[t.id] ?? []) if (gid) tableOf.set(gid, t.id);
  }

  for (const r of p.relations) {
    const ta = tableOf.get(r.a);
    const tb = tableOf.get(r.b);
    const together = ta && tb && ta === tb;
    if (r.kind === 'like' && !together) cost.like += P.like;
    if (r.kind === 'dislike' && together) cost.dislike += P.dislike;
    // same/apart 为硬条件，违反时通过硬冲突计数提示（不计软代价）
  }

  const head = p.venue.tables.find((t) => t.isHead) ?? null;
  if (head) {
    const rank = new Map<string, number>();
    rank.set(head.id, 0);
    [...p.venue.tables]
      .filter((t) => t.id !== head.id)
      .map((t) => ({ id: t.id, d: Math.hypot(t.x - head.x, t.y - head.y) }))
      .sort((a, b) => a.d - b.d)
      .forEach((t, i) => rank.set(t.id, i + 1));
    for (const n of p.nearPrefs) {
      const t = tableOf.get(n.guestId);
      if (t) cost.near += (rank.get(t) ?? 0) * P.nearPerStep;
    }
  }

  const seated = seatedGuestIds(p);
  const active = p.guests.filter(
    (g) => g.rsvp === 'accepted' || (p.includePending && g.rsvp === 'pending'),
  );
  cost.unseated = active.filter((g) => !seated.has(g.id)).length * P.unseated;
  cost.total = cost.near + cost.like + cost.dislike + cost.unseated;
  return cost;
}

/** 当前方案中被违反的硬条件（用于工具栏警示） */
export function hardViolations(p: SeatingProject): string[] {
  const out: string[] = new Array<string>();
  const tableOf = new Map<string, string>();
  for (const t of p.venue.tables) {
    for (const gid of p.seats[t.id] ?? []) if (gid) tableOf.set(gid, t.id);
  }
  const name = (id: string) => p.guests.find((g) => g.id === id)?.name ?? id;

  // 家庭硬同桌
  const famGuests = new Map<string, string[]>();
  for (const g of p.guests) {
    if (!g.familyId) continue;
    const arr = famGuests.get(g.familyId) ?? [];
    arr.push(g.id);
    famGuests.set(g.familyId, arr);
  }
  for (const [fid, ids] of famGuests) {
    const fname = p.families.find((f) => f.id === fid)?.name ?? '家庭';
    const tables = new Set(ids.map((id) => tableOf.get(id)).filter(Boolean));
    if (tables.size > 1) out.push(`家庭「${fname}」成员被分到了不同桌`);
  }
  for (const r of p.relations) {
    const ta = tableOf.get(r.a);
    const tb = tableOf.get(r.b);
    if (r.kind === 'same' && ta && tb && ta !== tb) {
      out.push(`必须同桌：${name(r.a)} 与 ${name(r.b)} 被分开`);
    }
    if (r.kind === 'apart' && ta && tb && ta === tb) {
      out.push(`必须分桌：${name(r.a)} 与 ${name(r.b)} 同桌`);
    }
  }
  // 容量
  for (const t of p.venue.tables) {
    const n = (p.seats[t.id] ?? []).filter(Boolean).length;
    if (n > t.seats) out.push(`「${t.name}」超员（${n}/${t.seats}）`);
  }
  return out;
}
