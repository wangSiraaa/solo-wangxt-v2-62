import { useState } from 'react';
import type { VenueTable } from '../types';
import { uid } from '../lib/ids';
import type { SeatingProject } from '../types';

export function TableEditor({
  project,
  table,
  onClose,
  onSave,
  onDelete,
}: {
  project: SeatingProject;
  table: VenueTable;
  onClose: () => void;
  onSave: (t: VenueTable) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<VenueTable>(table);
  const set = (patch: Partial<VenueTable>) => setDraft((d) => ({ ...d, ...patch }));

  const oldSeats = project.seats[table.id] ?? [];
  const warnShrink = draft.seats < table.seats && oldSeats.slice(draft.seats).some(Boolean);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>编辑桌子</h3>
        <div className="row">
          <label>名称</label>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="row">
          <label>形状</label>
          <select value={draft.shape} onChange={(e) => set({ shape: e.target.value as VenueTable['shape'] })}>
            <option value="round">圆桌</option>
            <option value="rect">长桌</option>
          </select>
        </div>
        <div className="row">
          <label>座位数</label>
          <input
            type="number"
            min={1}
            max={30}
            value={draft.seats}
            onChange={(e) => set({ seats: Math.max(1, Number(e.target.value) || 1) })}
          />
          {warnShrink && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>
              缩小会截断已有座位上的宾客
            </span>
          )}
        </div>
        <div className="row">
          <label>{draft.shape === 'round' ? '半径' : '半宽'}</label>
          <input
            type="number"
            value={draft.radius}
            onChange={(e) => set({ radius: Math.max(20, Number(e.target.value) || 20) })}
          />
        </div>
        {draft.shape === 'rect' && (
          <div className="row">
            <label>半高</label>
            <input
              type="number"
              value={draft.halfHeight}
              onChange={(e) => set({ halfHeight: Math.max(20, Number(e.target.value) || 20) })}
            />
          </div>
        )}
        <div className="row">
          <label>坐标</label>
          <span className="small mono">x={Math.round(draft.x)}, y={Math.round(draft.y)}（在布局模式拖动修改）</span>
        </div>
        <div className="row">
          <label>主桌</label>
          <input
            type="checkbox"
            checked={draft.isHead}
            onChange={(e) => set({ isHead: e.target.checked })}
          />
          <span className="small">全场地仅一个主桌，勾选后会取消其他桌的主桌标记</span>
        </div>
        <div className="row">
          <label>锁定布局</label>
          <input
            type="checkbox"
            checked={draft.positionLocked}
            onChange={(e) => set({ positionLocked: e.target.checked })}
          />
          <span className="small">锁定后布局模式下不可拖动（不影响座位锁定）</span>
        </div>
        <div className="actions">
          <button
            className="danger"
            onClick={() => {
              if (confirm(`删除桌子「${table.name}」？该桌座位信息一并删除。`)) onDelete(table.id);
            }}
          >
            删除桌子
          </button>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => onSave(draft)}>保存</button>
        </div>
      </div>
    </div>
  );
}

export function newTable(x = 300, y = 300): VenueTable {
  return {
    id: uid('tbl'),
    name: '新桌',
    shape: 'round',
    x,
    y,
    radius: 60,
    halfHeight: 40,
    seats: 6,
    isHead: false,
    positionLocked: false,
  };
}
