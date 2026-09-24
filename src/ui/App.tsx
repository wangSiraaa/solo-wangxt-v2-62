import { useEffect, useMemo, useState } from 'react';
import { Stage } from 'react-konva';
import type { TableDef, WeddingProject, DietaryRestriction } from '../types';
import { db } from '../lib/db';
import {
  buildSampleProject,
  buildInfeasibleSampleProject,
} from '../lib/samples';
import { usePlanner } from './usePlanner';
import GuestSidebar from './GuestSidebar';
import Inspector from './Inspector';
import VenueCanvas from './VenueCanvas';
import { downloadPlaceCards } from '../lib/placecards';
import { uid } from '../lib/ids';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; project: WeddingProject; dietary: DietaryRestriction[] }
  | { kind: 'empty' };

export default function App() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await db.listProjects();
        const dietary = await db.loadAllDietary();
        if (cancelled) return;
        if (projects.length > 0) {
          // 最近编辑的工程
          const project = projects.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          setLoad({ kind: 'ready', project, dietary: dietary.length ? dietary : project.dietary });
        } else {
          setLoad({ kind: 'empty' });
        }
      } catch {
        if (!cancelled) setLoad({ kind: 'empty' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.kind === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6f6455' }}>正在打开本地工程…</div>;
  }
  if (load.kind === 'empty') {
    return <Welcome onPick={(project, dietary) => setLoad({ kind: 'ready', project, dietary })} />;
  }
  return (
    <Planner
      key={load.project.id}
      initialProject={load.project}
      initialDietary={load.dietary}
    />
  );
}

function Welcome({
  onPick,
}: {
  onPick: (project: WeddingProject, dietary: DietaryRestriction[]) => void;
}) {
  const start = (project: WeddingProject) => {
    void db.saveProject(project);
    void db.saveDietary(project.dietary);
    onPick(project, project.dietary);
  };
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f4f1ec, #ece2d4)',
      }}
    >
      <div
        style={{
          background: '#fffdf8',
          border: '1px solid #e2d8c7',
          borderRadius: 16,
          padding: '36px 44px',
          maxWidth: 560,
          boxShadow: '0 8px 30px rgba(60,45,30,0.12)',
        }}
      >
        <h1 style={{ margin: '0 0 6px', color: '#8a5a3b', letterSpacing: 2 }}>
          离线婚礼桌位编排器
        </h1>
        <p style={{ color: '#6f6455', fontSize: 13, lineHeight: 1.9, marginTop: 0 }}>
          宾客关系与真实场地布局联合编排：React + TypeScript 管理宾客侧栏，Konva
          绘制桌椅与过道，glpk.js 在 Web Worker 中求解同桌 / 避让 / 容量约束。
          工程仅存入本机 IndexedDB，无服务端。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          <button className="primary" onClick={() => start(buildSampleProject())}>
            载入常规样例工程（同名宾客 / 儿童椅 / 未回复 / 锁定 / 偏好）
          </button>
          <button onClick={() => start(buildInfeasibleSampleProject())}>
            载入“冲突无解”样例工程（家庭+避让矛盾、锁定同桌避让）
          </button>
        </div>
        <p style={{ color: '#998b78', fontSize: 11, lineHeight: 1.7, marginTop: 18 }}>
          过道与消防出口缓冲区为项目提供的禁止占用多边形，只做几何占用检查，
          不声称通过任何消防安全认证。
        </p>
      </div>
    </div>
  );
}

