// ───────────────────────────────────────────────────────────────────────────
// 排座 MILP 模型（平台无关）
//
// 决策变量 x[s][t] ∈ {0,1}：可就座实体 s（宾客 / 儿童椅占位）是否在桌 t。
//
// 硬约束：
//   1. 每个实体恰好占一桌（或按策略完全不排）
//   2. 每桌人数不超过容量
//   3. family 关系：两个实体所在桌完全相同（线性化等值约束）
//   4. avoid  关系：两个实体不能同桌（线性化 ≤ 1）
//   5. locked 分配：实体固定在锁定桌，且锁定占掉的座位直接从容量中扣除；
//      自动排座只会填充空位，锁定者绝不会被移动
//   6. 婉拒宾客不参与排座；未回复宾客默认不排（seatPending 时才参与）
//
// 软约束（最小化代价，求解后逐项展示）：
//   - preferNear 未同桌 → weight
//   - 靠近主桌/目标桌偏好未满足 → weight × 距离档（同桌 0 / 紧邻 1 / 同区 2 / 远 3）
//   - 未回复宾客被排入（seatPending=true 时的轻微惩罚）
// ───────────────────────────────────────────────────────────────────────────

import type {
  Guest,
  GuestRelation,
  SeatAssignment,
  SolveCostBreakdown,
  SolveResult,
  SolverInput,
  TableDef,
  TablePreference,
} from '../types';
import type { GLPK, LP } from 'glpk.js';

export interface Seatable {
  /** guestId（宾客）或占位 id（儿童椅） */
  id: string;
  kind: 'guest' | 'chair';
  guestId: string | null;
  childChair: boolean;
  pending: boolean;
  lockedTable: string | null;
}

export interface BuiltModel {
  lp: LP;
  seatables: Seatable[];
  tables: TableDef[];
  /** 变量名索引：x_<seatableIndex>_<tableIndex> */
  xName: (s: number, t: number) => string;
  costTerms: {
    preferNearSlacks: { name: string; coef: number }[];
    tablePrefVars: Map<string, { name: (band: number) => string; coef: number }>;
    pendingVars: { name: string; coef: number }[];
  };
}

// GLPK 边界类型数值（见 glpk.d.ts 的枚举顺序，C 头文件 glpk.h）：
// GLP_LO=2（下界）, GLP_UP=3（上界）, GLP_FX=5（固定相等）
const BND_LO = 2;
const BND_UP = 3;
const BND_FX = 5;

const BIG_PREFER_NEAR_WEIGHT = 10;
const BIG_TABLE_PREF_WEIGHT = 6;
/** 未回复被排座的代价：远小于关系代价，仅在等价方案中倾向不排 */
const PENDING_PENALTY = 1;

function distanceBand(d: number): number {
  if (d <= 160) return 0; // 同桌距离不存在跨桌，这里仅用于同坐标异常
  if (d <= 280) return 1; // 紧邻
  if (d <= 480) return 2; // 同区
  return 3; // 远
}

/** 收集参与求解的可就座实体 */
export function buildSeatables(input: SolverInput): {
  seatables: Seatable[];
  unseatedGuestIds: string[];
} {
  const assignmentByGuest = new Map<string, SeatAssignment>();
  for (const a of input.assignments) {
    if (a.guestId) assignmentByGuest.set(a.guestId, a);
  }

  const seatables: Seatable[] = [];
  const unseatedGuestIds: string[] = [];

  for (const g of input.guests) {
    if (g.rsvp === 'declined') {
      unseatedGuestIds.push(g.id);
      continue;
    }
    const locked = assignmentByGuest.get(g.id);
    if (g.rsvp === 'pending' && !input.seatPending && !locked) {
      // 默认策略：未回复不排；但若策划师已手工安排过座位，则视为确认参与，
      // 保留在模型中（且不加“未回复排入”代价，因为这是人工明确决定）
      unseatedGuestIds.push(g.id);
      continue;
    }
    seatables.push({
      id: g.id,
      kind: 'guest',
      guestId: g.id,
      childChair: g.isChild,
      // 仅“因勾选而排入”的未回复宾客计软代价；手工已入座的不计
      pending: g.rsvp === 'pending' && input.seatPending && !locked,
      lockedTable: locked?.locked ? locked.tableId : null,
    });
  }

  // 儿童椅占位（guestId 为空的锁定座位，例如婴幼儿随行）
  for (const a of input.assignments) {
    if (a.childChair && !a.guestId && a.locked) {
      seatables.push({
        id: a.id,
        kind: 'chair',
        guestId: null,
        childChair: true,
        pending: false,
        lockedTable: a.tableId,
      });
    }
  }

  return { seatables, unseatedGuestIds };
}

