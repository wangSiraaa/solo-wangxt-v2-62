// ───────────────────────────────────────────────────────────────────────────
// 工具：id 生成、同名宾客稳定编号
// ───────────────────────────────────────────────────────────────────────────

import type { Guest } from '../types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * 同名宾客稳定编号：
 *  - 按输入顺序（通常是创建顺序）赋 #1, #2, …
 *  - displayName 形如「张伟 #2」，唯一姓名不带编号
 *  - 已存在的 displayName 不重排，保证换座/导出引用稳定
 */
export function assignStableDisplayNames(guests: Guest[]): Guest[] {
  const counts = new Map<string, number>();
  return guests.map((g) => {
    const same = guests.filter((x) => x.name === g.name);
    if (same.length <= 1) return { ...g, displayName: g.name };
    const order = same.indexOf(g) + 1;
    counts.set(g.name, order);
    return { ...g, displayName: `${g.name} #${order}` };
  });
}

/** 仅在新增宾客时调用：根据当前列表算出新宾客应显示的编号 */
export function displayNameFor(name: string, existing: Guest[]): string {
  const sameCount = existing.filter((g) => g.name === name).length;
  return sameCount === 0 ? name : `${name} #${sameCount + 1}`;
}