function Planner({
  initialProject,
  initialDietary,
}: {
  initialProject: WeddingProject;
  initialDietary: DietaryRestriction[];
}) {
  const c = usePlanner(initialProject, initialDietary);
  const { state } = c;
  const [seatPending, setSeatPending] = useState(false);
  const [showCandidateOverlay, setShowCandidateOverlay] = useState(true);

  const dietaryGuestIds = useMemo(
    () => new Set(c.dietary.map((d) => d.guestId)),
    [c.dietary],
  );

  // 候选方案一旦变化，重新显示对比浮层
  useEffect(() => {
    setShowCandidateOverlay(true);
  }, [state.autoCandidate]);

  // 撤销快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isTyping(e.target)) {
        e.preventDefault();
        c.undoLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSeatClick = (tableId: string, seatIndex: number) => {
    // 点击空位：把当前选中宾客放过去；点击已坐宾客：选中该宾客
    const a = state.project.assignments.find(
      (x) => x.tableId === tableId && x.seatIndex === seatIndex,
    );
    if (a?.guestId) {
      c.selectGuest(a.guestId);
      return;
    }
    if (state.selectedGuestId) {
      c.seatGuest(state.selectedGuestId, tableId, seatIndex);
    }
  };

  const addNewTable = () => {
    const venue = state.project.venue;
    const table: TableDef = {
      id: uid('T'),
      label: `${state.project.tables.length + 1} 号桌`,
      capacity: 8,
      shape: 'round',
      x: Math.min(venue.width - 80, 120 + (state.project.tables.length % 5) * 40),
      y: Math.min(venue.height - 80, 380 + Math.floor(state.project.tables.length / 5) * 40),
      radius: 52,
      isHeadTable: false,
    };
    c.addTable(table);
    c.selectTable(table.id);
  };

  const statusTone =
    state.autoCandidate?.status === 'infeasible' || state.statusMessage?.includes('无解')
      ? 'error'
      : state.statusMessage?.includes('已应用')
        ? 'success'
        : '';

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">💍 桌位编排</span>
        <input
          className="name"
          value={state.project.name}
          onChange={(e) => c.setProjectName(e.target.value)}
        />
        <span className="badge offline">离线 · IndexedDB 本地存储</span>
        <span className="spacer" />
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
          <input
            type="checkbox"
            checked={seatPending}
            onChange={(e) => setSeatPending(e.target.checked)}
          />
          自动排座时也排入未回复宾客
        </label>
        <button onClick={() => void c.runAuto(seatPending)} disabled={state.solving}>
          {state.solving ? 'Worker 求解中…' : '自动排座'}
        </button>
        <button onClick={addNewTable}>＋ 新桌</button>
        <button
          onClick={() => downloadPlaceCards(state.project, c.dietary, true)}
          title="导出可打印桌卡 HTML；忌口从独立存储读取，换座不会丢失"
        >
          导出桌卡
        </button>
        <button
          className="ghost"
          onClick={c.undoLast}
          disabled={!c.undoAvailable}
          title="撤销上一步手工操作（Ctrl/Cmd+Z）"
        >
          ↩︎ 撤销{c.lastUndoLabel ? `（${c.lastUndoLabel}）` : ''}
        </button>
      </header>

      <div className="main">
        <GuestSidebar
          project={state.project}
          dietaryGuestIds={dietaryGuestIds}
          selectedGuestId={state.selectedGuestId}
          onSelectGuest={(id) =>
            c.selectGuest(state.selectedGuestId === id ? null : id)
          }
          onCreateGuest={c.createGuest}
        />

        <main className="canvas-wrap">
          <div className="canvas-toolbar">
            <span className="muted">
              拖动桌子调整布局；点击宾客再点座位安排；锁定座位 🔒 不受自动排座影响
            </span>
            <span className="spacer" />
            <span className="cost-pill">
              手工软代价 <b>{c.manualScore.total}</b>
              {' '}（同桌 {c.manualScore.preferNear} · 靠桌 {c.manualScore.tablePreference}
              {c.manualScore.pendingSeated > 0 ? ` · 未回复 ${c.manualScore.pendingSeated}` : ''}）
            </span>
          </div>
          <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
            <Stage
              width={state.project.venue.width}
              height={state.project.venue.height}
              onContentClick={() => {
                c.selectTable(null);
              }}
            >
              <VenueCanvas
                project={state.project}
                venue={state.project.venue}
                geometryIssues={c.geometryIssues}
                selectedTableId={state.selectedTableId}
                selectedGuestId={state.selectedGuestId}
                candidateAssignments={
                  showCandidateOverlay &&
                  state.autoCandidate &&
                  state.autoCandidate.status !== 'infeasible'
                    ? state.autoCandidate.assignments
                    : null
                }
                onSelectTable={(id) => c.selectTable(id)}
                onDragMoveTable={c.dragTable}
                onDragEndTable={c.commitTableDrag}
                onSeatClick={handleSeatClick}
              />
            </Stage>
          </div>
          <div className={`statusline ${statusTone}`}>
            {state.solving
              ? 'glpk.js 正在 Web Worker 中求解 MILP…'
              : state.statusMessage ??
                (c.geometryIssues.length > 0
                  ? `检测到 ${c.geometryIssues.length} 个几何问题（见右侧检查器）`
                  : '就绪：硬条件必须满足，软偏好以代价显示；几何检查仅为占用判断，非安全认证。')}
          </div>
        </main>

        <Inspector
          state={state}
          dietary={c.dietary}
          geometryIssues={c.geometryIssues}
          manualScore={c.manualScore}
          onSeatGuest={c.seatGuest}
          onUnseatGuest={c.unseatGuest}
          onToggleLock={c.toggleLock}
          onEditGuest={c.editGuest}
          onDeleteGuest={c.deleteGuest}
          onChangeTable={c.changeTable}
          onAddChildChair={c.addChildChair}
          onRemoveChildChair={c.removeChildChair}
          onAddRelation={c.addRelation}
          onDeleteRelation={c.deleteRelation}
          onAddPreference={c.addPreference}
          onDeletePreference={c.deletePreference}
          onUpsertDietary={c.upsertDietary}
          onDeleteDietary={c.deleteDietary}
          onApplyCandidate={() => {
            c.applyCandidate();
          }}
          onDiscardCandidate={() => {
            setShowCandidateOverlay(false);
            c.discardCandidate();
          }}
        />
      </div>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
