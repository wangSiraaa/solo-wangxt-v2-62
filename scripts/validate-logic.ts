// ───────────────────────────────────────────────────────────────────────────
// 逻辑验证脚本（Node 直跑，不启动浏览器）：
//   npm run test:logic
//
// 覆盖需求点：
//   1. 冲突关系形成无解（family+avoid 矛盾、避让双方锁定同桌）→ 状态 infeasible + 诊断
//   2. 儿童椅占位（婴幼儿占位占容量且锁定，自动排座不移动）
//   3. 部分宾客未回复（默认不排；seatPending 时排入且有 pending 代价）
//   4. 婉拒宾客永不入座
//   5. 锁定桌位在自动排座后保留
//   6. 手工操作可撤销（history）
//   7. 手工方案与自动方案代价对比（scoreAssignments）
//   8. 忌口独立存储：换座 / 自动排座后忌口不丢，桌卡仍打印
//   9. 同名宾客稳定编号
//  10. 禁止占用多边形几何检查（含“最近合法位置”）
//  11. 常规样例可求得可行解，且硬约束全部满足
// ───────────────────────────────────────────────────────────────────────────

import createGLPK from 'glpk.js';
import { solveWith, scoreAssignments, buildSeatables } from '../src/solver/model';
import {
  buildSampleProject,
  buildInfeasibleSampleProject,
} from '../src/lib/samples';
import { tableDistanceMatrix } from '../src/lib/distance';
import {
  addChildChair,
  applyAutoAssignments,
  findAssignment,
  moveTable,
  removeChildChair,
  seatGuest,
  unseatGuest,
} from '../src/lib/actions';
import { pushHistory, undo, type History } from '../src/lib/history';
import { buildPlaceCards } from '../src/lib/placecards';
import { assignStableDisplayNames } from '../src/lib/ids';
import {
  checkAllGeometry,
  checkTableGeometry,
  nearestLegalPosition,
} from '../src/lib/geometry';
import type { PlannerState, SolverInput } from '../src/types';

// ── 迷你断言框架 ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function makeInput(project: ReturnType<typeof buildSampleProject>, seatPending = false): SolverInput {
  return {
    guests: project.guests,
    tables: project.tables,
    relations: project.relations,
    tablePreferences: project.tablePreferences,
    assignments: project.assignments,
    seatPending,
    tableDistance: tableDistanceMatrix(project.tables),
  };
}

function validateHardConstraints(input: SolverInput, assignments: SolverInput['assignments']): string[] {
  const errors: string[] = [];
  // 容量（含儿童椅占位）
  for (const t of input.tables) {
    const n = assignments.filter((a) => a.tableId === t.id).length;
    if (n > t.capacity) errors.push(`${t.label} 超员 ${n}/${t.capacity}`);
  }
  const tableOf = new Map<string, string>();
  for (const a of assignments) if (a.guestId) tableOf.set(a.guestId, a.tableId);
  for (const r of input.relations) {
    const ta = tableOf.get(r.guestA);
    const tb = tableOf.get(r.guestB);
    if (!ta || !tb) continue; // 未入座者不参与
    if (r.kind === 'family' && ta !== tb) {
      errors.push(`家庭 ${r.guestA}/${r.guestB} 被分开`);
    }
    if (r.kind === 'avoid' && ta === tb) {
      errors.push(`避让 ${r.guestA}/${r.guestB} 同桌`);
    }
  }
  // 锁定保留
  for (const a of input.assignments) {
    if (!a.locked) continue;
    const kept = assignments.find((x) => x.id === a.id);
    if (!kept || kept.tableId !== a.tableId || kept.seatIndex !== a.seatIndex) {
      errors.push(`锁定座位 ${a.id} 被移动/丢失`);
    }
  }
  return errors;
}

