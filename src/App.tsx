import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SeatingProject, VenueTable } from './types';
import { createSampleProject } from './lib/sample';
import { useProjectStore } from './state/store';
import { useSolverWorker } from './state/useSolverWorker';
import { buildSolveInput, preDiagnose } from './lib/model';
import { GuestSidebar } from './components/GuestSidebar';
import { VenueCanvas } from './components/VenueCanvas';
import { PlanPanel, DiagnosticsBanner } from './components/PlanPanel';
import { CompareModal } from './components/CompareModal';
import { TableEditor, newTable } from './components/TableEditor';
import { evaluateCurrent, hardViolations } from './lib/evaluate';
import { downloadJson, deleteProject, listProjects } from './lib/db';
import { exportCardsCsv, exportCardsHtml } from './lib/exportCards';
import { uid } from './lib/ids';

export function App() {
  const [project, setProject] = useState<SeatingProject | null>(null);
  if (!project) return <Boot onOpen={setProject} />;
  return <Editor initial={project} />;
}

function Boot({ onOpen }: { onOpen: (p: SeatingProject) => void }) {
  const [bad, setBad] = useState<string | null>(null);
  const [saved, setSaved] = useState<SeatingProject[] | null>(null);

  useEffect(() => {
    listProjects().then((all) => setSaved(all)).catch(() => setSaved([]));
  }, []);

  const openImport = async (file: File) => {
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as SeatingProject;
      if (!Array.isArray(obj.guests) || !obj.venue || !Array.isArray(obj.venue.tables)) {
        throw new Error('文件不是有效的工程 JSON');
      }
      onOpen(normalizeProject(obj));
    } catch (e) {
      setBad(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="start">
      <div className="card2">
        <h1>💒 离线婚礼桌位编排器</h1>
        <p>
          宾客关系与真实场地布局一起规划：React + TypeScript 管理宾客侧栏，Konva 绘制桌椅与通道，
          glpk.js 在 Web Worker 中求解同桌/分桌/容量约束，工程保存在 IndexedDB，
          <b> 全程无服务端、可离线运行</b>。
        </p>
        <div className="btns">
          <button className="primary" onClick={() => onOpen(createSampleProject({ withConflict: true }))}>
            打开演示样例（冲突无解 / 儿童椅占位 / 未回复宾客）
          </button>
          <label className="checkline" style={{ cursor: 'pointer' }}>
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && openImport(e.target.files[0])}
            />
            <span className="badge" style={{ padding: '5px 10px' }}>📂 导入工程 JSON…</span>
          </label>
        </div>

        {saved && saved.length > 0 && (
          <>
            <div className="section-title">本机工程（IndexedDB）</div>
            {saved.map((p) => (
              <div className="proj-row" key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <button className="nm" style={{ flex: 1, textAlign: 'left' }} onClick={() => onOpen(normalizeProject(p))}>
                  {p.name}
                  <span className="small"> · {p.guests.length} 位宾客 · {new Date(p.updatedAt).toLocaleString('zh-CN')}</span>
                </button>
                <button
                  className="danger ghost"
                  title="删除本机工程"
                  onClick={async () => {
                    if (!confirm(`删除本机工程「${p.name}」？`)) return;
                    await deleteProject(p.id);
                    setSaved((cur) => (cur ? cur.filter((x) => x.id !== p.id) : cur));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}

        {bad && <div style={{ color: 'var(--danger)', marginTop: 10 }}>导入失败：{bad}</div>}
        <div className="disclaimer">
          过道与消防出口区域的禁止占用多边形仅用于 <b>几何相交检查</b>，帮助桌位避开区域；
          本工具不声称通过任何消防/疏散安全认证，实际布置请由场地与安全负责方确认。
        </div>
      </div>
    </div>
  );
}

/** 导入老/外部 JSON 时补齐缺失字段（保证 seats/lockedSeats 与桌数对齐） */
function normalizeProject(obj: SeatingProject): SeatingProject {
  const p: SeatingProject = {
    ...obj,
    id: obj.id || uid('proj'),
    guests: obj.guests ?? [],
    families: obj.families ?? [],
    relations: obj.relations ?? [],
    nearPrefs: obj.nearPrefs ?? [],
    venue: {
      width: obj.venue?.width ?? 1000,
      height: obj.venue?.height ?? 800,
      tables: obj.venue?.tables ?? [],
      zones: obj.venue?.zones ?? [],
    },
    seats: obj.seats ?? {},
    lockedSeats: obj.lockedSeats ?? {},
    includePending: obj.includePending ?? false,
  };
  for (const t of p.venue.tables) {
    const row = p.seats[t.id] ?? [];
    while (row.length < t.seats) row.push(null);
    row.length = t.seats;
    p.seats[t.id] = row;
    const locks = p.lockedSeats[t.id] ?? new Array(t.seats).fill(false);
    while (locks.length < t.seats) locks.push(false);
    locks.length = t.seats;
    p.lockedSeats[t.id] = locks;
  }
  return p;
}

function Editor({ initial }: { initial: SeatingProject }) {
  const store = useProjectStore(initial);
  const {
    project, commit, undo, redo, canUndo, canRedo, persist, replaceAll,
    plan, setAutoPlan,
  } = store;
  const { solve, running } = useSolverWorker();
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind?: 'error' | 'ok' } | null>(null);
  const [layoutMode, setLayoutMode] = useState(false);
  const [editingTable, setEditingTable] = useState<VenueTable | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const notify = useCallback((msg: string, kind?: 'error' | 'ok') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => store.onKey(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [store]);

  // 防抖自动保存到 IndexedDB
  useEffect(() => {
    if (!store.dirty) return;
    const t = window.setTimeout(() => persist(), 1200);
    return () => window.clearTimeout(t);
  }, [project, persist, store.dirty]);

  const curCost = useMemo(() => evaluateCurrent(project), [project]);
  const hardFails = useMemo(() => hardViolations(project), [project]);

  const runAuto = useCallback(async () => {
    setDiagnostics([]);
    const built = buildSolveInput(project);
    const diag = preDiagnose(built.problem);
    if (!diag.feasible) {
      setDiagnostics(diag.reasons);
      notify('硬条件无解，未启动求解', 'error');
      return;
    }
    const resp = await solve(built.problem, 10000);
    if (resp.status === 'error' || !resp.result) {
      notify(resp.error ?? '求解失败', 'error');
      return;
    }
    setAutoPlan({
      assignment: resp.result.assignment,
      cost: resp.result.cost,
      unseated: resp.result.unseatedGuestIds,
      status: resp.status,
    });
    notify('自动方案已生成（预览，未改座位），可比较、应用或丢弃', 'ok');
  }, [project, solve, setAutoPlan, notify]);

  const saveTable = (t: VenueTable) => {
    commit(
      (p) => {
        const n = structuredClone(p);
        if (t.isHead) for (const x of n.venue.tables) if (x.id !== t.id) x.isHead = false;
        const idx = n.venue.tables.findIndex((x) => x.id === t.id);
        if (idx < 0) n.venue.tables.push(t);
        else n.venue.tables[idx] = t;
        const row = n.seats[t.id] ?? [];
        while (row.length < t.seats) row.push(null);
        row.length = t.seats;
        n.seats[t.id] = row;
        const locks = n.lockedSeats[t.id] ?? [];
        while (locks.length < t.seats) locks.push(false);
        locks.length = t.seats;
        n.lockedSeats[t.id] = locks;
        return n;
      },
      { keepPlan: true },
    );
    setEditingTable(null);
  };

  const deleteTable = (id: string) => {
    commit(
      (p) => {
        const n = structuredClone(p);
        n.venue.tables = n.venue.tables.filter((t) => t.id !== id);
        delete n.seats[id];
        delete n.lockedSeats[id];
        return n;
      },
      { keepPlan: true },
    );
    setEditingTable(null);
  };

  const addTable = () => {
    const t = newTable(
      120 + Math.random() * (project.venue.width - 240),
      200 + Math.random() * (project.venue.height - 320),
    );
    commit(
      (p) => {
        const n = structuredClone(p);
        n.venue.tables.push(t);
        n.seats[t.id] = new Array(t.seats).fill(null);
        n.lockedSeats[t.id] = new Array(t.seats).fill(false);
        return n;
      },
      { keepPlan: true },
    );
    setEditingTable(t);
  };

  const loadSample = (withConflict: boolean) => {
    if (!confirm('载入演示样例会替换当前工程内容（可先导出工程备份）。继续？')) return;
    replaceAll(createSampleProject({ withConflict }));
    setSelectedGuestId(null);
    setDiagnostics([]);
    notify(withConflict ? '已载入冲突无解样例' : '已载入可解样例', 'ok');
  };

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">💒 {project.name}</span>
        <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶ 撤销</button>
        <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">↷ 重做</button>
        <span className="spacer" />
        <label className="checkline" style={{ margin: 0 }} title="未回复(pending)宾客是否参与自动排座">
          <input
            type="checkbox"
            checked={project.includePending}
            onChange={(e) => commit((p) => ({ ...p, includePending: e.target.checked }), { keepPlan: true })}
          />
          纳入未回复
        </label>
        <button onClick={() => setLayoutMode((v) => !v)} className={layoutMode ? 'primary' : ''}>
          {layoutMode ? '🪑 座位模式' : '📐 布局模式'}
        </button>
        {layoutMode && <button onClick={addTable}>＋ 新桌</button>}
        <button onClick={runAuto} disabled={running} className="primary">
          {running ? 'Worker 求解中…' : '⚙ 自动排座'}
        </button>
        <button title="当前手工方案的软代价（与自动方案口径一致）">
          手工代价 <b className="mono">{curCost.total}</b>
        </button>
        <button onClick={() => exportCardsCsv(project)}>桌卡 CSV</button>
        <button onClick={() => exportCardsHtml(project)}>桌卡 HTML</button>
        <button onClick={() => downloadJson(project)}>导出工程</button>
        <select
          title="载入样例"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value === 'conflict') loadSample(true);
            if (e.target.value === 'ok') loadSample(false);
            e.target.value = '';
          }}
        >
          <option value="" disabled>载入样例…</option>
          <option value="conflict">冲突无解样例</option>
          <option value="ok">可解样例（无冲突）</option>
        </select>
        <button onClick={persist} title="立即保存到 IndexedDB">💾 保存</button>
      </div>

      {hardFails.length > 0 && (
        <div style={{ background: '#fdf3f2', borderBottom: '1px solid #e3b8b2', padding: '4px 12px', fontSize: 12, color: 'var(--danger)' }}>
          ⚠ 当前手工席位违反 {hardFails.length} 条硬条件：{hardFails.slice(0, 3).join('；')}
          {hardFails.length > 3 ? ' …' : ''}（自动排座始终遵守硬条件，锁定座不会被移动）
        </div>
      )}

      <div className="main">
        <GuestSidebar
          store={store}
          selectedGuestId={selectedGuestId}
          onSelectGuest={setSelectedGuestId}
        />
        <VenueCanvas
          store={store}
          selectedGuestId={selectedGuestId}
          onSelectGuest={setSelectedGuestId}
          notify={notify}
          layoutMode={layoutMode}
          onEditTable={(t) => setEditingTable(t)}
        />
      </div>

      <DiagnosticsBanner reasons={diagnostics} onDismiss={() => setDiagnostics([])} />
      <PlanPanel store={store} onCompare={() => setShowCompare(true)} />

      {plan && showCompare && (
        <CompareModal project={project} plan={plan} onClose={() => setShowCompare(false)} />
      )}

      {editingTable && (
        <TableEditor
          project={project}
          table={editingTable}
          onClose={() => setEditingTable(null)}
          onSave={saveTable}
          onDelete={deleteTable}
        />
      )}

      {toast && <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
