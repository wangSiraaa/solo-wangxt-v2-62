// MILP 求解核心（无 DOM 依赖，Worker / Node 共用）
//
// 变量：
//   x_{g}_{table} ∈ {0,1}   宾客 g 分到该桌
//   u_g            ∈ {0,1}   宾客 g 未排座（容量性无解时的高代价松弛）
//   s_like_k       ∈ {0,1}   like 软条件未满足（不同桌）
//   s_dis_k        ∈ {0,1}   dislike 软条件未满足（同桌）
//   s_near_g       整数 0..K 靠近主桌偏好的距离档（越小越近）
//
// 硬条件（家庭/显式 same 同桌、apart 分桌、容量、锁定）直接写约束。
// 软条件进目标函数，并返回代价明细供 UI 展示。
//
// preDiagnose 先做关系矛盾预检；MILP 内保留 unseated 松弛变量，
// 使预检未覆盖的非平凡无解也能返回信息而不是直接失败。
// 本函数只决定"宾客 -> 桌"；具体座位号由应用层在保留锁定座位的前提下填充。

import type { CostBreakdown, SolveAssignment, SolveProblem } from '../types';
import { penaltyConfig } from './model';

// GLPK 数值常量（glpk.js 浏览器 Worker 版不导出这些常量，这里固定为其标准值）
export const GLP = {
  GLP_MIN: 1,
  GLP_LO: 2,
  GLP_UP: 3,
  GLP_DB: 4,
  GLP_FX: 5,
  GLP_OPT: 5,
} as const;

export interface SolveResultRaw {
  result: {
    status: number;
    z: number;
    vars: Record<string, number>;
  };
}

export type SolveFn = (lp: unknown, opts?: unknown) => SolveResultRaw | Promise<SolveResultRaw>;

interface ConSpec {
  name: string;
  vars: { name: string; coef: number }[];
  bnds: { type: number; lb?: number; ub?: number };
}

export interface SolveOutcome {
  assignment: SolveAssignment[];
  cost: CostBreakdown;
  /** 被松弛掉的宾客（容量不足时） */
  unseatedGuests: string[];
  glpkStatus: number;
}

