// 应用状态 store：项目数据 + 撤销/重做（手工操作可撤销）+ 自动方案暂存对比
// 自动方案先作为 plan 暂存，用户可以"应用/丢弃/与当前手工方案比较"。

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CostBreakdown,
  SeatingProject,
  SolveAssignment,
} from '../types';
import { applyAssignment } from '../lib/apply';
import { saveProject } from '../lib/db';

export interface AutoPlan {
  assignment: SolveAssignment[];
  cost: CostBreakdown;
  unseated: string[];
  status: string;
  /** 应用前快照，便于"撤销自动排座" */
  createdAt: number;
}

const HISTORY_LIMIT = 100;

export function useProjectStore(initial: SeatingProject) {
  const [project, setProject] = useState<SeatingProject>(initial);
  const past = useRef<SeatingProject[]>([]);
  const future = useRef<SeatingProject[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const [plan, setPlan] = useState<AutoPlan | null>(null);
  const [dirty, setDirty] = useState(false);

  const bump = useCallback(() => setHistoryTick((n) => n + 1), []);

  /** 提交一次手工/结构修改：记录历史、清空未来栈和暂存方案 */
  const commit = useCallback(
    (updater: (p: SeatingProject) => SeatingProject, opts: { keepPlan?: boolean } = {}) => {
      setProject((prev) => {
        const next = updater(prev);
        past.current.push(prev);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
        if (!opts.keepPlan) setPlan(null);
        setDirty(true);
        bump();
        return next;
      });
    },
    [bump],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setProject((cur) => {
      future.current.push(cur);
      bump();
      return prev;
    });
  }, [bump]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setProject((cur) => {
      past.current.push(cur);
      bump();
      return next;
    });
  }, [bump]);

  /** 保存（不进历史） */
  const persist = useCallback(async () => {
    await saveProject({ ...project, updatedAt: Date.now() });
    setDirty(false);
  }, [project]);

  const replaceAll = useCallback(
    (p: SeatingProject) => {
      past.current.push(project);
      future.current = [];
      setPlan(null);
      setProject(p);
      setDirty(true);
      bump();
    },
    [project, bump],
  );

  /** Worker 返回方案：暂存不直接落地 */
  const setAutoPlan = useCallback((a: Omit<AutoPlan, 'createdAt'>) => {
    setPlan({ ...a, createdAt: Date.now() });
  }, []);

  /** 应用自动方案（当前方案进入撤销栈，可一键撤销回手工状态比较） */
  const applyPlan = useCallback(() => {
    if (!plan) return;
    setProject((prev) => {
      const { seats } = applyAssignment(prev, plan.assignment);
      const next: SeatingProject = { ...prev, seats };
      past.current.push(prev);
      future.current = [];
      setDirty(true);
      bump();
      return next;
    });
    setPlan(null);
  }, [plan, bump]);

  const discardPlan = useCallback(() => setPlan(null), []);

  // 键盘快捷键
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
    },
    [undo, redo],
  );

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  void historyTick;

  const api = useMemo(
    () => ({
      project,
      commit,
      undo,
      redo,
      canUndo,
      canRedo,
      persist,
      replaceAll,
      plan,
      setAutoPlan,
      applyPlan,
      discardPlan,
      dirty,
      onKey,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, plan, dirty, canUndo, canRedo, historyTick],
  );

  return api;
}

export type ProjectApi = ReturnType<typeof useProjectStore>;
