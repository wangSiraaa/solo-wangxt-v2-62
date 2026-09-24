// Worker 客户端封装

import { useRef, useState, useCallback } from 'react';
import type { SolveProblem, SolveResponse } from '../types';

export function useSolverWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../lib/solver.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return workerRef.current;
  }, []);

  const solve = useCallback(
    (problem: SolveProblem, timeoutMs = 8000) =>
      new Promise<SolveResponse>((resolve) => {
        const worker = getWorker();
        setRunning(true);
        setError(null);
        const onMsg = (e: MessageEvent<SolveResponse>) => {
          worker.removeEventListener('message', onMsg);
          setRunning(false);
          if (!e.data.ok && e.data.status === 'error') setError(e.data.error ?? '求解失败');
          resolve(e.data);
        };
        worker.addEventListener('message', onMsg);
        worker.postMessage({ type: 'solve', problem, timeoutMs });
      }),
    [getWorker],
  );

  return { solve, running, error };
}
