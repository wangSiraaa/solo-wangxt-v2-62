import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AutoPlanCandidate,
  DietaryRestriction,
  Guest,
  GuestRelation,
  PlannerState,
  ProximityStrength,
  SolverInput,
  SolveResult,
  TableDef,
  WeddingProject,
} from '../types';
import { db } from '../lib/db';
import { uid } from '../lib/ids';
import {
  addGuest as addGuestOp,
  addTable as addTableOp,
  applyAutoAssignments,
  removeGuest as removeGuestOp,
  seatGuest as seatGuestOp,
  setSeatLock as setSeatLockOp,
  unseatGuest as unseatGuestOp,
  updateGuest as updateGuestOp,
  updateTable as updateTableOp,
  addChildChair as addChildChairOp,
  removeChildChair as removeChildChairOp,
  addRelation as addRelationOp,
  deleteRelation as deleteRelationOp,
  addTablePreference as addTablePreferenceOp,
  deleteTablePreference as deleteTablePreferenceOp,
} from '../lib/actions';
import { canUndo, pushHistory, undo, type History } from '../lib/history';
import { tableDistanceMatrix } from '../lib/distance';
import { solveInWorker } from '../solver/client';
import { scoreAssignments } from '../solver/model';
import { checkAllGeometry, type GeometryIssue } from '../lib/geometry';

export interface PlannerController {
  state: PlannerState;
  dietary: DietaryRestriction[];
  geometryIssues: GeometryIssue[];
  manualScore: ReturnType<typeof scoreAssignments>;
  undoAvailable: boolean;
  lastUndoLabel: string | null;

  selectGuest: (id: string | null) => void;
  selectTable: (id: string | null) => void;

  runAuto: (seatPending: boolean) => Promise<void>;
  applyCandidate: () => void;
  discardCandidate: () => void;

  seatGuest: (guestId: string, tableId: string, seatIndex?: number) => void;
  unseatGuest: (guestId: string) => void;
  toggleLock: (guestId: string) => void;
  addChildChair: (tableId: string) => void;
  removeChildChair: (assignmentId: string) => void;
  dragTable: (tableId: string, x: number, y: number) => void;
  commitTableDrag: () => void;
  changeTable: (tableId: string, patch: Partial<TableDef>) => void;
  addTable: (table: TableDef) => void;

  createGuest: (data: {
    name: string;
    rsvp: Guest['rsvp'];
    isChild: boolean;
    note?: string;
  }) => void;
  editGuest: (guestId: string, patch: Partial<Guest>) => void;
  deleteGuest: (guestId: string) => void;

  setProjectName: (name: string) => void;
  undoLast: () => void;
  resetTo: (project: WeddingProject, dietary: DietaryRestriction[]) => void;

  upsertDietary: (guestId: string, type: string, detail?: string) => void;
  deleteDietary: (id: string) => void;

  addRelation: (rel: Omit<GuestRelation, 'id'>) => void;
  deleteRelation: (id: string) => void;
  addPreference: (guestId: string, tableId: string | undefined, strength: ProximityStrength) => void;
  deletePreference: (id: string) => void;
}

