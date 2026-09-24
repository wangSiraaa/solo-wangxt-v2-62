// ───────────────────────────────────────────────────────────────────────────
// 撤销栈：仅记录手工操作；自动方案采用“候选 → 对比 → 应用”流程，
// 应用动作本身也压栈，因此应用自动方案后同样可以一键撤销回手工方案。
// 自动求解过程本身不入栈（它不改当前工程）。
// ───────────────────────────────────────────────────────────────────────────

import type { PlannerState, UndoEntry } from '../types';

const MAX_HISTORY = 100;

export interface History {
  past: UndoEntry[];
}

export function pushHistory(
  history: History,
  label: string,
  snapshot: PlannerState,
): History {
  const entry: UndoEntry = { label, at: Date.now(), state: snapshot };
  const past = [...history.past, entry].slice(-MAX_HISTORY);
  return { past };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function undo(
  history: History,
): { history: History; state: PlannerState; label: string } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: history.past.slice(0, -1) },
    state: entry.state,
    label: entry.label,
  };
}
