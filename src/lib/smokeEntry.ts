// 供 Node 烟测打包的入口：构造样例工程并跑若干场景。
import { buildSolveInput, preDiagnose } from './model';
import { solveMILP, type SolveFn } from './solverCore';
import { createSampleProject } from './sample';
import { uid } from './ids';
import type { SeatingProject } from '../types';

export async function runScenarios(glpk: { solve: SolveFn }) {
  const solve = (problem: import('../types').SolveProblem) => solveMILP(glpk.solve, problem, 5000);

  const conflictProj = createSampleProject({ withConflict: true });
  const okProj = createSampleProject({ withConflict: false });

  const nameId = (p: ReturnType<typeof createSampleProject>, name: string, seq = 1) =>
    p.guests.find((g) => g.name === name && g.nameSeq === seq)!.id;

  // 场景 1：冲突无解预检
  const conflict = buildSolveInput(conflictProj);

  // 场景 2：可解样例
  const okInput = buildSolveInput(okProj);
  const okDiag = preDiagnose(okInput.problem);
  if (!okDiag.feasible) throw new Error('可解样例预检失败: ' + okDiag.reasons.join('; '));
  const solved = await solve(okInput.problem);

  const tables = {
    head: okProj.venue.tables.find((t) => t.isHead)!.id,
    a: okProj.venue.tables.find((t) => t.name.startsWith('A'))!.id,
    b: okProj.venue.tables.find((t) => t.name.startsWith('B'))!.id,
  };
  const names = {
    zhangSan: nameId(okProj, '张三'),
    zhangMu: nameId(okProj, '张母'),
    zhangSanMei: nameId(okProj, '张美美'),
    liSi: nameId(okProj, '李四'),
    zhaoFu: nameId(okProj, '赵父'),
    sunQi: nameId(okProj, '孙七'),
  };
  const locked = new Set<string>();
  for (const t of okInput.problem.tables) for (const g of t.lockedGuests) locked.add(g);

  // 场景 3：纳入 pending
  const pendingProj = createSampleProject({ withConflict: false });
  pendingProj.includePending = true;
  const pending = buildSolveInput(pendingProj);

  // 场景 4：容量收紧 —— 主桌 8 座全锁定，B 桌 3 座（2 锁定 + 1 给硬同桌儿童），其余 2 座
  const tightProj = createSampleProject({ withConflict: false });
  const bTbl = tightProj.venue.tables.find((t) => t.name.startsWith('B'))!;
  const liSi = tightProj.guests.find((g) => g.name === '李四')!;
  const liQi = tightProj.guests.find((g) => g.name === '李妻')!;
  for (const t of tightProj.venue.tables) {
    if (t.isHead) {
      for (let i = 0; i < 8; i++) tightProj.lockedSeats[t.id][i] = true;
    } else if (t === bTbl) {
      t.seats = 3;
      tightProj.seats[t.id] = [liSi.id, liQi.id, null];
      tightProj.lockedSeats[t.id] = [true, true, false];
    } else {
      t.seats = 2;
      tightProj.seats[t.id] = new Array(2).fill(null);
      tightProj.lockedSeats[t.id] = new Array(2).fill(false);
    }
  }
  const tightInput = buildSolveInput(tightProj);
  const tightSolved = await solve(tightInput.problem);

  // 场景 5：软条件被迫放宽 —— 两位宾客希望同桌，但只有两张 1 座桌 => like 代价 20，仍可解
  const gA2 = uid('g');
  const gB2 = uid('g');
  const t1 = uid('tbl');
  const t2 = uid('tbl');
  const softProj: SeatingProject = {
    id: uid('proj'),
    name: 'soft',
    updatedAt: 0,
    guests: [
      { id: gA2, name: '甲', nameSeq: 1, familyId: null, rsvp: 'accepted', isChild: false, dietary: '', tags: '' },
      { id: gB2, name: '乙', nameSeq: 1, familyId: null, rsvp: 'accepted', isChild: false, dietary: '', tags: '' },
    ],
    families: [],
    relations: [{ id: uid('rel'), a: gA2, b: gB2, kind: 'like' }],
    nearPrefs: [],
    venue: {
      width: 1000,
      height: 800,
      tables: [
        { id: t1, name: 'T1', shape: 'round', x: 200, y: 300, radius: 40, halfHeight: 0, seats: 1, isHead: true, positionLocked: false },
        { id: t2, name: 'T2', shape: 'round', x: 600, y: 300, radius: 40, halfHeight: 0, seats: 1, isHead: false, positionLocked: false },
      ],
      zones: [],
    },
    seats: { [t1]: [null], [t2]: [null] },
    lockedSeats: { [t1]: [false], [t2]: [false] },
    includePending: false,
  };
  const softInput = buildSolveInput(softProj);
  const softSolved = await solve(softInput.problem);

  return {
    conflict: { diagnostics: conflict.diagnostics },
    ok: {
      diagnostics: okDiag,
      assignment: solved.assignment,
      cost: solved.cost,
      unseated: solved.unseatedGuests,
      tables,
      names,
      locked,
      activeNames: okInput.problem.guests.map((g) => g.id),
    },
    pending: {
      activeNames: pending.problem.guests.map((g) => g.id),
    },
    tight: {
      unseated: tightSolved.unseatedGuests,
      cost: tightSolved.cost,
    },
    soft: {
      cost: softSolved.cost,
      unseated: softSolved.unseatedGuests,
      assignment: softSolved.assignment,
    },
  };
}
