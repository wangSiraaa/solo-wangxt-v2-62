// UI 渲染冒烟（Node，无需浏览器）：
// 渲染宾客侧栏与检查器（含自动方案对比卡、无解卡）为静态 HTML，
// 捕捉组件体/Hook/JSX 的运行时错误。Konva 画布由逻辑层与生产构建覆盖。
import { renderToString } from 'react-dom/server';
import GuestSidebar from '../src/ui/GuestSidebar';
import Inspector from '../src/ui/Inspector';
import { buildSampleProject, buildInfeasibleSampleProject } from '../src/lib/samples';
import { scoreAssignments } from '../src/solver/model';
import { tableDistanceMatrix } from '../src/lib/distance';
import { placeCardsHtml } from '../src/lib/placecards';
import type { AutoPlanCandidate, PlannerState } from '../src/types';

let failed = 0;
function assert(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const noop = () => {};
const asyncNoop = async () => {};

function stateFor(project: ReturnType<typeof buildSampleProject>): PlannerState {
  return {
    project,
    selectedGuestId: null,
    selectedTableId: null,
    selectedAssignmentId: null,
    autoCandidate: null,
    solving: false,
    statusMessage: null,
  };
}

const project = buildSampleProject();
const dietary = project.dietary;
const state = stateFor(project);
const score = scoreAssignments(
  {
    guests: project.guests,
    tables: project.tables,
    relations: project.relations,
    tablePreferences: project.tablePreferences,
    assignments: project.assignments,
    seatPending: false,
    tableDistance: tableDistanceMatrix(project.tables),
  },
  project.assignments,
);

// 1. 宾客侧栏
const sidebarHtml = renderToString(
  <GuestSidebar
    project={project}
    dietaryGuestIds={new Set(dietary.map((d) => d.guestId))}
    selectedGuestId={null}
    onSelectGuest={noop}
    onCreateGuest={noop}
  />,
);
assert('侧栏渲染出宾客姓名「张伟 #1」', sidebarHtml.includes('张伟'));
assert('侧栏渲染同名编号', sidebarHtml.includes('#1') && sidebarHtml.includes('#2'));
assert('侧栏显示未回复徽章', sidebarHtml.includes('未回复'));
assert('侧栏显示婉拒徽章', sidebarHtml.includes('婉拒'));

// 2. 检查器概览
const inspectorProps = {
  state,
  dietary,
  geometryIssues: [],
  manualScore: score,
  onSeatGuest: noop,
  onUnseatGuest: noop,
  onToggleLock: noop,
  onEditGuest: noop,
  onDeleteGuest: noop,
  onChangeTable: noop,
  onAddChildChair: noop,
  onRemoveChildChair: noop,
  onAddRelation: noop,
  onDeleteRelation: noop,
  onAddPreference: noop,
  onDeletePreference: noop,
  onUpsertDietary: noop,
  onDeleteDietary: noop,
  onApplyCandidate: noop,
  onDiscardCandidate: noop,
};
const overviewHtml = renderToString(<Inspector {...inspectorProps} />);
assert('检查器概览渲染软代价', overviewHtml.includes('手工方案'));
assert('检查器含几何免责声明', overviewHtml.includes('不声称通过任何消防安全认证'));

// 3. 选中宾客（含忌口面板）
const guestState: PlannerState = { ...state, selectedGuestId: 'g-zhougrandma' };
const guestHtml = renderToString(
  <Inspector {...inspectorProps} state={guestState} />,
);
assert('宾客面板显示显示名', guestHtml.includes('周奶奶'));
assert('宾客面板渲染已有忌口（清真）', guestHtml.includes('清真'));
assert('宾客面板渲染关系行', guestHtml.includes('家庭'));

// 4. 选中桌子
const tableState: PlannerState = { ...state, selectedTableId: 'T2' };
const tableHtml = renderToString(
  <Inspector {...inspectorProps} state={tableState} />,
);
assert('桌子面板渲染容量与童椅入口', tableHtml.includes('容量') && tableHtml.includes('儿童椅占位'));

// 5. 自动方案可行候选对比卡
const feasibleCandidate: AutoPlanCandidate = {
  generatedAt: Date.now(),
  assignments: project.assignments,
  costBreakdown: { preferNear: 2, tablePreference: 4, pendingSeated: 0, total: 6 },
  status: 'optimal',
  unseatedGuestIds: [],
};
const candidateHtml = renderToString(
  <Inspector {...inspectorProps} state={{ ...state, autoCandidate: feasibleCandidate }} />,
);
assert('对比卡同时显示手工/自动方案', candidateHtml.includes('自动方案候选') && candidateHtml.includes('当前手工方案'));
assert('对比卡有应用与放弃按钮', candidateHtml.includes('应用自动方案') && candidateHtml.includes('放弃，保留手工方案'));

// 6. 无解候选卡（用无解样例的诊断文案）
const infeasibleProject = buildInfeasibleSampleProject();
const infeasibleCandidate: AutoPlanCandidate = {
  generatedAt: Date.now(),
  assignments: [],
  costBreakdown: { preferNear: 0, tablePreference: 0, pendingSeated: 0, total: 0 },
  status: 'infeasible',
  unseatedGuestIds: [],
  infeasibilityHint: '关系矛盾：周建国 与 周奶奶 既被家庭关系绑定又被要求避让；避让关系冲突：双方已锁定在同一桌 T6',
};
const infeasibleHtml = renderToString(
  <Inspector
    {...inspectorProps}
    state={{ ...stateFor(infeasibleProject), autoCandidate: infeasibleCandidate }}
  />,
);
assert('无解卡显示警告与诊断', infeasibleHtml.includes('自动排座无解') && infeasibleHtml.includes('家庭关系'));
assert('无解卡说明手工方案未改动', infeasibleHtml.includes('当前手工方案未被改动'));

// 7. 桌卡 HTML 端到端（忌口随独立数据出现）
const cardsHtml = placeCardsHtml(project, dietary, true);
assert('桌卡 HTML 含文档结构', cardsHtml.startsWith('<!doctype html>') && cardsHtml.includes('桌卡'));
assert('桌卡含忌口（清真 / 坚果过敏）', cardsHtml.includes('清真') && cardsHtml.includes('坚果过敏'));
assert('桌卡含未排座宾客标记', cardsHtml.includes('未排座'));
assert('桌卡 HTML 已转义（无裸 < 注入）', !cardsHtml.includes('<script>'));

void asyncNoop;
console.log(`\nUI 冒烟 ${failed === 0 ? '全部通过 ✅' : `有 ${failed} 项失败 ❌`}`);
process.exit(failed === 0 ? 0 : 1);