function makeInitialState(project: WeddingProject): PlannerState {
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

export function usePlanner(
  initialProject: WeddingProject,
  initialDietary: DietaryRestriction[],
): PlannerController {
  const [state, setState] = useState<PlannerState>(() => makeInitialState(initialProject));
  const [dietary, setDietary] = useState<DietaryRestriction[]>(initialDietary);
  const [history, setHistory] = useState<History>({ past: [] });
  const historyRef = useRef(history);
  historyRef.current = history;
  const stateRef = useRef(state);
  stateRef.current = state;

  // 拖动中的临时坐标（不入撤销栈；commitTableDrag 时才整体入栈）
  const dragStartRef = useRef<{ tableId: string; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  // ── 持久化（防抖）───────────────────────────────────────────────────────
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void db.saveProject(state.project);
    }, 400);
  }, [state.project]);

  useEffect(() => {
    const t = window.setTimeout(() => void db.saveDietary(dietary), 400);
    return () => window.clearTimeout(t);
  }, [dietary]);

  // 几何 / 当前手工方案代价（随状态派生）
  const geometryIssues = useMemo(
    () => checkAllGeometry(state.project.tables, state.project.venue),
    [state.project.tables, state.project.venue],
  );

  const solverInput: SolverInput = useMemo(
    () => ({
      guests: state.project.guests,
      tables: state.project.tables,
      relations: state.project.relations,
      tablePreferences: state.project.tablePreferences,
      assignments: state.project.assignments,
      seatPending: false,
      tableDistance: tableDistanceMatrix(state.project.tables),
    }),
    [state.project],
  );

  const manualScore = useMemo(
    () => scoreAssignments(solverInput, state.project.assignments),
    [solverInput, state.project.assignments],
  );

  /** 执行一个会修改 project 的手工操作：先压栈快照，再应用；
   *  手工改动会使未应用的自动候选过期，一并清除。 */
  const mutateProject = useCallback(
    (label: string, fn: (p: WeddingProject) => WeddingProject) => {
      const prev = stateRef.current;
      setHistory((h) => pushHistory(h, label, prev));
      setState({
        ...prev,
        project: fn(prev.project),
        autoCandidate: null,
        statusMessage: null,
      });
    },
    [],
  );

  const showMessage = useCallback((statusMessage: string | null) => {
    setState((prev) => ({ ...prev, statusMessage }));
  }, []);

  // ── 选择 ──────────────────────────────────────────────────────────────────
  const selectGuest = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedGuestId: id }));
  }, []);

  const selectTable = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedTableId: id }));
  }, []);

  // ── 自动排座 ──────────────────────────────────────────────────────────────
  const runAuto = useCallback(
    async (seatPending: boolean) => {
      setState((prev) => ({ ...prev, solving: true, statusMessage: 'Worker 求解中…' }));
      try {
        const input: SolverInput = { ...solverInput, seatPending };
        const result: SolveResult = await solveInWorker(input);
        const candidate: AutoPlanCandidate = {
          generatedAt: Date.now(),
          assignments: result.assignments,
          costBreakdown: result.costBreakdown,
          status: result.status,
          unseatedGuestIds: result.unseatedGuestIds,
          infeasibilityHint: result.infeasibilityHint,
        };
        setState((prev) => ({
          ...prev,
          solving: false,
          autoCandidate: candidate,
          statusMessage:
            result.status === 'infeasible'
              ? `自动排座无解：${result.infeasibilityHint ?? '硬条件冲突'}`
              : `自动方案已生成（代价 ${result.costBreakdown.total}），可对比后应用`,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          solving: false,
          statusMessage: `求解失败：${(err as Error).message}`,
        }));
      }
    },
    [solverInput],
  );

  const applyCandidate = useCallback(() => {
    const prev = stateRef.current;
    if (!prev.autoCandidate || prev.autoCandidate.status === 'infeasible') return;
    setHistory((h) => pushHistory(h, '应用自动方案', prev));
    setState({
      ...prev,
      project: applyAutoAssignments(prev.project, prev.autoCandidate.assignments),
      autoCandidate: null,
      statusMessage: '已应用自动方案（可撤销）',
    });
  }, []);

  const discardCandidate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      autoCandidate: null,
      statusMessage: '已放弃自动方案，保留当前手工方案',
    }));
  }, []);

  // ── 手工座位操作 ─────────────────────────────────────────────────────────
  const seatGuest = useCallback(
    (guestId: string, tableId: string, seatIndex?: number) => {
      const guest = state.project.guests.find((g) => g.id === guestId);
      const table = state.project.tables.find((t) => t.id === tableId);
      const res = seatGuestOp(state.project, guestId, tableId, { seatIndex });
      if (res.ok) {
        mutateProject(
          seatIndex !== undefined ? `安排到${table?.label ?? ''}指定座位` : `安排到${table?.label ?? ''}`,
          () => res.project,
        );
        setState((prev) => ({ ...prev, selectedTableId: tableId }));
      } else {
        showMessage(res.reason ?? '无法安排');
      }
      void guest;
    },
    [state.project, mutateProject, showMessage],
  );

  const unseatGuest = useCallback(
    (guestId: string) => {
      const res = unseatGuestOp(state.project, guestId);
      if (res.ok) mutateProject('撤下宾客', () => res.project);
      else showMessage(res.reason ?? '无法撤下');
    },
    [state.project, mutateProject, showMessage],
  );

  const toggleLock = useCallback(
    (guestId: string) => {
      const current = state.project.assignments.find((a) => a.guestId === guestId);
      if (!current) {
        showMessage('宾客尚未入座');
        return;
      }
      const res = setSeatLockOp(state.project, guestId, !current.locked);
      if (res.ok) {
        mutateProject(current.locked ? '解锁座位' : '锁定座位', () => res.project);
      }
    },
    [state.project, mutateProject, showMessage],
  );

  const addChildChair = useCallback(
    (tableId: string) => {
      const res = addChildChairOp(state.project, tableId);
      if (res.ok) mutateProject('添加儿童椅占位', () => res.project);
      else showMessage(res.reason ?? '无法添加');
    },
    [state.project, mutateProject, showMessage],
  );

  const removeChildChair = useCallback(
    (assignmentId: string) => {
      const res = removeChildChairOp(state.project, assignmentId);
      if (res.ok) mutateProject('移除儿童椅占位', () => res.project);
      else showMessage(res.reason ?? '无法移除');
    },
    [state.project, mutateProject, showMessage],
  );

  // ── 桌子 ─────────────────────────────────────────────────────────────────
  const dragTable = useCallback((tableId: string, x: number, y: number) => {
    if (!draggingRef.current) {
      draggingRef.current = true;
      const prev = stateRef.current;
      const t = prev.project.tables.find((x2) => x2.id === tableId);
      dragStartRef.current = null;
      if (t) {
        // 记录拖动前的完整状态快照坐标，commit 时用于入栈
        dragStartRef.current = { tableId, x: t.x, y: t.y };
      }
    }
    const prev = stateRef.current;
    const tables = prev.project.tables.map((x2) =>
      x2.id === tableId ? { ...x2, x: Math.round(x), y: Math.round(y) } : x2,
    );
    setState({ ...prev, project: { ...prev.project, tables } });
  }, []);

  const commitTableDrag = useCallback(() => {
    if (!draggingRef.current) {
      draggingRef.current = false;
      dragStartRef.current = null;
      return;
    }
    const start = dragStartRef.current;
    draggingRef.current = false;
    dragStartRef.current = null;
    if (!start) return;
    const prev = stateRef.current;
    const t = prev.project.tables.find((x) => x.id === start.tableId);
    if (!t || (t.x === start.x && t.y === start.y)) return;
    const before: PlannerState = {
      ...prev,
      project: {
        ...prev.project,
        tables: prev.project.tables.map((x) =>
          x.id === start.tableId ? { ...x, x: start.x, y: start.y } : x,
        ),
      },
    };
    setHistory((h) => pushHistory(h, '拖动桌子', before));
    setState({ ...prev, project: { ...prev.project, updatedAt: Date.now() } });
  }, []);

  const changeTable = useCallback(
    (tableId: string, patch: Partial<TableDef>) => {
      const res = updateTableOp(state.project, tableId, patch);
      if (res.ok) mutateProject('修改桌子', () => res.project);
    },
    [state.project, mutateProject],
  );

  const addTable = useCallback(
    (table: TableDef) => {
      const res = addTableOp(state.project, table);
      if (res.ok) mutateProject('新增桌子', () => res.project);
    },
    [state.project, mutateProject],
  );

  // ── 宾客 ─────────────────────────────────────────────────────────────────
  const createGuest = useCallback(
    (data: { name: string; rsvp: Guest['rsvp']; isChild: boolean; note?: string }) => {
      mutateProject('新增宾客', (p) =>
        addGuestOp(p, {
          id: uid('g'),
          name: data.name.trim(),
          partyId: null,
          rsvp: data.rsvp,
          isChild: data.isChild,
          note: data.note,
        }),
      );
    },
    [mutateProject],
  );

  const editGuest = useCallback(
    (guestId: string, patch: Partial<Guest>) => {
      mutateProject('修改宾客', (p) => updateGuestOp(p, guestId, patch));
    },
    [mutateProject],
  );

  const deleteGuest = useCallback(
    (guestId: string) => {
      mutateProject('删除宾客', (p) => removeGuestOp(p, guestId));
      setDietary((list) => list); // 忌口独立保留，不随宾客删除（actions.removeGuest 也不动）
    },
    [mutateProject],
  );

  const setProjectName = useCallback(
    (name: string) => {
      mutateProject('重命名工程', (p) => ({ ...p, name }));
    },
    [mutateProject],
  );

  // ── 撤销 ─────────────────────────────────────────────────────────────────
  const undoLast = useCallback(() => {
    const result = undo(historyRef.current);
    if (!result) return;
    setHistory(result.history);
    setState({ ...result.state, statusMessage: `已撤销：${result.label}` });
  }, []);

  const resetTo = useCallback((project: WeddingProject, nextDietary: DietaryRestriction[]) => {
    setState(makeInitialState(project));
    setDietary(nextDietary);
    setHistory({ past: [] });
    dragStartRef.current = null;
    draggingRef.current = false;
  }, []);

  // ── 关系 / 偏好 ─────────────────────────────────────────────────────────
  const addRelation = useCallback(
    (rel: Omit<GuestRelation, 'id'>) => {
      const kindLabel = rel.kind === 'family' ? '家庭' : rel.kind === 'avoid' ? '避让' : '同桌偏好';
      mutateProject(`添加${kindLabel}关系`, (p) => addRelationOp(p, rel));
    },
    [mutateProject],
  );

  const deleteRelation = useCallback(
    (id: string) => {
      mutateProject('删除关系', (p) => deleteRelationOp(p, id));
    },
    [mutateProject],
  );

  const addPreference = useCallback(
    (guestId: string, tableId: string | undefined, strength: ProximityStrength) => {
      mutateProject('添加靠近偏好', (p) =>
        addTablePreferenceOp(p, guestId, tableId, strength),
      );
    },
    [mutateProject],
  );

  const deletePreference = useCallback(
    (id: string) => {
      mutateProject('删除靠近偏好', (p) => deleteTablePreferenceOp(p, id));
    },
    [mutateProject],
  );

  // ── 忌口（独立 store；同步镜像到 project.dietary 便于导出函数使用）──────
  const upsertDietary = useCallback(
    (guestId: string, type: string, detail?: string) => {
      const record: DietaryRestriction = { id: uid('diet'), guestId, type: type.trim(), detail };
      const nextDietary = [...stateRef.current.project.dietary, record];
      setDietary(nextDietary);
      setState((prev) => ({
        ...prev,
        project: { ...prev.project, dietary: nextDietary },
      }));
    },
    [],
  );

  const deleteDietary = useCallback((id: string) => {
    const next = stateRef.current.project.dietary.filter((d) => d.id !== id);
    setDietary(next);
    setState((prev) => ({
      ...prev,
      project: { ...prev.project, dietary: next },
    }));
  }, []);

  const lastUndoLabel = history.past.length
    ? history.past[history.past.length - 1].label
    : null;

  return {
    state,
    dietary,
    geometryIssues,
    manualScore,
    undoAvailable: canUndo(history),
    lastUndoLabel,
    selectGuest,
    selectTable,
    runAuto,
    applyCandidate,
    discardCandidate,
    seatGuest,
    unseatGuest,
    toggleLock,
    addChildChair,
    removeChildChair,
    dragTable,
    commitTableDrag,
    changeTable,
    addTable,
    createGuest,
    editGuest,
    deleteGuest,
    setProjectName,
    undoLast,
    resetTo,
    upsertDietary,
    deleteDietary,
    addRelation,
    deleteRelation,
    addPreference,
    deletePreference,
  };
}
