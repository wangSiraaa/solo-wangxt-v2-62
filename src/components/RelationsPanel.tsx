import { useState } from 'react';
import type { NearPref, Relation, RelationKind, SeatingProject } from '../types';
import { guestLabel, uid } from '../lib/ids';

const KIND_LABEL: Record<RelationKind, string> = {
  same: '必须同桌（硬）',
  apart: '必须分桌（硬）',
  like: '希望同桌（软）',
  dislike: '希望分开（软）',
};

export function RelationsPanel({
  project,
  onBack,
  onChange,
}: {
  project: SeatingProject;
  onBack: () => void;
  onChange: (relations: Relation[], nearPrefs: NearPref[]) => void;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [kind, setKind] = useState<RelationKind>('like');

  const byId = (id: string) => project.guests.find((g) => g.id === id);

  const add = () => {
    if (!a || !b || a === b) return;
    const rel: Relation = { id: uid('rel'), a, b, kind };
    onChange([...project.relations, rel], project.nearPrefs);
    setA('');
    setB('');
  };

  const remove = (id: string) =>
    onChange(
      project.relations.filter((r) => r.id !== id),
      project.nearPrefs,
    );

  const toggleNear = (guestId: string) => {
    const exists = project.nearPrefs.some((n) => n.guestId === guestId);
    onChange(
      project.relations,
      exists
        ? project.nearPrefs.filter((n) => n.guestId !== guestId)
        : [...project.nearPrefs, { id: uid('near'), guestId }],
    );
  };

  const nearSet = new Set(project.nearPrefs.map((n) => n.guestId));

  return (
    <div className="sidebar">
      <div className="tabs">
        <button onClick={onBack}>← 返回宾客</button>
      </div>
      <div className="body">
        <div className="section-title">新增关系</div>
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">选择宾客 A…</option>
          {project.guests.map((g) => (
            <option key={g.id} value={g.id}>{guestLabel(g)}</option>
          ))}
        </select>
        <div style={{ margin: '6px 0' }}>
          <select className={`rel-kind ${kind}`} value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
            {(Object.keys(KIND_LABEL) as RelationKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <select value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">选择宾客 B…</option>
          {project.guests.map((g) => (
            <option key={g.id} value={g.id}>{guestLabel(g)}</option>
          ))}
        </select>
        <div style={{ margin: '8px 0' }}>
          <button className="primary" onClick={add} disabled={!a || !b || a === b}>
            添加
          </button>
        </div>
        <div className="small">
          家庭同行已自动作为"必须同桌"硬条件，无需逐个添加；
          硬条件无解时自动排座会停止并列出原因，软条件不满足只增加代价。
        </div>

        <div className="section-title">当前关系（{project.relations.length}）</div>
        {project.relations.map((r) => (
          <div className="rel-row" key={r.id}>
            <span className={`pill rel-kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
            <span style={{ flex: 1, fontSize: 12 }}>
              {byId(r.a) ? guestLabel(byId(r.a)!) : '?'} ↔ {byId(r.b) ? guestLabel(byId(r.b)!) : '?'}
            </span>
            <button className="ghost iconbtn" onClick={() => remove(r.id)}>✕</button>
          </div>
        ))}

        <div className="section-title">靠近主桌偏好（软）</div>
        <div className="small" style={{ marginBottom: 6 }}>
          勾选的宾客在自动排座中优先近主桌；无法满足时按距离档计代价。
        </div>
        {project.guests.map((g) => (
          <label className="checkline" key={g.id} style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={nearSet.has(g.id)} onChange={() => toggleNear(g.id)} />
            {guestLabel(g)}
          </label>
        ))}
      </div>
    </div>
  );
}
