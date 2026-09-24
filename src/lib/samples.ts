// ───────────────────────────────────────────────────────────────────────────
// 内置样例工程
//  1) 常规样例：同名宾客 / 家庭 / 避让 / 软偏好 / 儿童椅占位 / 未回复 / 婉拒 / 锁定
//  2) 无解冲突样例：family 与 avoid 同时落在同一对人身上，且避让双方被锁同桌
//
// 禁止占用多边形为“项目提供”的场地数据：过道、消防出口、舞台。
// 仅用于桌位几何检查，不代表任何安全认证或合规结论。
// ───────────────────────────────────────────────────────────────────────────

import type {
  DietaryRestriction,
  Guest,
  GuestRelation,
  SeatAssignment,
  TableDef,
  TablePreference,
  Venue,
  WeddingProject,
} from '../types';
import { uid } from './ids';

export const SAMPLE_VENUE: Venue = {
  width: 1200,
  height: 820,
  forbiddenZones: [
    {
      id: 'zone-aisle',
      label: '中央过道',
      kind: 'aisle',
      polygon: [
        { x: 584, y: 180 },
        { x: 616, y: 180 },
        { x: 616, y: 820 },
        { x: 584, y: 820 },
      ],
    },
    {
      id: 'zone-exit-left',
      label: '左消防出口缓冲区',
      kind: 'exit',
      polygon: [
        { x: 0, y: 720 },
        { x: 130, y: 720 },
        { x: 130, y: 820 },
        { x: 0, y: 820 },
      ],
    },
    {
      id: 'zone-exit-right',
      label: '右消防出口缓冲区',
      kind: 'exit',
      polygon: [
        { x: 1070, y: 720 },
        { x: 1200, y: 720 },
        { x: 1200, y: 820 },
        { x: 1070, y: 820 },
      ],
    },
    {
      id: 'zone-stage',
      label: '舞台前沿',
      kind: 'stage',
      polygon: [
        { x: 380, y: 0 },
        { x: 820, y: 0 },
        { x: 820, y: 24 },
        { x: 380, y: 24 },
      ],
    },
  ],
};

export function sampleTables(): TableDef[] {
  const round = (id: string, label: string, x: number, y: number, capacity = 8): TableDef => ({
    id,
    label,
    capacity,
    shape: 'round',
    x,
    y,
    radius: 52,
    isHeadTable: false,
  });
  return [
    {
      id: 'T1',
      label: '主桌',
      capacity: 10,
      shape: 'rect',
      x: 600,
      y: 110,
      radius: 42,
      length: 130,
      isHeadTable: true,
    },
    round('T2', '2 号桌', 220, 270),
    round('T3', '3 号桌', 430, 270),
    round('T4', '4 号桌', 770, 270),
    round('T5', '5 号桌', 980, 270),
    round('T6', '6 号桌', 220, 510),
    round('T7', '7 号桌', 430, 510),
    round('T8', '8 号桌', 770, 510),
    round('T9', '9 号桌', 980, 510),
  ];
}

interface GuestSeed {
  id: string;
  name: string;
  rsvp: Guest['rsvp'];
  isChild?: boolean;
  note?: string;
}

const GUEST_SEEDS: GuestSeed[] = [
  { id: 'g-zhangwei-1', name: '张伟', rsvp: 'accepted' },
  { id: 'g-zhangwei-2', name: '张伟', rsvp: 'accepted' },
  { id: 'g-chenxue', name: '陈雪', rsvp: 'accepted' },
  { id: 'g-chengang', name: '陈刚', rsvp: 'accepted' },
  { id: 'g-zhoujianguo', name: '周建国', rsvp: 'accepted' },
  { id: 'g-zhouhui', name: '周慧', rsvp: 'accepted' },
  { id: 'g-zhougrandma', name: '周奶奶', rsvp: 'accepted', note: '长辈' },
  { id: 'g-liuyang', name: '刘洋', rsvp: 'accepted' },
  { id: 'g-sunqiang', name: '孙强', rsvp: 'accepted' },
  { id: 'g-linxiaoyu', name: '林小雨', rsvp: 'accepted', isChild: true },
  { id: 'g-wumin', name: '吴敏', rsvp: 'pending', note: '未回复' },
  { id: 'g-zhenghao', name: '郑浩', rsvp: 'pending', note: '未回复' },
  { id: 'g-qianduoduo', name: '钱多多', rsvp: 'declined', note: '已婉拒' },
  { id: 'g-suqing', name: '苏晴', rsvp: 'accepted' },
  { id: 'g-lixiaobao', name: '李小宝', rsvp: 'accepted', isChild: true },
];

function buildGuests(seeds: GuestSeed[]): Guest[] {
  const guests: Guest[] = seeds.map((s) => ({
    id: s.id,
    name: s.name,
    displayName: s.name,
    partyId: null,
    rsvp: s.rsvp,
    isChild: !!s.isChild,
    note: s.note,
  }));
  // 稳定编号
  const nameCount = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const g of guests) nameCount.set(g.name, (nameCount.get(g.name) ?? 0) + 1);
  return guests.map((g) => {
    if ((nameCount.get(g.name) ?? 0) <= 1) return g;
    const n = (seen.get(g.name) ?? 0) + 1;
    seen.set(g.name, n);
    return { ...g, displayName: `${g.name} #${n}` };
  });
}