export function buildModel(input: SolverInput): BuiltModel {
  const tables = input.tables;
  const { seatables, unseatedGuestIds } = buildSeatables(input);
  void unseatedGuestIds;

  const xName = (s: number, t: number) => `x_${s}_${t}`;

  // 每桌锁定占用数
  const lockedCountByTable = new Map<string, number>();
  for (const st of seatables) {
    if (st.lockedTable) {
      lockedCountByTable.set(
        st.lockedTable,
        (lockedCountByTable.get(st.lockedTable) ?? 0) + 1,
      );
    }
  }

  const subjectTo: LP['subjectTo'] = [];
  const binaries: string[] = [];
  const objectiveVars: { name: string; coef: number }[] = [];

  // ── 约束 1/5：实体恰好一桌；锁定者固定在锁定桌 ──────────────────────────
  seatables.forEach((st, si) => {
    const vars = tables.map((_, ti) => ({ name: xName(si, ti), coef: 1 }));
    vars.forEach((v) => binaries.push(v.name));
    if (st.lockedTable) {
      const ti = tables.findIndex((t) => t.id === st.lockedTable);
      subjectTo.push({
        name: `fix_${si}`,
        vars,
        bnds: { type: BND_FX, lb: 1, ub: 1 },
      });
      // 显式钉住该变量，双保险（锁定桌位索引改变时也不会漂走）
      subjectTo.push({
        name: `pin_${si}_${ti}`,
        vars: [{ name: xName(si, ti), coef: 1 }],
        bnds: { type: BND_FX, lb: 1, ub: 1 },
      });
    } else {
      subjectTo.push({
        name: `one_${si}`,
        vars,
        bnds: { type: BND_FX, lb: 1, ub: 1 },
      });
    }
  });

  // ── 约束 2：容量（锁定占用预先扣除）────────────────────────────────────
  tables.forEach((t, ti) => {
    const locked = lockedCountByTable.get(t.id) ?? 0;
    const freeCap = t.capacity - locked;
    subjectTo.push({
      name: `cap_${ti}`,
      vars: seatables
        .filter((st) => st.lockedTable !== t.id)
        .map((_, si) => ({ name: xName(si, ti), coef: 1 })),
      bnds: { type: BND_UP, ub: freeCap, lb: 0 },
    });
  });

  // ── 软约束：preferNear 未同桌松弛变量 ──────────────────────────────────
  const seatableIndex = new Map(seatables.map((s, i) => [s.id, i]));
  const preferNearSlacks: { name: string; coef: number }[] = [];

  for (const rel of input.relations) {
    if (rel.kind !== 'preferNear') continue;
    const ai = seatableIndex.get(rel.guestA);
    const bi = seatableIndex.get(rel.guestB);
    if (ai === undefined || bi === undefined) continue; // 婉拒/未排者跳过
    const weight = rel.weight ?? BIG_PREFER_NEAR_WEIGHT;
    for (let ti = 0; ti < tables.length; ti++) {
      // slack >= x[a][t] - x[b][t]，每个桌一个 slack；
      // 只要存在一桌 a 在而 b 不在就产生代价（对称两方向取一组即可：
      // 用 sum_t |x[a]-x[b]| / 2 更准，这里用单侧松弛 + 权重已足够表达偏好）
      const slack = `pn_${rel.id}_${ti}`;
      binaries.push(slack);
      subjectTo.push({
        name: `pn_${rel.id}_${ti}`,
        vars: [
          { name: xName(ai, ti), coef: 1 },
          { name: xName(bi, ti), coef: -1 },
          { name: slack, coef: -1 },
        ],
        bnds: { type: BND_UP, ub: 0, lb: -1e9 },
      });
      preferNearSlacks.push({ name: slack, coef: weight });
    }
  }

  // ── 硬约束 3/4：family / avoid ─────────────────────────────────────────
  input.relations.forEach((rel, ri) => {
    if (rel.kind === 'preferNear') return;
    const ai = seatableIndex.get(rel.guestA);
    const bi = seatableIndex.get(rel.guestB);
    if (ai === undefined || bi === undefined) return;
    tables.forEach((_, ti) => {
      const vars = [
        { name: xName(ai, ti), coef: 1 },
        { name: xName(bi, ti), coef: 1 },
      ];
      if (rel.kind === 'family') {
        // x[a][t] - x[b][t] = 0 ⇔ 两人所在桌完全相同
        subjectTo.push({
          name: `fam_${ri}_${ti}`,
          vars: [
            { name: xName(ai, ti), coef: 1 },
            { name: xName(bi, ti), coef: -1 },
          ],
          bnds: { type: BND_FX, lb: 0, ub: 0 },
        });
      } else {
        // avoid：同桌合计 ≤ 1
        subjectTo.push({
          name: `avoid_${ri}_${ti}`,
          vars,
          bnds: { type: BND_UP, ub: 1, lb: 0 },
        });
      }
    });
  });

  // ── 软约束：靠近目标桌 / 主桌 ──────────────────────────────────────────
  // y[g][b] ∈ {0,1}：宾客 g 是否落在距离档 b；选中档的代价 = weight × b
  const tablePrefVars = new Map<
    string,
    { name: (band: number) => string; coef: number }
  >();

  for (const pref of input.tablePreferences) {
    const gi = seatableIndex.get(pref.guestId);
    if (gi === undefined) continue;
    const weight = pref.weight ?? BIG_TABLE_PREF_WEIGHT;
    const targetTables = pref.tableId
      ? tables.filter((t) => t.id === pref.tableId)
      : tables.filter((t) => t.isHeadTable);
    if (targetTables.length === 0) continue;

    const yPrefix = `tp_${pref.id}`;
    const yName = (band: number) => `${yPrefix}_${band}`;

    // 每档一个变量，约束：sum_b y[b] >= 1 当且仅当落在该档时……
    // 直接建模：y[g][b] = 1 表示“宾客所在桌与最近目标桌距离档为 b”。
    // 用覆盖式建模：对每个桌 t，若 x[g][t]=1，则 y[band(t)] 必须为 1。
    tables.forEach((t, ti) => {
      const d = nearestTargetDistance(t, targetTables, input.tableDistance);
      const band = distanceBand(d);
      subjectTo.push({
        name: `${yPrefix}_force_${ti}`,
        vars: [
          { name: xName(gi, ti), coef: 1 },
          { name: yName(band), coef: -1 },
        ],
        bnds: { type: BND_UP, ub: 0, lb: -1e9 },
      });
    });

    // 宾客恰好坐一桌，所以恰好有一个 y 被激活；允许 y 全 0（用 x 之和兜底）
    // 为避免“不激活任何 y”，要求 sum_b y[b] >= 1（只要宾客被排座）
    subjectTo.push({
      name: `${yPrefix}_one`,
      vars: [0, 1, 2, 3].map((b) => ({ name: yName(b), coef: 1 })),
      bnds: { type: BND_LO, ub: 1e9, lb: 1 },
    });
    [0, 1, 2, 3].forEach((b) => binaries.push(yName(b)));

    // next-to：禁止档 2/3（硬约束）；档 0/1 仍计软代价
    if (pref.strength === 'next-to') {
      subjectTo.push({
        name: `${yPrefix}_strict`,
        vars: [
          { name: yName(2), coef: 1 },
          { name: yName(3), coef: 1 },
        ],
        bnds: { type: BND_FX, lb: 0, ub: 0 },
      });
    }

    tablePrefVars.set(pref.id, { name: yName, coef: weight });
  }

  // ── 软代价：未回复被排座 ────────────────────────────────────────────────
  const pendingVars: { name: string; coef: number }[] = [];
  seatables.forEach((st, si) => {
    if (!st.pending) return;
    tables.forEach((_, ti) => {
      pendingVars.push({ name: xName(si, ti), coef: PENDING_PENALTY });
    });
  });

  // ── 目标函数 ────────────────────────────────────────────────────────────
  for (const v of preferNearSlacks) objectiveVars.push(v);
  for (const { name, coef } of tablePrefVars.values()) {
    for (const b of [0, 1, 2, 3]) {
      objectiveVars.push({ name: name(b), coef: coef * b });
    }
  }
  objectiveVars.push(...pendingVars);

  const lp: LP = {
    name: 'wedding-seating',
    objective: { direction: 1 /* GLP_MIN */, name: 'cost', vars: objectiveVars },
    subjectTo,
    binaries,
  };

  return {
    lp,
    seatables,
    tables,
    xName,
    costTerms: { preferNearSlacks, tablePrefVars, pendingVars },
  };
}