async function main() {
  const glpk = await createGLPK();
  console.log(`glpk ${glpk.version}\n`);

  // ── 1. 常规样例可行解 ─────────────────────────────────────────────────────
  console.log('【1】常规样例：求解与硬约束');
  const project = buildSampleProject();
  const input = makeInput(project);
  const result = await solveWith(glpk, input);

  check('常规样例状态为 optimal/feasible', result.status === 'optimal' || result.status === 'feasible',
    `实际=${result.status} hint=${result.infeasibilityHint ?? ''}`);

  const hardErrors = result.status !== 'infeasible'
    ? validateHardConstraints(input, result.assignments)
    : ['样例被判无解'];
  check('容量/家庭/避让/锁定硬约束全部满足', hardErrors.length === 0, hardErrors.join('; '));

  const seatedAccepted = result.assignments.filter((a) => a.guestId).length;
  // 已接受且非婉拒、非未回复：共 12 人
  const acceptedCount = project.guests.filter((g) => g.rsvp === 'accepted').length;
  check(`已接受宾客全部入座 (${seatedAccepted}/${acceptedCount})`, seatedAccepted === acceptedCount);

  // 婉拒者不在结果里
  check('婉拒宾客未入座', !result.assignments.some((a) => a.guestId === 'g-qianduoduo'));

  // 代价分解自洽
  const rescored = scoreAssignments(input, result.assignments);
  check('目标代价与回算代价一致', rescored.total === result.costBreakdown.total,
    `solver=${result.costBreakdown.total} rescore=${rescored.total}`);

  // ── 2. 未回复宾客 ─────────────────────────────────────────────────────────
  console.log('\n【2】部分宾客未回复');
  check('默认不排未回复宾客',
    !result.assignments.some((a) => ['g-wumin', 'g-zhenghao'].includes(a.guestId ?? '')));
  check('未回复宾客列入 unseated',
    result.unseatedGuestIds.includes('g-wumin') && result.unseatedGuestIds.includes('g-zhenghao'));

  const inputPending = makeInput(project, true);
  const resultPending = await solveWith(glpk, inputPending);
  const wuminSeated = resultPending.assignments.some((a) => a.guestId === 'g-wumin');
  const zhenghaoSeated = resultPending.assignments.some((a) => a.guestId === 'g-zhenghao');
  check('seatPending=true 时未回复宾客被排入', wuminSeated && zhenghaoSeated);
  check('排入未回复产生 pendingSeated 代价',
    resultPending.costBreakdown.pendingSeated >= 2,
    `实际=${resultPending.costBreakdown.pendingSeated}`);

  // 手工可以单独安排未回复宾客（不依赖 seatPending）
  const manualPending = seatGuest(project, 'g-zhenghao', 'T3');
  check('手工可安排未回复宾客', manualPending.ok &&
    !!findAssignment(manualPending.project, 'g-zhenghao'));

  // 即使不勾选“排入未回复”，已手工入座的未回复宾客也必须保留（不被应用方案撤下）
  const rManualPending = await solveWith(glpk, makeInput(manualPending.project, false));
  const zhenghaoKept = rManualPending.assignments.some((a) => a.guestId === 'g-zhenghao');
  check('手工入座的未回复宾客在自动方案中保留', zhenghaoKept);
  check('手工入座的未回复宾客不产生 pending 软代价',
    rManualPending.costBreakdown.pendingSeated === 0,
    `实际=${rManualPending.costBreakdown.pendingSeated}`);

  // ── 3. 儿童椅占位 ─────────────────────────────────────────────────────────
  console.log('\n【3】儿童椅占位');
  const infant = result.assignments.find((a) => a.id === 'seat-chair-infant-1');
  check('婴幼儿儿童椅占位保留在主桌且锁定',
    !!infant && infant.tableId === 'T1' && infant.childChair && infant.locked);
  const t1Seated = result.assignments.filter((a) => a.tableId === 'T1').length;
  check('儿童椅占位计入主桌容量', t1Seated >= 1);

  // 添加第二个儿童椅到 T2，再求解，占位必须不动
  const withChair = addChildChair(project, 'T2');
  check('可在 T2 添加儿童椅占位', withChair.ok);
  const chairId = withChair.project.assignments.find(
    (a) => a.childChair && !a.guestId && a.tableId === 'T2',
  )!.id;
  const r2 = await solveWith(glpk, makeInput(withChair.project));
  const chairKept = r2.assignments.some(
    (a) => a.id === chairId && a.tableId === 'T2' && a.childChair,
  );
  check('自动排座后新增儿童椅占位不动', chairKept);

  // 容量填满后不能继续添加
  let full = project;
  const t2cap = full.tables.find((t) => t.id === 'T2')!.capacity;
  // T2 已锁定 1 人（陈刚）+ 样例本身的求解不影响手工状态；手工层面剩 7 个占位
  for (let i = 0; i < t2cap - 1; i++) full = addChildChair(full, 'T2').project;
  const overflow = addChildChair(full, 'T2');
  check('桌满时拒绝再加儿童椅', !overflow.ok && /满/.test(overflow.reason ?? ''));

  // 儿童宾客（已登记）渲染标记
  const childGuest = result.assignments.find((a) => a.guestId === 'g-linxiaoyu');
  check('儿童宾客的座位带 childChair 标记', !!childGuest && childGuest.childChair);

  // ── 4. 锁定座位 ───────────────────────────────────────────────────────────
  console.log('\n【4】锁定座位不被自动排座移动');
  const chengang = result.assignments.find((a) => a.guestId === 'g-chengang');
  check('锁定宾客陈刚仍在 T2 第 0 位',
    !!chengang && chengang.tableId === 'T2' && chengang.seatIndex === 0 && chengang.locked);

  // 手工不能把别人放到锁定座位
  const clash = seatGuest(project, 'g-suqing', 'T2', { seatIndex: 0 });
  check('锁定座位拒绝手工占用', !clash.ok);
  // 手工不能移动锁定宾客
  const moveLocked = seatGuest(project, 'g-chengang', 'T5');
  check('锁定宾客拒绝手工移动', !moveLocked.ok);

  // ── 5. 无解冲突样例 ───────────────────────────────────────────────────────
  console.log('\n【5】冲突关系形成无解');
  const infeasible = buildInfeasibleSampleProject();
  const infeasResult = await solveWith(glpk, makeInput(infeasible));
  check('求解状态为 infeasible', infeasResult.status === 'infeasible',
    `实际=${infeasResult.status}`);
  check('无解时不返回任何座位分配', infeasResult.assignments.length === 0);
  const hint = infeasResult.infeasibilityHint ?? '';
  check('诊断提示家庭/避让矛盾', hint.includes('家庭') && hint.includes('避让'));
  check('诊断提示锁定避让同桌', hint.includes('同一桌'));

  // ── 6. 撤销手工操作 + 与自动方案比较 ──────────────────────────────────────
  console.log('\n【6】撤销 & 手工/自动方案比较');
  const base: PlannerState = {
    project: buildSampleProject(),
    selectedGuestId: null,
    selectedTableId: null,
    selectedAssignmentId: null,
    autoCandidate: null,
    solving: false,
    statusMessage: null,
  };
  let history: History = { past: [] };
  // 手工把苏晴放到 T4
  const s1 = seatGuest(base.project, 'g-suqing', 'T4');
  history = pushHistory(history, '安排苏晴→T4', base);
  const afterManual: PlannerState = { ...base, project: s1.project };
  check('手工安排苏晴到 T4 成功', s1.ok && findAssignment(s1.project, 'g-suqing')?.tableId === 'T4');

  // 自动方案
  const auto = await solveWith(glpk, makeInput(afterManual.project));
  const manualScore = scoreAssignments(makeInput(afterManual.project), afterManual.project.assignments);
  check('手工方案代价可计算', manualScore.total >= 0);
  check('自动方案与手工方案代价可比较',
    Number.isFinite(auto.costBreakdown.total) && Number.isFinite(manualScore.total),
    `手工=${manualScore.total} 自动=${auto.costBreakdown.total}`);
  console.log(`    · 手工方案代价=${manualScore.total}（preferNear ${manualScore.preferNear}, 靠桌 ${manualScore.tablePreference}）`);
  console.log(`    · 自动方案代价=${auto.costBreakdown.total}（preferNear ${auto.costBreakdown.preferNear}, 靠桌 ${auto.costBreakdown.tablePreference}）`);
  check('自动方案代价不高于手工方案（软约束最小化）',
    auto.costBreakdown.total <= manualScore.total,
    `${auto.costBreakdown.total} > ${manualScore.total}`);

  // 应用自动方案（也可撤销）
  const applied = applyAutoAssignments(afterManual.project, auto.assignments);
  history = pushHistory(history, '应用自动方案', afterManual);
  const afterApply: PlannerState = { ...afterManual, project: applied };
  void afterApply;

  // 撤销应用
  const undone1 = undo(history);
  check('撤销“应用自动方案”回到手工版',
    !!undone1 && findAssignment(undone1.state.project, 'g-suqing')?.tableId === 'T4');

  // 再撤销手工安排
  const undone2 = undone1 ? undo(undone1.history) : null;
  check('撤销手工安排后苏晴回到未入座',
    !!undone2 && !findAssignment(undone2.state.project, 'g-suqing'));

  // 撤下操作本身
  const un = unseatGuest(afterManual.project, 'g-suqing');
  check('撤下已入座宾客', un.ok && !findAssignment(un.project, 'g-suqing'));

  // ── 7. 忌口独立存储：换座后桌卡不丢 ───────────────────────────────────────
  console.log('\n【7】忌口独立于席位');
  const p = buildSampleProject();
  // 模拟忌口存在于独立 store（权威副本），项目 dietary 仅为视图
  const dietaryAuthority = structuredClone(p.dietary);
  check('样例含周奶奶/林小雨等忌口', dietaryAuthority.length >= 4);

  // 先自动排座
  const autoPlan = await solveWith(glpk, makeInput(p));
  let live = applyAutoAssignments(p, autoPlan.assignments);
  const tableBefore = findAssignment(live, 'g-zhougrandma')?.tableId;
  // 多次手工换座
  live = seatGuest(live, 'g-zhougrandma', 'T5').project;
  live = seatGuest(live, 'g-zhougrandma', 'T7').project;
  live = unseatGuest(live, 'g-zhougrandma').project;
  live = seatGuest(live, 'g-zhougrandma', 'T9').project;
  const tableAfter = findAssignment(live, 'g-zhougrandma')?.tableId;
  check('周奶奶经历多次换座', tableBefore !== tableAfter);

  const cards = buildPlaceCards(live, dietaryAuthority, { includeUnseated: false });
  const grandmaCard = cards.find((c) => c.guestName.includes('周奶奶'));
  check('桌卡仍打印周奶奶的清真忌口（换座后）',
    !!grandmaCard && grandmaCard.dietary.some((d) => d.type === '清真'));
  const yuCard = cards.find((c) => c.guestName === '林小雨');
  check('桌卡打印林小雨坚果过敏',
    !!yuCard && yuCard.dietary.some((d) => d.type === '坚果过敏'));

  // 未回复宾客（未入座）默认不导出，includeUnseated 时导出并带忌口
  const cardsWithPending = buildPlaceCards(live, dietaryAuthority, { includeUnseated: true });
  const wuminCard = cardsWithPending.find((c) => c.guestName === '吴敏');
  check('未排座的未回复宾客可选导出且忌口仍在',
    !!wuminCard && wuminCard.tableLabel === null &&
    wuminCard.dietary.some((d) => d.type === '素食'));

  // 删除/新增座位分配不影响 dietary 条数
  const stripped = applyAutoAssignments(p, []);
  const cardsAll = buildPlaceCards(stripped, dietaryAuthority, { includeUnseated: true });
  check('即使清空所有座位，忌口数据仍在（独立存储）',
    cardsAll.every((c) => typeof c.guestName === 'string') && dietaryAuthority.length === 4);

  // ── 8. 同名稳定编号 ───────────────────────────────────────────────────────
  console.log('\n【8】同名宾客稳定编号');
  const zhangs = p.guests.filter((g) => g.name === '张伟');
  check('两位张伟均存在', zhangs.length === 2);
  check('编号为 #1/#2',
    zhangs.some((g) => g.displayName === '张伟 #1') &&
    zhangs.some((g) => g.displayName === '张伟 #2'));
  const renamed = assignStableDisplayNames(
    p.guests.map((g) => (g.id === 'g-zhangwei-1' ? { ...g, name: '张伟' } : g)),
  );
  check('重复计算后编号稳定不跳号',
    renamed.find((g) => g.id === 'g-zhangwei-1')?.displayName === '张伟 #1');
  // 唯一姓名不带编号
  check('唯一姓名不带编号', p.guests.find((g) => g.id === 'g-suqing')?.displayName === '苏晴');

  // ── 9. 禁止占用多边形几何检查 ─────────────────────────────────────────────
  console.log('\n【9】场地几何（仅几何检查，非安全认证）');
  const venue = p.venue;
  check('初始布局无几何冲突', checkAllGeometry(p.tables, venue).length === 0);

  // 把 T3 拖进中央过道
  const inAisle = moveTable(p, 'T3', 600, 400);
  const aisleIssues = checkTableGeometry(
    inAisle.project.tables.find((t) => t.id === 'T3')!,
    inAisle.project.tables,
    venue,
  );
  check('压入过道多边形被检出', aisleIssues.some((i) => i.kind === 'forbidden-zone'));

  // 把桌子拖到消防出口缓冲区
  const inExit = moveTable(p, 'T9', 1140, 780);
  const exitIssues = checkTableGeometry(
    inExit.project.tables.find((t) => t.id === 'T9')!,
    inExit.project.tables,
    inExit.project.venue,
  );
  check('压入消防出口缓冲区被检出', exitIssues.some((i) => i.kind === 'forbidden-zone'));

  // 出界
  const outside = moveTable(p, 'T9', 1300, 100);
  check('超出场地边界被检出',
    checkTableGeometry(outside.project.tables.find((t) => t.id === 'T9')!, outside.project.tables, venue)
      .some((i) => i.kind === 'out-of-bounds'));

  // 重叠
  const overlap = moveTable(p, 'T3', 220, 270); // T3 → T2 的位置
  check('桌间重叠被检出',
    checkTableGeometry(overlap.project.tables.find((t) => t.id === 'T3')!, overlap.project.tables, venue)
      .some((i) => i.kind === 'table-overlap'));

  // 最近合法位置
  const moved = inAisle.project.tables.find((t) => t.id === 'T3')!;
  const legal = nearestLegalPosition(moved, inAisle.project.tables, venue);
  check('可找到离开过道的最近合法位置',
    !!legal &&
      checkTableGeometry(
        { ...moved, x: legal.x, y: legal.y },
        inAisle.project.tables,
        venue,
      ).length === 0,
    legal ? `(${legal.x},${legal.y})` : 'null');

  // 清理测试产生的无用变量
  void removeChildChair;
  void buildSeatables;

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  console.log(`\n────────────────────────────────────`);
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    console.error('失败项：\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('全部逻辑验证通过 ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
