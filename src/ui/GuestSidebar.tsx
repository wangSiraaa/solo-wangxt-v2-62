import { useMemo, useState } from 'react';
import type { Guest, SeatAssignment, TableDef, WeddingProject } from '../types';

interface GuestSidebarProps {
  project: WeddingProject;
  dietaryGuestIds: Set<string>;
  selectedGuestId: string | null;
  onSelectGuest: (id: string) => void;
  onCreateGuest: (data: {
    name: string;
    rsvp: Guest['rsvp'];
    isChild: boolean;
    note?: string;
  }) => void;
}

type Tab = 'unseated' | 'seated' | 'all';

const RSVP_CHIP: Record<Guest['rsvp'], { cls: string; text: string }> = {
  accepted: { cls: 'accepted', text: '出席' },
  pending: { cls: 'pending', text: '未回复' },
  declined: { cls: 'declined', text: '婉拒' },
};

function GuestRow({
  guest,
  assignment,
  tables,
  selected,
  hasDiet,
  onClick,
}: {
  guest: Guest;
  assignment?: SeatAssignment;
  tables: TableDef[];
  selected: boolean;
  hasDiet: boolean;
  onClick: () => void;
}) {
  const table = assignment ? tables.find((t) => t.id === assignment.tableId) : null;
  // 同名编号高亮：displayName 含 #
  const dupMatch = guest.displayName.match(/^(.*?)( #\d+)$/);
  return (
    <div
      className={`guest-item${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={guest.note ?? guest.displayName}
    >
      <div className="gname">
        {dupMatch ? (
          <>
            {dupMatch[1]} <span className="dup">{dupMatch[2]}</span>
          </>
        ) : (
          guest.displayName
        )}
        {guest.isChild && <span className="chip child" style={{ marginLeft: 6 }}>童</span>}
        {hasDiet && <span className="chip diet" style={{ marginLeft: 4 }}>忌</span>}
      </div>
      <div className="gmeta">
        {table && !guest.isChild ? table.label : table ? `${table.label} 童` : ''}
      </div>
      {assignment?.locked && <span className="chip locked">锁</span>}
      <span className={`chip ${RSVP_CHIP[guest.rsvp].cls}`}>{RSVP_CHIP[guest.rsvp].text}</span>
    </div>
  );
}

export default function GuestSidebar({
  project,
  dietaryGuestIds,
  selectedGuestId,
  onSelectGuest,
  onCreateGuest,
}: GuestSidebarProps) {
  const [tab, setTab] = useState<Tab>('unseated');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [rsvp, setRsvp] = useState<Guest['rsvp']>('accepted');
  const [isChild, setIsChild] = useState(false);

  const tableOf = useMemo(() => {
    const m = new Map<string, SeatAssignment>();
    for (const a of project.assignments) if (a.guestId) m.set(a.guestId, a);
    return m;
  }, [project.assignments]);

  const filtered = useMemo(() => {
    const list = project.guests.filter((g) => {
      const a = tableOf.get(g.id);
      if (tab === 'seated') return !!a;
      if (tab === 'unseated') return !a;
      return true;
    });
    // 排序：未回复/婉拒靠后？保持创建顺序，同姓名相邻
    return list;
  }, [project.guests, tableOf, tab]);

  const counts = useMemo(() => {
    let seated = 0;
    let unseated = 0;
    for (const g of project.guests) {
      if (tableOf.has(g.id)) seated += 1;
      else unseated += 1;
    }
    return { seated, unseated, total: project.guests.length };
  }, [project.guests, tableOf]);

  const submit = () => {
    if (!name.trim()) return;
    onCreateGuest({ name, rsvp, isChild });
    setName('');
    setIsChild(false);
    setOpen(false);
  };

  return (
    <aside className="sidebar">
      <div className="panel-head">
        宾客
        <span className="muted">
          已排 {counts.seated} / 未排 {counts.unseated} / 共 {counts.total}
        </span>
      </div>
      <div className="tabs">
        <button className={tab === 'unseated' ? 'active' : ''} onClick={() => setTab('unseated')}>
          未入座 ({counts.unseated})
        </button>
        <button className={tab === 'seated' ? 'active' : ''} onClick={() => setTab('seated')}>
          已入座 ({counts.seated})
        </button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          全部
        </button>
      </div>
      <div className="panel-body">
        {filtered.length === 0 && <div className="empty">该分组暂无宾客</div>}
        {filtered.map((g) => (
          <GuestRow
            key={g.id}
            guest={g}
            assignment={tableOf.get(g.id)}
            tables={project.tables}
            selected={g.id === selectedGuestId}
            hasDiet={dietaryGuestIds.has(g.id)}
            onClick={() => onSelectGuest(g.id)}
          />
        ))}
      </div>
      <div className="section" style={{ borderBottom: 'none' }}>
        {!open ? (
          <button style={{ width: '100%' }} onClick={() => setOpen(true)}>
            ＋ 添加宾客
          </button>
        ) : (
          <>
            <h3>新宾客</h3>
            <div className="field">
              <label>姓名</label>
              <input
                type="text"
                value={name}
                placeholder="可与已有宾客同名"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                autoFocus
              />
            </div>
            <div className="field">
              <label>回复</label>
              <select value={rsvp} onChange={(e) => setRsvp(e.target.value as Guest['rsvp'])}>
                <option value="accepted">已接受</option>
                <option value="pending">未回复</option>
                <option value="declined">已婉拒</option>
              </select>
            </div>
            <div className="field wrap">
              <label>
                <input
                  type="checkbox"
                  checked={isChild}
                  onChange={(e) => setIsChild(e.target.checked)}
                />{' '}
                儿童（坐儿童椅）
              </label>
            </div>
            <div className="row">
              <button className="primary" onClick={submit}>
                添加
              </button>
              <button className="ghost" onClick={() => setOpen(false)}>
                取消
              </button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              同名宾客会自动获得稳定编号（如 张伟 #2），编号按添加顺序生成且不再改变。
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
