import { useMemo, useState } from 'react';
import type { SeatingProject, Guest, RSVP } from '../types';
import { guestLabel, uid } from '../lib/ids';
import { seatedGuestIds } from '../lib/apply';
import type { ProjectApi } from '../state/store';
import { GuestEditor } from './GuestEditor';
import { RelationsPanel } from './RelationsPanel';
import { addGuest, removeGuest } from '../lib/seatingOps';

type Tab = 'unseated' | 'all' | 'relations';

export function GuestSidebar({
  store,
  selectedGuestId,
  onSelectGuest,
}: {
  store: ProjectApi;
  selectedGuestId: string | null;
  onSelectGuest: (id: string | null) => void;
}) {
  const { project, commit } = store;
  const [tab, setTab] = useState<Tab>('unseated');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Guest | null | 'new'>(null);
  const [showRelations, setShowRelations] = useState(false);

  const seated = useMemo(() => seatedGuestIds(project), [project]);
  const rsvpFilter = useState<'all' | RSVP>('all');

  const list = useMemo(() => {
    const q = query.trim();
    return project.guests.filter((g) => {
      if (tab === 'unseated' && seated.has(g.id)) return false;
      if (rsvpFilter[0] !== 'all' && g.rsvp !== rsvpFilter[0]) return false;
      if (!q) return true;
      return (
        g.name.includes(q) ||
        g.dietary.includes(q) ||
        g.tags.includes(q) ||
        (project.families.find((f) => f.id === g.familyId)?.name ?? '').includes(q)
      );
    });
  }, [project, tab, query, seated, rsvpFilter]);

  const counts = useMemo(() => {
    const pending = project.guests.filter((g) => g.rsvp === 'pending').length;
    const declined = project.guests.filter((g) => g.rsvp === 'declined').length;
    const children = project.guests.filter((g) => g.isChild).length;
    return { pending, declined, children, total: project.guests.length, unseated: project.guests.filter((g) => !seated.has(g.id) && g.rsvp !== 'declined').length };
  }, [project, seated]);

  if (showRelations) {
    return (
      <RelationsPanel
        project={project}
        onBack={() => setShowRelations(false)}
        onChange={(relations, nearPrefs) =>
          commit((p) => ({ ...p, relations, nearPrefs }), { keepPlan: true })
        }
      />
    );
  }

  return (
    <div className="sidebar">
      <div className="tabs">
        <button className={tab === 'unseated' ? 'active' : ''} onClick={() => setTab('unseated')}>
          未排座 ({counts.unseated})
        </button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          全部 ({counts.total})
        </button>
        <button className={tab === 'relations' ? 'active' : ''} onClick={() => setShowRelations(true)}>
          关系/偏好
        </button>
      </div>
      <div className="body">
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            placeholder="搜索姓名/忌口/家庭…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            title="新增宾客"
            onClick={() => {
              setEditing('new');
              onSelectGuest(null);
            }}
          >
            ＋
          </button>
        </div>
        <div className="small" style={{ marginBottom: 8 }}>
          儿童 {counts.children} · 未回复 {counts.pending} · 谢绝 {counts.declined}
          <div style={{ marginTop: 4 }}>
            出席筛选：
            <select value={rsvpFilter[0]} onChange={(e) => rsvpFilter[1](e.target.value as RSVP | 'all')}>
              <option value="all">全部</option>
              <option value="accepted">已确认</option>
              <option value="pending">未回复</option>
              <option value="declined">已谢绝</option>
            </select>
          </div>
        </div>

        {list.map((g) => (
          <GuestRow
            key={g.id}
            project={project}
            g={g}
            selected={g.id === selectedGuestId}
            seatedHere={seated.has(g.id)}
            onSelect={() => onSelectGuest(g.id === selectedGuestId ? null : g.id)}
            onEdit={() => setEditing(g)}
          />
        ))}
        {list.length === 0 && <div className="small" style={{ padding: 12 }}>暂无宾客</div>}
      </div>

      {editing !== null && (
        <GuestEditor
          project={project}
          guest={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(data, id) => {
            if (id) {
              commit((p) => {
                const next = structuredClone(p);
                const g = next.guests.find((x) => x.id === id);
                if (g) Object.assign(g, data);
                return next;
              }, { keepPlan: true });
            } else {
              commit((p) => addGuest(p, data as Parameters<typeof addGuest>[1]), { keepPlan: true });
            }
            setEditing(null);
          }}
          onCreateFamily={(name) => {
            const existing = project.families.find((f) => f.name === name);
            if (existing) return existing.id;
            const fid = uid('fam');
            commit(
              (p) => {
                if (p.families.some((f) => f.id === fid || f.name === name)) return p;
                const next = structuredClone(p);
                next.families.push({ id: fid, name });
                return next;
              },
              { keepPlan: true },
            );
            return fid;
          }}
          onRemove={(id) => {
            commit((p) => removeGuest(p, id), { keepPlan: true });
            setEditing(null);
            onSelectGuest(null);
          }}
        />
      )}
    </div>
  );
}

function GuestRow({
  project,
  g,
  selected,
  seatedHere,
  onSelect,
  onEdit,
}: {
  project: SeatingProject;
  g: Guest;
  selected: boolean;
  seatedHere: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const family = project.families.find((f) => f.id === g.familyId);
  const tableName = (() => {
    if (!seatedHere) return null;
    for (const t of project.venue.tables) {
      const i = (project.seats[t.id] ?? []).indexOf(g.id);
      if (i >= 0) return t.name;
    }
    return null;
  })();
  return (
    <div className={`guest-item ${selected ? 'selected' : ''}`} onClick={onSelect} title="点击选中后，在场地中点击空座即可入座">
      <span className="name">{guestLabel(g)}</span>
      <span className="badges">
        {g.isChild && <span className="badge child">童</span>}
        {g.dietary && <span className="badge dietary" title={`忌口：${g.dietary}`}>忌</span>}
        {g.rsvp === 'pending' && <span className="badge pending">未回复</span>}
        {g.rsvp === 'declined' && <span className="badge declined">谢绝</span>}
        {seatedHere && <span className="badge seated">{tableName}</span>}
        {family && <span className="badge" title={family.name}>{family.name}</span>}
      </span>
      <button
        className="ghost iconbtn"
        title="编辑"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        ✎
      </button>
    </div>
  );
}