export function sampleDietary(): DietaryRestriction[] {
  return [
    { id: uid('diet'), guestId: 'g-linxiaoyu', type: '坚果过敏', detail: '菜品与蛋糕均需避开坚果' },
    { id: uid('diet'), guestId: 'g-zhougrandma', type: '清真' },
    { id: uid('diet'), guestId: 'g-wumin', type: '素食', detail: '未回复宾客的忌口同样保留' },
    { id: uid('diet'), guestId: 'g-suqing', type: '海鲜过敏' },
  ];
}

export function sampleRelations(): GuestRelation[] {
  return [
    // 硬：家庭同行
    { id: 'rel-chen', guestA: 'g-chenxue', guestB: 'g-chengang', kind: 'family' },
    { id: 'rel-zhou-1', guestA: 'g-zhoujianguo', guestB: 'g-zhouhui', kind: 'family' },
    { id: 'rel-zhou-2', guestA: 'g-zhouhui', guestB: 'g-zhougrandma', kind: 'family' },
    // 硬：明确避让
    { id: 'rel-avoid-1', guestA: 'g-liuyang', guestB: 'g-sunqiang', kind: 'avoid' },
    // 软：希望同桌
    {
      id: 'rel-pn-1',
      guestA: 'g-zhangwei-1',
      guestB: 'g-chenxue',
      kind: 'preferNear',
      weight: 10,
    },
    {
      id: 'rel-pn-2',
      guestA: 'g-suqing',
      guestB: 'g-chenxue',
      kind: 'preferNear',
      weight: 8,
    },
  ];
}

export function samplePreferences(): TablePreference[] {
  return [
    {
      id: 'pref-grandma',
      guestId: 'g-zhougrandma',
      strength: 'near',
      weight: 6,
    },
    {
      id: 'pref-suqing',
      guestId: 'g-suqing',
      tableId: 'T1',
      strength: 'near',
      weight: 6,
    },
  ];
}

export function sampleAssignments(): SeatAssignment[] {
  return [
    // 随父母前来的婴幼儿：纯儿童椅占位，锁定在主桌，自动排座不可移动
    {
      id: 'seat-chair-infant-1',
      tableId: 'T1',
      seatIndex: 0,
      guestId: null,
      childChair: true,
      locked: true,
    },
    // 手工锁定的宾客：自动排座必须保留
    {
      id: 'seat:g-chengang',
      tableId: 'T2',
      seatIndex: 0,
      guestId: 'g-chengang',
      childChair: false,
      locked: true,
    },
  ];
}

export function buildSampleProject(): WeddingProject {
  const now = Date.now();
  return {
    id: 'sample-project',
    name: '示例婚礼（2026 秋）',
    updatedAt: now,
    venue: structuredClone(SAMPLE_VENUE),
    tables: sampleTables(),
    guests: buildGuests(GUEST_SEEDS),
    dietary: sampleDietary(),
    relations: sampleRelations(),
    tablePreferences: samplePreferences(),
    assignments: sampleAssignments(),
  };
}

// ── 无解冲突样例 ────────────────────────────────────────────────────────────

export function buildInfeasibleSampleProject(): WeddingProject {
  const base = buildSampleProject();
  const relations: GuestRelation[] = [
    // 周建国-周慧-周奶奶 被家庭关系绑成一组
    { id: 'if-rel-zhou-1', guestA: 'g-zhoujianguo', guestB: 'g-zhouhui', kind: 'family' },
    { id: 'if-rel-zhou-2', guestA: 'g-zhouhui', guestB: 'g-zhougrandma', kind: 'family' },
    // 但周建国与周奶奶又被明确要求避让 → 同组内必然无解
    { id: 'if-avoid-zhou', guestA: 'g-zhoujianguo', guestB: 'g-zhougrandma', kind: 'avoid' },
    // 刘洋 / 孙强 各自锁定在 T6（见 assignments），却要求避让 → 锁定冲突无解
    { id: 'if-avoid-lock', guestA: 'g-liuyang', guestB: 'g-sunqiang', kind: 'avoid' },
  ];
  const assignments: SeatAssignment[] = [
    ...base.assignments,
    {
      id: 'seat:g-liuyang',
      tableId: 'T6',
      seatIndex: 1,
      guestId: 'g-liuyang',
      childChair: false,
      locked: true,
    },
    {
      id: 'seat:g-sunqiang',
      tableId: 'T6',
      seatIndex: 2,
      guestId: 'g-sunqiang',
      childChair: false,
      locked: true,
    },
  ];
  return {
    ...base,
    id: 'sample-infeasible',
    name: '冲突无解样例',
    updatedAt: Date.now(),
    relations,
    tablePreferences: [],
    assignments,
  };
}

/** 空工程 */
export function buildEmptyProject(): WeddingProject {
  return {
    id: uid('proj'),
    name: '我的婚礼',
    updatedAt: Date.now(),
    venue: structuredClone(SAMPLE_VENUE),
    tables: sampleTables(),
    guests: [],
    dietary: [],
    relations: [],
    tablePreferences: [],
    assignments: [],
  };
}