export async function solveMILP(
  solve: SolveFn,
  problem: SolveProblem,
  timeoutMs: number,
): Promise<SolveOutcome> {
  const P = penaltyConfig();
  const guests = problem.guests;
  const tables = problem.tables;
  const guestIds = guests.map((g) => g.id);
  const tableIds = tables.map((t) => t.id);

  const lockedTable = new Map<string, string>();
  for (const t of tables) for (const gid of t.lockedGuests) lockedTable.set(gid, t.id);

  // 距主桌距离档：head=0，其余按欧氏距离升序 1..K
  const rank = new Map<string, number>();
  const head = tables.find((t) => t.id === problem.headTableId) ?? null;
  if (head) {
    rank.set(head.id, 0);
    const others = tables
      .filter((t) => t.id !== head.id)
      .map((t) => ({ id: t.id, d: Math.hypot(t.x - head.x, t.y - head.y) }))
      .sort((a, b) => a.d - b.d);
    others.forEach((t, i) => rank.set(t.id, i + 1));
  }
  const maxRank = Math.max(1, tableIds.length - 1);

  const xName = (g: string, t: string) => `x__${g}__${t}`;
  const uName = (g: string) => `u__${g}`;
  const likeName = (k: number) => `sl__${k}`;
  const dislikeName = (k: number) => `sd__${k}`;
  const nearName = (g: string) => `sn__${g}`;

  const variables: { name: string; coef: number; lb?: number; ub?: number; integer?: boolean }[] = [];
  const constraints: ConSpec[] = [];

  const allowedTables = (g: string) => {
    const lt = lockedTable.get(g);
    return lt ? [lt] : tableIds;
  };

  // x 变量：锁定宾客只生成锁定桌的变量，模型上保证自动排座无法移动
  for (const g of guestIds) {
    for (const t of allowedTables(g)) {
      variables.push({ name: xName(g, t), coef: 0 });
    }
  }
  // 未排座松弛（锁定宾客不生成：其锁定位必须保住）
  for (const g of guestIds) {
    if (!lockedTable.has(g)) variables.push({ name: uName(g), coef: P.unseated });
  }

  // 1) 每位宾客：sum x = 1（锁定宾客）；sum x + u = 1（其余）
  for (const g of guestIds) {
    const vars = allowedTables(g).map((t) => ({ name: xName(g, t), coef: 1 }));
    if (lockedTable.has(g)) {
      constraints.push({ name: `assign__${g}`, vars, bnds: { type: GLP.GLP_FX, lb: 1, ub: 1 } });
    } else {
      vars.push({ name: uName(g), coef: 1 });
      constraints.push({ name: `assign__${g}`, vars, bnds: { type: GLP.GLP_FX, lb: 1, ub: 1 } });
    }
  }

  // 2) 容量：锁定宾客占锁定座位（已扣除），只有非锁定宾客的 x 计入自由座位预算；
  //    lockedSeatCount 同时覆盖"锁定空座"——儿童椅占位/预留位不可被自动排座使用
  for (const t of tables) {
    const free = t.seats - t.lockedSeatCount;
    const vars = guestIds
      .filter((g) => !lockedTable.has(g))
      .map((g) => ({ name: xName(g, t.id), coef: 1 }));
    constraints.push({ name: `cap__${t.id}`, vars, bnds: { type: GLP.GLP_UP, ub: free } });
  }

  // 对每对宾客，约束只需在"双方都可能落位"的桌上生成；
  // 锁定冲突（必须同桌却锁不同桌/必须分桌却同桌）由 preDiagnose 报告并中止求解。
  const pairTables = (a: string, b: string): string[] => {
    const ta = lockedTable.get(a);
    const tb = lockedTable.get(b);
    if (ta && tb) return ta === tb ? [ta] : [];
    if (ta) return tableIds.filter((t) => t === ta);
    if (tb) return tableIds.filter((t) => t === tb);
    return tableIds;
  };

  // 3) 硬同桌：x[a,t] = x[b,t]
  problem.samePairs.forEach(([a, b], k) => {
    for (const t of pairTables(a, b)) {
      constraints.push({
        name: `same__${k}__${t}`,
        vars: [
          { name: xName(a, t), coef: 1 },
          { name: xName(b, t), coef: -1 },
        ],
        bnds: { type: GLP.GLP_FX, lb: 0, ub: 0 },
      });
    }
  });

  // 4) 硬分桌：x[a,t] + x[b,t] ≤ 1
  problem.apartPairs.forEach(([a, b], k) => {
    for (const t of pairTables(a, b)) {
      constraints.push({
        name: `apart__${k}__${t}`,
        vars: [
          { name: xName(a, t), coef: 1 },
          { name: xName(b, t), coef: 1 },
        ],
        bnds: { type: GLP.GLP_UP, ub: 1 },
      });
    }
  });

  // 5) 软同桌 like：不同桌时 s=1，-s ≤ x[a,t]-x[b,t] ≤ s
  problem.likePairs.forEach(([a, b], k) => {
    const s = likeName(k);
    variables.push({ name: s, coef: P.like });
    for (const t of pairTables(a, b)) {
      const xa = { name: xName(a, t), coef: 1 };
      const xb = { name: xName(b, t), coef: 1 };
      constraints.push({
        name: `likeA__${k}__${t}`,
        vars: [xa, { ...xb, coef: -1 }, { name: s, coef: -1 }],
        bnds: { type: GLP.GLP_UP, ub: 0 },
      });
      constraints.push({
        name: `likeB__${k}__${t}`,
        vars: [xb, { ...xa, coef: -1 }, { name: s, coef: -1 }],
        bnds: { type: GLP.GLP_UP, ub: 0 },
      });
    }
  });

  // 6) 软分开 dislike：同桌时 s=1，x[a,t] + x[b,t] ≤ 1 + s
  problem.dislikePairs.forEach(([a, b], k) => {
    const s = dislikeName(k);
    variables.push({ name: s, coef: P.dislike });
    for (const t of pairTables(a, b)) {
      constraints.push({
        name: `dis__${k}__${t}`,
        vars: [
          { name: xName(a, t), coef: 1 },
          { name: xName(b, t), coef: 1 },
          { name: s, coef: -1 },
        ],
        bnds: { type: GLP.GLP_UP, ub: 1 },
      });
    }
  });

  // 7) 靠近主桌：s ≥ rank(t)·x，最小化 s 即优先近桌
  if (head) {
    for (const g of problem.nearGuestIds) {
      const s = nearName(g);
      variables.push({ name: s, coef: P.nearPerStep, lb: 0, ub: maxRank, integer: true });
      for (const t of tableIds) {
        const r = rank.get(t) ?? 0;
        if (r === 0) continue;
        constraints.push({
          name: `near__${g}__${t}`,
          vars: [
            { name: s, coef: 1 },
            { name: xName(g, t), coef: -r },
          ],
          bnds: { type: GLP.GLP_LO, lb: 0 },
        });
      }
    }
  }

  const lp = {
    name: 'wedding-seating',
    objective: {
      direction: GLP.GLP_MIN,
      name: 'cost',
      vars: variables.map((v) => ({ name: v.name, coef: v.coef })),
    },
    subjectTo: constraints,
    variables: variables.map((v) => ({
      name: v.name,
      bnds: v.integer
        ? { type: GLP.GLP_DB, lb: v.lb ?? 0, ub: v.ub ?? 1 }
        : { type: GLP.GLP_DB, lb: 0, ub: 1 },
    })),
    binaries: variables.filter((v) => !v.integer).map((v) => v.name),
    generals: variables.filter((v) => v.integer).map((v) => v.name),
  };

  const maybe = solve(lp, {
    msglev: 0,
    presol: true,
    tmlim: Math.max(1, Math.round(timeoutMs / 1000)),
  });
  const res = maybe instanceof Promise ? await maybe : maybe;
  const vals = res.result.vars;
  const round = (n: number) => (Math.abs(n - Math.round(n)) < 1e-5 ? Math.round(n) : n);

  const assignment: SolveAssignment[] = [];
  const unseatedGuests: string[] = [];
  for (const g of guestIds) {
    const u = vals[uName(g)];
    if (u !== undefined && round(u) === 1) {
      unseatedGuests.push(g);
      continue;
    }
    for (const t of allowedTables(g)) {
      if (round(vals[xName(g, t)] ?? 0) === 1) {
        assignment.push({ guestId: g, tableId: t, seatIndex: -1 });
        break;
      }
    }
  }

  const cost: CostBreakdown = { near: 0, like: 0, dislike: 0, unseated: 0, total: 0 };
  problem.likePairs.forEach((_, k) => {
    cost.like += round(vals[likeName(k)] ?? 0) * P.like;
  });
  problem.dislikePairs.forEach((_, k) => {
    cost.dislike += round(vals[dislikeName(k)] ?? 0) * P.dislike;
  });
  if (head) {
    for (const g of problem.nearGuestIds) cost.near += round(vals[nearName(g)] ?? 0) * P.nearPerStep;
  }
  cost.unseated = unseatedGuests.length * P.unseated;
  cost.total = cost.near + cost.like + cost.dislike + cost.unseated;

  return { assignment, cost, unseatedGuests, glpkStatus: res.result.status };
}
