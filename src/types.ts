// 核心数据模型 —— 全部可序列化进 IndexedDB

export type RSVP = 'accepted' | 'pending' | 'declined';

export interface Guest {
  id: string;
  name: string;
  /** 同名区分序号，稳定（删人后不重排，见 labelGuest） */
  nameSeq: number;
  familyId: string | null;
  rsvp: RSVP;
  isChild: boolean;
  /** 忌口：与席位独立存储，换座/导出互不影响 */
  dietary: string;
  tags: string;
}

export interface Family {
  id: string;
  name: string; // 例如 "张家"
}

/** 宾客关系：same=必须同桌(硬)；apart=必须分桌(硬)；like=希望同桌(软)；dislike=希望分开(软) */
export type RelationKind = 'same' | 'apart' | 'like' | 'dislike';

export interface Relation {
  id: string;
  a: string; // guest id
  b: string; // guest id
  kind: RelationKind;
}

/** 靠近主桌偏好（软） */
export interface NearPref {
  id: string;
  guestId: string;
}

export type TableShape = 'round' | 'rect';

export interface VenueTable {
  id: string;
  name: string;
  shape: TableShape;
  x: number;
  y: number;
  /** 圆桌半径；矩形为半宽 */
  radius: number;
  /** 矩形半高（圆桌忽略） */
  halfHeight: number;
  seats: number;
  isHead: boolean;
  /** 布局锁定：几何位置不能拖拽移动（与座位锁定各自独立） */
  positionLocked: boolean;
}

/** 项目提供的禁止占用多边形（过道/消防出口） */
export interface ForbiddenZone {
  id: string;
  name: string;
  kind: 'aisle' | 'exit' | 'custom';
  /** [x, y] 多边形顶点 */
  points: [number, number][];
}

export interface Venue {
  width: number;
  height: number;
  tables: VenueTable[];
  zones: ForbiddenZone[];
}

export interface SeatLock {
  /** 锁定后自动排座不得移动；包含未分配（锁"空座"预留） */
  guestId: string | null;
}

export interface SeatingProject {
  id: string;
  name: string;
  updatedAt: number;
  guests: Guest[];
  families: Family[];
  relations: Relation[];
  nearPrefs: NearPref[];
  venue: Venue;
  /** seats[tableId] 长度等于 capacity，元素为 guestId 或 null */
  seats: Record<string, (string | null)[]>;
  /** lockedSeats[tableId][seatIndex] = true 表示该座位锁定 */
  lockedSeats: Record<string, boolean[]>;
  includePending: boolean;
}

// ---------- 求解器类型（Worker 消息） ----------

export interface SolveRequest {
  type: 'solve';
  /** buildSolveInput 产物，普通 JSON */
  problem: SolveProblem;
  timeoutMs: number;
}
export type WorkerRequest = SolveRequest | { type: 'status'; text: string };

export interface CostBreakdown {
  near: number;
  like: number;
  dislike: number;
  unseated: number;
  total: number;
}

export interface SolveAssignment {
  guestId: string;
  tableId: string;
  seatIndex: number;
}

export interface SolveResponse {
  ok: boolean;
  status: string;
  result?: {
    assignment: SolveAssignment[];
    cost: CostBreakdown;
    unseatedGuestIds: string[];
  };
  error?: string;
}

// buildSolveInput 的中间产物（也用于 worker）
export interface SolveProblem {
  guests: { id: string }[];
  tables: {
    id: string;
    x: number;
    y: number;
    seats: number;
    lockedGuests: string[]; // 已锁定在该桌的宾客
    lockedSeatCount: number;
  }[];
  headTableId: string | null;
  samePairs: [string, string][];
  apartPairs: [string, string][];
  likePairs: [string, string][];
  dislikePairs: [string, string][];
  nearGuestIds: string[];
}

export interface Diagnostics {
  feasible: boolean;
  reasons: string[];
}
