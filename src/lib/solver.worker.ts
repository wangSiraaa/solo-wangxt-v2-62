// glpk.js 求解 Worker：MILP 求解不阻塞 UI 线程。
// 使用 glpk.js 的浏览器入口（其内部以 blob Worker + 内联 wasm 运行）。
// 我们自身已在 Worker 中；浏览器允许 Worker 内再创建 Worker。

// @ts-ignore 浏览器入口自带类型声明不完整
import createGlpkWorker from 'glpk.js';
import { solveMILP, GLP, type SolveFn } from './solverCore';
import type { SolveRequest, SolveResponse } from '../types';

interface GlpkWorkerLike {
  solve: SolveFn;
  terminate?: () => void;
}

let glpkPromise: Promise<GlpkWorkerLike> | null = null;

function getGLPK(): Promise<GlpkWorkerLike> {
  if (!glpkPromise) {
    const factory = createGlpkWorker as unknown as () => Promise<GlpkWorkerLike>;
    glpkPromise = factory();
  }
  return glpkPromise;
}

self.onmessage = async (ev: MessageEvent<SolveRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'solve') return;
  const answer: SolveResponse = { ok: false, status: 'unknown' };
  try {
    const glpk = await getGLPK();
    const out = await solveMILP(glpk.solve.bind(glpk), msg.problem, msg.timeoutMs);
    answer.ok = out.unseatedGuests.length === 0;
    answer.status =
      out.glpkStatus === GLP.GLP_OPT
        ? 'optimal'
        : out.unseatedGuests.length > 0
          ? 'infeasible-relaxed'
          : `glpk-${out.glpkStatus}`;
    answer.result = {
      assignment: out.assignment,
      cost: out.cost,
      unseatedGuestIds: out.unseatedGuests,
    };
    if (out.unseatedGuests.length > 0) {
      answer.error = `容量不足，${out.unseatedGuests.length} 位宾客无法排入（已在结果中标记）`;
    }
  } catch (err) {
    answer.ok = false;
    answer.status = 'error';
    answer.error = err instanceof Error ? err.message : String(err);
  }
  (self as unknown as Worker).postMessage(answer);
};
