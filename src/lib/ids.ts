// id 生成 / 同名稳定编号 / 显示标签

import type { Guest } from '../types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * 同名宾客用稳定编号区分：label 显示为 "张伟 ②"。
 * nameSeq 是分配时的稳定序号（删除其他宾客不会导致重排）。
 */
export function guestLabel(g: Pick<Guest, 'name' | 'nameSeq'>): string {
  if (g.nameSeq <= 1) return g.name;
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const mark = g.nameSeq <= 10 ? circled[g.nameSeq - 1] : `(${g.nameSeq})`;
  return `${g.name} ${mark}`;
}

/** 新建宾客时计算其在同名组内的稳定序号（max+1，永不复用） */
export function nextNameSeq(guests: Guest[], name: string): number {
  const used = guests.filter((g) => g.name === name).map((g) => g.nameSeq);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}
