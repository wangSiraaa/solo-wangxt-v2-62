import { useState } from 'react';
import type { Guest, RSVP, SeatingProject } from '../types';
import { nextNameSeq } from '../lib/ids';

type Data = Omit<Guest, 'id' | 'nameSeq'>;

export function GuestEditor({
  project,
  guest,
  onClose,
  onSave,
  onCreateFamily,
  onRemove,
}: {
  project: SeatingProject;
  guest: Guest | null;
  onClose: () => void;
  onSave: (data: Partial<Data> & { name: string }, id: string | null) => void;
  onCreateFamily: (name: string) => string;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(guest?.name ?? '');
  const [familyId, setFamilyId] = useState<string | null>(guest?.familyId ?? null);
  const [rsvp, setRsvp] = useState<RSVP>(guest?.rsvp ?? 'accepted');
  const [isChild, setIsChild] = useState(guest?.isChild ?? false);
  const [dietary, setDietary] = useState(guest?.dietary ?? '');
  const [tags, setTags] = useState(guest?.tags ?? '');
  const [newFamilyName, setNewFamilyName] = useState('');

  const save = () => {
    if (!name.trim()) return;
    let fam = familyId;
    if (newFamilyName.trim()) {
      fam = onCreateFamily(newFamilyName.trim());
    }
    onSave(
      {
        name: name.trim(),
        familyId: fam,
        rsvp,
        isChild,
        dietary: dietary.trim(),
        tags: tags.trim(),
      },
      guest?.id ?? null,
    );
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{guest ? `编辑宾客${guest.nameSeq > 1 ? `（编号 ${guest.nameSeq}）` : ''}` : '新增宾客'}</h3>
        <div className="row">
          <label>姓名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="同名宾客自动加稳定编号" />
        </div>
        {!guest && (
          <div className="small" style={{ marginLeft: 94, marginTop: -6 }}>
            {name.trim() && <>该姓名将被分配编号 {nextNameSeq(project.guests, name.trim())}</>}
          </div>
        )}
        <div className="row">
          <label>家庭同行</label>
          <select value={familyId ?? ''} onChange={(e) => setFamilyId(e.target.value || null)}>
            <option value="">（无）</option>
            {project.families.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>或新建家庭</label>
          <input
            value={newFamilyName}
            onChange={(e) => setNewFamilyName(e.target.value)}
            placeholder="如：王家（硬同桌）"
          />
        </div>
        <div className="row">
          <label>出席状态</label>
          <select value={rsvp} onChange={(e) => setRsvp(e.target.value as RSVP)}>
            <option value="accepted">已确认出席</option>
            <option value="pending">未回复</option>
            <option value="declined">已谢绝</option>
          </select>
        </div>
        <div className="row">
          <label>儿童</label>
          <label className="checkline" style={{ margin: 0 }}>
            <input type="checkbox" checked={isChild} onChange={(e) => setIsChild(e.target.checked)} />
            需儿童椅（可用锁定空座占位）
          </label>
        </div>
        <div className="row">
          <label>忌口</label>
          <input value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder="如：素食 / 海鲜过敏 / 清真" />
        </div>
        <div className="small" style={{ marginLeft: 94 }}>
          忌口独立于席位存储，换座/导出桌卡均不会丢失。
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label>标签</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="自由备注" />
        </div>
        <div className="actions">
          {guest && (
            <button className="danger" onClick={() => onRemove(guest.id)} style={{ marginRight: 'auto' }}>
              删除宾客
            </button>
          )}
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save} disabled={!name.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
