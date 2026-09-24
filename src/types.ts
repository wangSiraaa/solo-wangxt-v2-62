// ───────────────────────────────────────────────────────────────────────────
// 领域模型类型定义
// 设计要点：
//  - 忌口（dietary）独立于宾客/席位存储，按 guestId 关联，换座不会影响忌口
//  - 锁定位（lockedAssignmentId）属于座位分配的不可变属性，自动排座必须保留
//  - 关系分硬（同家庭 / 明确避让）与软（想靠近某人/主桌），软约束以代价体现
// ───────────────────────────────────────────────────────────────────────────

export type RSVPStatus = 'accepted' | 'declined' | 'pending';

/** 宾客 */
export interface Guest {
  id: string;
  /** 原始姓名，可能重复 */
  name: string;
  /** 稳定编号：同名宾客按首次出现顺序区分（如 "张伟 #1"），id 永远不变 */
  displayName: string;
  partyId: string | null;
  rsvp: RSVPStatus;
  /** 是否儿童（需要儿童椅）；儿童仍占一个席位，渲染为儿童椅图标 */
  isChild: boolean;
  /** 需要儿童椅占位（非宾客的占位名额，如随父母前来的婴幼儿） */
  needsChildChairSlot?: boolean;
  /** 备注 */
  note?: string;
}

/** 忌口记录：与席位独立存储 */
export interface DietaryRestriction {
  id: string;
  guestId: string;
  /** 如 素食 / 清真 / 坚果过敏 */
  type: string;
  detail?: string;
}

/** 关系类型 */
export type RelationKind =
  | 'family' // 硬：必须同桌（家庭同行）
  | 'avoid' // 硬：必须分桌（明确避让）
  | 'preferNear'; // 软：尽量同桌（可放宽，计入代价）

export interface GuestRelation {
  id: string;
  guestA: string;
  guestB: string;
  kind: RelationKind;
  /** preferNear 的权重（默认 10） */
  weight?: number;
}

/** 桌形 */
export type TableShape = 'round' | 'rect';

export interface TableDef {
  id: string;
  label: string;
  /** 容量（不含自动添加的儿童椅占位——占位通过座位分配体现） */
  capacity: number;
  shape: TableShape;
  /** 圆心 / 矩形中心，单位 px（场地坐标系） */
  x: number;
  y: number;
  /** 圆半径或矩形短边半径（视觉/几何用） */
  radius: number;
  /** 矩形长度半径（shape=rect 时生效） */
  length?: number;
  /** 主桌标记（软偏好“靠近主桌”的参照） */
  isHeadTable: boolean;
}

/** 靠近主桌偏好的强度 */
export type ProximityStrength = 'near' | 'next-to';

export interface TablePreference {
  id: string;
  guestId: string;
  /** 目标桌；为空表示“任意主桌” */
  tableId?: string;
  /** near=同桌代价最低、邻桌次之；next-to=只接受同桌或紧邻 */
  strength: ProximityStrength;
  /** 软约束权重（默认 6） */
  weight?: number;
}

/** 多边形顶点（禁止占用区域：过道、消防出口等，仅做几何检查） */
export interface Point {
  x: number;
  y: number;
}

export interface ForbiddenZone {
  id: string;
  label: string;
  kind: 'aisle' | 'exit' | 'stage' | 'other';
  polygon: Point[];
}

export interface Venue {
  width: number;
  height: number;
  forbiddenZones: ForbiddenZone[];
}

/**
 * 座位分配：一条 = 某个可就座实体（宾客或儿童椅占位）占了某桌的一个座位序号。
 * 座位序号 seatIndex 只在桌内有意义；锁定后自动排座不允许改动。
 */
export interface SeatAssignment {
  id: string;
  tableId: string;
  seatIndex: number;
  guestId: string | null;
  /** 纯儿童椅占位（guestId 可为 null） */
  childChair: boolean;
  /** 锁定：手工指定后自动排座不能移动 */
  locked: boolean;
}

/** 自动求解的方案（尚未应用），用于和当前手工方案对比 */
export interface AutoPlanCandidate {
  generatedAt: number;
  assignments: SeatAssignment[];
  costBreakdown: SolveCostBreakdown;
  status: SolveStatus;
  /** 未被排入（婉拒 / 未回复且选择不排）的宾客 id */
  unseatedGuestIds: string[];
  /** 诊断信息（无解时给出可能原因） */
  infeasibilityHint?: string;
}

export interface SolveCostBreakdown {
  /** preferNear 未同桌的代价 */
  preferNear: number;
  /** 远离主桌/目标桌的代价 */
  tablePreference: number;
  /** 未回复宾客被排座的小代价 */
  pendingSeated: number;
  total: number;
}

export type SolveStatus = 'optimal' | 'feasible' | 'infeasible' | 'error';

export interface SolveResult {
  status: SolveStatus;
  assignments: SeatAssignment[];
  unseatedGuestIds: string[];
  costBreakdown: SolveCostBreakdown;
  infeasibilityHint?: string;
}

/** 求解器输入（Worker 协议用，纯数据、可结构化克隆） */
export interface SolverInput {
  guests: Guest[];
  tables: TableDef[];
  relations: GuestRelation[];
  tablePreferences: TablePreference[];
  assignments: SeatAssignment[];
  /** 是否给未回复宾客也排座（默认 false：不排，仅手工可安排） */
  seatPending: boolean;
  /** 桌心间距离（用于靠近偏好代价），由主线程预算好，Worker 里保持纯数据 */
  tableDistance: Record<string, Record<string, number>>;
}

/** 项目：IndexedDB 中持久化的整体工程 */
export interface WeddingProject {
  id: string;
  name: string;
  updatedAt: number;
  venue: Venue;
  tables: TableDef[];
  guests: Guest[];
  /** 忌口独立存储（IndexedDB 中也是独立 store，这里只是项目加载后的内存视图） */
  dietary: DietaryRestriction[];
  relations: GuestRelation[];
  tablePreferences: TablePreference[];
  assignments: SeatAssignment[];
}

// ── 编辑器状态 ─────────────────────────────────────────────────────────────

export interface PlannerState {
  project: WeddingProject;
  selectedGuestId: string | null;
  selectedTableId: string | null;
  selectedAssignmentId: string | null;
  /** 最近一次自动方案（用于对比 / 应用 / 放弃） */
  autoCandidate: AutoPlanCandidate | null;
  solving: boolean;
  statusMessage: string | null;
}

export interface UndoEntry {
  label: string;
  at: number;
  state: PlannerState;
}
