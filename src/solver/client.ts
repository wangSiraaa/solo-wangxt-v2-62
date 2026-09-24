// Worker 客户端：懒加载、请求/响应配对
import type { SolverInput, SolveResult } from '../types';
import type { SolverRequest, SolverResponse } from './solver.worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (r: SolveResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
    const msg = ev.data;
    if (msg.type === 'result') {
      // 单请求顺序处理：result 不带 seq 时取最早的 pending
      const first = pending.keys().next().value as number | undefined;
      if (first !== undefined) {
        pending.get(first)!.resolve(msg.result);
        pending.delete(first);
      }
    } else {
      const first = pending.keys().next().value as number | undefined;
      if (first !== undefined) {
        pending.get(first)!.reject(new Error(msg.message));
        pending.delete(first);
      }
    }
  };
  worker.onerror = (ev) => {
    for (const { reject } of pending.values()) reject(new Error(ev.message));
    pending.clear();
  };
  return worker;
}

export function solveInWorker(input: SolverInput): Promise<SolveResult> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const req: SolverRequest = { type: 'solve', input };
    getWorker().postMessage(req);
  });
}