function nearestTargetDistance(
  from: TableDef,
  targets: TableDef[],
  tableDistance: SolverInput['tableDistance'],
): number {
  let best = Infinity;
  for (const t of targets) {
    if (t.id === from.id) return 0;
    const d = tableDistance[from.id]?.[t.id] ?? Infinity;
    best = Math.min(best, d);
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────────
// 求解结果 → SeatAssignment[]
// ───────────────────────────────────────────────────────────────────────────

export function interpretSolution(
  input: SolverInput,
  built: BuiltModel,
  vars: Record<string, number>,
  status: SolveResult['status'],
  hint?: string,
): SolveResult {
  const { seatables, tables, xName } = built;
  const assignments: SeatAssignment[] = [];

  if (status !== 'infeasible' && status !== 'error') {
    // 每桌座位序号：从锁定座位开始排，新分配顺延
    const usedSeatIndex = new Map<string, number>();
    const lockedPerTable = new Map<string, number>();
    for (const a of input.assignments) {
      if (a.locked) {
        usedSeatIndex.set(`${a.tableId}:${a.seatIndex}`, a.seatIndex);
        lockedPerTable.set(a.tableId, (lockedPerTable.get(a.tableId) ?? 0) + 1);
      }
    }

    const nextSeat = (tableId: string) => {
      let i = 0;
      while (usedSeatIndex.has(`${tableId}:${i}`)) i++;
      usedSeatIndex.set(`${tableId}:${i}`, i);
      return i;
    };

    // 先复制锁定座位（保持原 seatIndex）
    for (const a of input.assignments) {
      if (a.locked) {
        assignments.push({ ...a });
      }
    }

    // 再写入求解结果
    seatables.forEach((st, si) => {
      if (st.lockedTable) return; // 已复制
      for (let ti = 0; ti < tables.length; ti++) {
        const v = vars[xName(si, ti)] ?? 0;
        if (Math.round(v) === 1) {
          const tableId = tables[ti].id;
          assignments.push({
            id:
              st.kind === 'guest'
                ? `seat:${st.guestId}`
                : st.id,
            tableId,
            seatIndex: nextSeat(tableId),
            guestId: st.guestId,
            childChair: st.childChair,
            locked: false,
          });
          break;
        }
      }
    });
  }

  // 代价分解（直接从变量回算，保证展示数字与目标一致）
  const costBreakdown = scoreAssignments(
    input,
    assignments,
    status === 'infeasible' || status === 'error',
  );

  return {
    status,
    assignments,
    unseatedGuestIds: buildSeatables(input).unseatedGuestIds,
    costBreakdown,
    infeasibilityHint: hint,
  };
}

/**
 * 对任意一份分配方案（手工或自动）计算软代价。
 * 供“手工方案 vs 自动方案”对比使用，不依赖求解器。
 */
export function scoreAssignments(
  input: SolverInput,
  assignments: SeatAssignment[],
  infeasible = false,
): SolveCostBreakdown {
  const tableOfGuest = new Map<string, string>();
  for (const a of assignments) {
    if (a.guestId) tableOfGuest.set(a.guestId, a.tableId);
  }

  const result: SolveCostBreakdown = {
    preferNear: 0,
    tablePreference: 0,
    pendingSeated: 0,
    total: 0,
  };
  if (infeasible) return result;

  for (const rel of input.relations) {
    if (rel.kind !== 'preferNear') continue;
    const ta = tableOfGuest.get(rel.guestA);
    const tb = tableOfGuest.get(rel.guestB);
    if (!ta || !tb || ta !== tb) {
      result.preferNear += rel.weight ?? BIG_PREFER_NEAR_WEIGHT;
    }
  }

  for (const pref of input.tablePreferences) {
    const ta = tableOfGuest.get(pref.guestId);
    if (!ta) continue;
    const targets = pref.tableId
      ? input.tables.filter((t) => t.id === pref.tableId)
      : input.tables.filter((t) => t.isHeadTable);
    if (targets.length === 0) continue;
    const from = input.tables.find((t) => t.id === ta);
    if (!from) continue;
    const d = nearestTargetDistance(from, targets, input.tableDistance);
    result.tablePreference += (pref.weight ?? BIG_TABLE_PREF_WEIGHT) * distanceBand(d);
  }

  // 未回复排入代价：仅统计“因勾选而被排入”的未回复宾客；
  // 求解前已有手工座位（无论锁定与否）的未回复宾客是人工决定，不计软代价
  const preSeated = new Set(
    input.assignments.filter((a) => a.guestId).map((a) => a.guestId!),
  );
  for (const g of input.guests) {
    if (
      g.rsvp === 'pending' &&
      input.seatPending &&
      !preSeated.has(g.id) &&
      tableOfGuest.has(g.id)
    ) {
      result.pendingSeated += PENDING_PENALTY;
    }
  }

  result.total =
    result.preferNear + result.tablePreference + result.pendingSeated;
  return result;
}

/**
 * 无解诊断：在不调用求解器的前提下做快速结构性检查，
 * 给出最可能导致无解的硬条件提示。
 */
export function diagnoseInfeasibility(input: SolverInput): string[] {
  const hints: string[] = [];
  const { seatables } = buildSeatables(input);
  const byId = new Map(seatables.map((s) => [s.id, s]));

  // 锁定桌与家庭关系冲突
  for (const rel of input.relations) {
    const a = byId.get(rel.guestA);
    const b = byId.get(rel.guestB);
    if (!a || !b) continue;
    if (rel.kind === 'family' && a.lockedTable && b.lockedTable && a.lockedTable !== b.lockedTable) {
      hints.push(
        `家庭关系冲突：双方都已锁定在不同桌（${rel.guestA} → ${a.lockedTable}，${rel.guestB} → ${b.lockedTable}）`,
      );
    }
    if (rel.kind === 'avoid' && a.lockedTable && a.lockedTable === b.lockedTable) {
      hints.push(
        `避让关系冲突：双方已锁定在同一桌 ${a.lockedTable}`,
      );
    }
  }

  // 容量：锁定数超容量
  const lockedCount = new Map<string, number>();
  for (const s of seatables) {
    if (s.lockedTable) {
      lockedCount.set(s.lockedTable, (lockedCount.get(s.lockedTable) ?? 0) + 1);
    }
  }
  for (const t of input.tables) {
    const n = lockedCount.get(t.id) ?? 0;
    if (n > t.capacity) {
      hints.push(`桌「${t.label}」锁定座位 ${n} 已超过容量 ${t.capacity}`);
    }
  }

  // 总容量
  const totalCap = input.tables.reduce((sum, t) => {
    const locked = lockedCount.get(t.id) ?? 0;
    return sum + Math.max(0, t.capacity - locked);
  }, 0);
  const freeSeatables = seatables.filter((s) => !s.lockedTable).length;
  if (freeSeatables > totalCap) {
    hints.push(
      `总容量不足：待排 ${freeSeatables} 人，扣除锁定座位后仅剩 ${totalCap} 个空位`,
    );
  }

  // avoid + family 形成的三人互斥小团检测（冲突关系无解样例）
  // 找 family 连通块，块内若有任何 avoid 边则必然无解
  const family = input.relations.filter((r) => r.kind === 'family');
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    parent.set(x, parent.get(x) ?? x);
    if (parent.get(x) === x) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  };
  for (const r of family) {
    parent.set(find(r.guestA), find(r.guestB));
  }
  for (const r of input.relations) {
    if (r.kind !== 'avoid') continue;
    if (find(r.guestA) === find(r.guestB)) {
      hints.push(
        `关系矛盾：${r.guestA} 与 ${r.guestB} 既被家庭关系绑定又被要求避让`,
      );
    }
  }

  if (hints.length === 0) {
    hints.push('硬条件组合无解：可能是避让网络过于密集，没有足够的桌子分散相关宾客');
  }
  return hints;
}

// ───────────────────────────────────────────────────────────────────────────
// 求解入口（注入 GLPK 实例，浏览器/Node 共用）
// ───────────────────────────────────────────────────────────────────────────

export async function solveWith(glpk: GLPK, input: SolverInput): Promise<SolveResult> {
  if (input.tables.length === 0) {
    return {
      status: 'infeasible',
      assignments: [],
      unseatedGuestIds: input.guests.map((g) => g.id),
      costBreakdown: { preferNear: 0, tablePreference: 0, pendingSeated: 0, total: 0 },
      infeasibilityHint: '场地中还没有桌子',
    };
  }

  const built = buildModel(input);
  let res;
  try {
    res = glpk.solve(built.lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: 30 });
  } catch (err) {
    return {
      status: 'error',
      assignments: [],
      unseatedGuestIds: buildSeatables(input).unseatedGuestIds,
      costBreakdown: { preferNear: 0, tablePreference: 0, pendingSeated: 0, total: 0 },
      infeasibilityHint: `求解器异常：${(err as Error).message}`,
    };
  }

  if (res.result.status === glpk.GLP_NOFEAS || res.result.status === glpk.GLP_INFEAS) {
    const hints = diagnoseInfeasibility(input);
    return interpretSolution(input, built, {}, 'infeasible', hints.join('；'));
  }

  const status: SolveResult['status'] =
    res.result.status === glpk.GLP_OPT ? 'optimal' : 'feasible';
  return interpretSolution(input, built, res.result.vars, status);
}

export type { Guest, GuestRelation, TablePreference };
