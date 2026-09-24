// 演示样例：包含三类验证要素
//  - 冲突关系形成的"无解"：张三家 ↔ 李四必须同桌又必须分桌（矛盾三角）
//  - 儿童椅占位：主桌锁定 2 个空座作为儿童椅，容量被实际扣除
//  - 部分宾客 pending（未回复），开关决定是否纳入自动排座
// 另外包含：同名宾客（两个"王芳"）、忌口、靠近主桌偏好、过道与消防出口禁止多边形。

import type { ForbiddenZone, SeatingProject, VenueTable } from '../types';
import { uid } from './ids';

export interface CreateOpts {
  /** 制造硬冲突（默认 true）。取消该关系后样例变为可解，便于对比。 */
  withConflict?: boolean;
}

export function createSampleProject(opts: CreateOpts = {}): SeatingProject {
  const withConflict = opts.withConflict !== false;
  const id = uid('proj');

  const fam = (name: string) => ({ id: uid('fam'), name });
  const fZhang = fam('张家（张三一家）');
  const fLi = fam('李家（李四一家）');
  const fChen = fam('陈家');
  const fZhao = fam('赵家');
  const fWang = fam('王家');

  const G = (
    name: string,
    rest: Partial<SeatingProject['guests'][number]> = {},
  ) => ({
    id: uid('g'),
    name,
    nameSeq: 1,
    familyId: null as string | null,
    rsvp: 'accepted' as const,
    isChild: false,
    dietary: '',
    tags: '',
    ...rest,
  });

  // 张家 4 口（含一名儿童）
  const zhangSan = G('张三', { familyId: fZhang.id, dietary: '素食' });
  const zhangSanMei = G('张美美', { familyId: fZhang.id, isChild: true, dietary: '儿童餐' });
  const zhangFu = G('张父', { familyId: fZhang.id });
  const zhangMu = G('张母', { familyId: fZhang.id });

  // 李家 3 口
  const liSi = G('李四', { familyId: fLi.id });
  const liQi = G('李妻', { familyId: fLi.id, dietary: '海鲜过敏' });
  const liXiao = G('李小小', { familyId: fLi.id, isChild: true });

  // 其余宾客
  const chenWu = G('陈五', { familyId: fChen.id });
  const chenTai = G('陈太太', { familyId: fChen.id });
  const zhaoLiu = G('赵六', { familyId: fZhao.id });
  const zhaoFu = G('赵父', { familyId: fZhao.id, rsvp: 'pending' as const }); // 未回复
  const wangFang1 = G('王芳', { familyId: fWang.id, nameSeq: 1 });
  const wangFang2 = G('王芳', { nameSeq: 2, dietary: '清真' }); // 同名第二人，稳定编号
  const sunQi = G('孙七', { rsvp: 'pending' as const }); // 未回复，无家庭
  const zhouBa = G('周八', { dietary: '坚果过敏' });
  const wuJiu = G('吴九');
  const zhengShi = G('郑十');

  const guests = [
    zhangSan, zhangSanMei, zhangFu, zhangMu,
    liSi, liQi, liXiao,
    chenWu, chenTai,
    zhaoLiu, zhaoFu,
    wangFang1, wangFang2,
    sunQi, zhouBa, wuJiu, zhengShi,
  ];
  // 同名稳定编号
  assignNameSeq(guests);

  const families = [fZhang, fLi, fChen, fZhao, fWang];

  // 主桌 + 4 客桌（左右分列避开中央过道 470–530）
  const tables: VenueTable[] = [
    { id: uid('tbl'), name: '主桌', shape: 'round', x: 500, y: 150, radius: 70, halfHeight: 0, seats: 8, isHead: true, positionLocked: false },
    { id: uid('tbl'), name: 'A 桌', shape: 'round', x: 220, y: 330, radius: 60, halfHeight: 0, seats: 6, isHead: false, positionLocked: false },
    { id: uid('tbl'), name: 'B 桌', shape: 'round', x: 220, y: 520, radius: 60, halfHeight: 0, seats: 6, isHead: false, positionLocked: false },
    { id: uid('tbl'), name: 'C 桌', shape: 'round', x: 780, y: 330, radius: 60, halfHeight: 0, seats: 6, isHead: false, positionLocked: false },
    { id: uid('tbl'), name: 'D 桌', shape: 'rect', x: 770, y: 560, radius: 90, halfHeight: 40, seats: 8, isHead: false, positionLocked: false },
  ];
  const [head, aTbl, bTbl, cTbl, dTbl] = tables;

  // 禁止占用多边形：纵向过道 + 底部消防出口区（项目提供，仅几何检查）
  const zones: ForbiddenZone[] = [
    {
      id: uid('zone'),
      name: '中央过道',
      kind: 'aisle',
      points: [
        [470, 250],
        [530, 250],
        [530, 760],
        [470, 760],
      ],
    },
    {
      id: uid('zone'),
      name: '消防出口缓冲区',
      kind: 'exit',
      points: [
        [720, 700],
        [900, 700],
        [900, 780],
        [720, 780],
      ],
    },
  ];

  const seats: Record<string, (string | null)[]> = {};
  const lockedSeats: Record<string, boolean[]> = {};
  for (const t of tables) {
    seats[t.id] = new Array(t.seats).fill(null);
    lockedSeats[t.id] = new Array(t.seats).fill(false);
  }

  // 主桌：新人张三夫妇？（示例：张三一家坐主桌，锁定），并留 2 个儿童椅空座占位
  seats[head.id][0] = zhangSan.id;
  seats[head.id][1] = zhangFu.id;
  seats[head.id][2] = zhangMu.id;
  lockedSeats[head.id][0] = true;
  lockedSeats[head.id][1] = true;
  lockedSeats[head.id][2] = true;
  lockedSeats[head.id][3] = true; // 儿童椅占位（张美美）
  seats[head.id][3] = zhangSanMei.id;
  lockedSeats[head.id][4] = true; // 儿童椅占位（空，留给另一名儿童）

  // B 桌锁定李四夫妇（演示锁定；无冲突版里张家主桌、李家 B 桌，互不相同）
  seats[bTbl.id][0] = liSi.id;
  seats[bTbl.id][1] = liQi.id;
  lockedSeats[bTbl.id][0] = true;
  lockedSeats[bTbl.id][1] = true;

  const relations = [
    // —— 无冲突版本：李四与张三是好友（软 like，不同桌只产生代价）——
    // —— 冲突版本追加两条硬条件，形成无解：
    //    (1) 李四-张三 必须同桌（伴郎约定，硬 same），但张三锁主桌、李四锁 B 桌 => 锁定冲突
    //    (2) 张母-李四 必须分桌（硬 apart），而张母与张三因家庭硬同组 => 同组矛盾
    ...(withConflict
      ? [{ id: uid('rel'), a: liSi.id, b: zhangSan.id, kind: 'same' as const }]
      : [{ id: uid('rel'), a: liSi.id, b: zhangSan.id, kind: 'like' as const }]),
    ...(withConflict
      ? [{ id: uid('rel'), a: zhangMu.id, b: liSi.id, kind: 'apart' as const }]
      : []),
    // 软偏好：陈五夫妇希望和赵六同桌；王芳② 与 周八 希望分开
    { id: uid('rel'), a: chenWu.id, b: zhaoLiu.id, kind: 'like' as const },
    { id: uid('rel'), a: wangFang2.id, b: zhouBa.id, kind: 'dislike' as const },
  ];

  const nearPrefs = [
    { id: uid('near'), guestId: zhangFu.id }, // 长辈靠近主桌（已在主桌，代价 0）
    { id: uid('near'), guestId: chenTai.id }, // 长辈希望靠近主桌
  ];

  void bTbl;
  void cTbl;
  void dTbl;

  return {
    id,
    name: '周日婚礼 · 演示工程',
    updatedAt: Date.now(),
    guests,
    families,
    relations,
    nearPrefs,
    venue: { width: 1000, height: 800, tables, zones },
    seats,
    lockedSeats,
    includePending: false,
  };
}

function assignNameSeq(guests: { name: string; nameSeq: number }[]): void {
  const counts = new Map<string, number>();
  for (const g of guests) {
    const n = (counts.get(g.name) ?? 0) + 1;
    counts.set(g.name, n);
    g.nameSeq = n;
  }
}
