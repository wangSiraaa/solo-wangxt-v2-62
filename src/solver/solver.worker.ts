// ───────────────────────────────────────────────────────────────────────────
// 排座求解 Worker
// glpk.js（浏览器版）在内部以 Blob 方式启动它自己的计算 Worker，并把 wasm
// 内嵌在包里，因此整个应用可离线运行、不需要服务端、也不需要外部 wasm 文件。
// ───────────────────────────────────────────────────────────────────────────

import GLPK from 'glpk.js';
import { solveWith } from './model';
import type { SolverInput, SolveResult } from '../types';

export type SolverRequest = { type: 'solve'; input: SolverInput };
export type SolverResponse =
  | { type: 'result'; result: SolveResult }
  | { type: 'error'; message: string };

let glpkPromise: ReturnType<typeof GLPK> | null = null;

async function getGLPK() {
  if (!glpkPromise) glpkPromise = GLPK();
  return glpkPromise;
}

self.onmessage = async (ev: MessageEvent<SolverRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'solve') return;
  try {
    const glpk = await getGLPK();
    const result = await solveWith(glpk, msg.input);
    const response: SolverResponse = { type: 'result', result };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: SolverResponse = {
      type: 'error',
      message: (err as Error).message ?? String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
