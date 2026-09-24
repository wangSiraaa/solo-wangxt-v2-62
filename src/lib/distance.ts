// 桌间距工具（场地坐标，单位 px）
import type { TableDef } from '../types';

export function tableDistanceMatrix(tables: TableDef[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const a of tables) {
    m[a.id] = {};
    for (const b of tables) {
      m[a.id][b.id] = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  return m;
}
