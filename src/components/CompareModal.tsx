import { useMemo } from 'react';
import type { SeatingProject } from '../types';
import type { AutoPlan } from '../state/store';
import { applyAssignment } from '../lib/apply';
import { guestLabel } from '../lib/ids';

export function CompareModal({
  project,
  plan,
  onClose,
}: {
  project: SeatingProject;
  plan: AutoPlan;
  onClose: () => void;
}) {
  const rows = useMemo(() => buildDiff(project, plan), [project, plan]);
  const moved = rows.filter((r) => r.status === 'move');
  const stay = rows.filter((r) => r.status === 'stay');
  const leave = rows.filter((r) => r.status === 'leave');
  const arrive = rows.filter((r) => r.status === 'arrive');

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 620 }}>
        <h3>手工方案 vs 自动方案</h3>
        <div className="small" style={{ marginBottom: 8 }}>
          自动方案总代价 <b className="mono">{plan.cost.total}</b>
          （靠近 {plan.cost.near} / 同桌 {plan.cost.like} / 分开 {plan.cost.dislike}
          {plan.cost.unseated > 0 ? ` / 未排座 ${plan.cost.unseated}` : ''}）
        </div>
        <div className="cost-grid" style={{ fontSize: 12 }}>
          <span className="pill">需移动：{moved.length}</span>
          <span className="pill">保持原位：{stay.length}</span>
          <span className="pill">被移出：{leave.length}</span>
          <span className="pill">新入座：{arrive.length}</span>
        </div>

        <table className="diff-table">
          <thead>
            <tr>
              <th>宾客</th>
              <th>当前（手工）</th>
              <th>自动方案</th>
              <th>变化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.guestId}>
                <td>{guestLabel(r.guest)}</td>
                <td>{r.from ?? <span className="small">未排座</span>}</td>
                <td>{r.to ?? <span className="small">未排座</span>}</td>
                <td>
                  {r.status === 'stay' && <span style={{ color: 'var(--ok)' }}>不变</span>}
                  {r.status === 'move' && <span style={{ color: 'var(--warn)' }}>移动</span>}
                  {r.status === 'leave' && <span style={{ color: 'var(--danger)' }}>移出</span>}
                  {r.status === 'arrive' && <span style={{ color: 'var(--brand-dark)' }}>新入座</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="actions">
          <button onClick={onClose}>返回预览</button>
        </div>
      </div>
    </div>
  );
}

interface DiffRow {
  guestId: string;
  guest: SeatingProject['guests'][number];
  from: string | null;
  to: string | null;
  status: 'stay' | 'move' | 'leave' | 'arrive';
}

function buildDiff(p: SeatingProject, plan: AutoPlan): DiffRow[] {
  const byId = new Map(p.guests.map((g) => [g.id, g]));
  const tableName = new Map(p.venue.tables.map((t) => [t.id, t.name]));

  const curAt = new Map<string, string>();
  for (const t of p.venue.tables) {
    for (const gid of p.seats[t.id] ?? []) {
      if (gid) curAt.set(gid, tableName.get(t.id) ?? t.id);
    }
  }

  const { seats } = applyAssignment(p, plan.assignment);
  const newAt = new Map<string, string>();
  for (const t of p.venue.tables) {
    for (const gid of seats[t.id] ?? []) {
      if (gid) newAt.set(gid, tableName.get(t.id) ?? t.id);
    }
  }

  const ids = new Set([...curAt.keys(), ...newAt.keys()]);
  const rows: DiffRow[] = [];
  for (const id of ids) {
    const guest = byId.get(id);
    if (!guest) continue;
    const from = curAt.get(id) ?? null;
    const to = newAt.get(id) ?? null;
    const status: DiffRow['status'] =
      from && to ? (from === to ? 'stay' : 'move') : to ? 'arrive' : 'leave';
    rows.push({ guestId: id, guest, from, to, status });
  }
  rows.sort((a, b) => a.guest.name.localeCompare(b.guest.name, 'zh'));
  return rows;
}
