import type { ProjectApi } from '../state/store';

export function PlanPanel({
  store,
  onCompare,
}: {
  store: ProjectApi;
  onCompare: () => void;
}) {
  const { plan, project, applyPlan, discardPlan } = store;
  if (!plan) return null;

  const byId = new Map(project.guests.map((g) => [g.id, g]));
  const c = plan.cost;
  const bad = c.unseated > 0;

  return (
    <div className="plan-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>自动方案（预览中，尚未改动现有座位）</b>
        <span className={`badge ${bad ? 'declined' : ''}`}>{plan.status}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={onCompare}>与当前手工方案比较</button>
        <button onClick={discardPlan}>丢弃</button>
        <button className="primary" onClick={applyPlan} disabled={bad}>
          应用方案
        </button>
      </div>

      <div className="cost-grid">
        <Cost k="总代价" v={c.total} cls={`total ${bad ? 'bad' : ''}`} hint="越小越好" />
        <Cost k="靠近主桌" v={c.near} hint="距离档 × 5" />
        <Cost k="希望同桌未满足" v={c.like} hint={`${c.like / 20} 对 × 20`} />
        <Cost k="希望分开未满足" v={c.dislike} hint={`${c.dislike / 25} 对 × 25`} />
        <Cost k="未排座" v={c.unseated} cls={bad ? 'bad' : ''} hint={`${c.unseated / 100} 人 × 100`} />
      </div>

      {plan.unseated.length > 0 && (
        <div style={{ color: 'var(--danger)' }}>
          无法排入的宾客：
          {plan.unseated.map((id) => byId.get(id)?.name).filter(Boolean).join('、')}
          （容量或硬条件限制；方案未应用，请调整容量/锁定/关系后重试）
        </div>
      )}
      <div className="small">
        软偏好可以被放宽：代价非零表示部分偏好未满足；硬条件（家庭/必须同桌/必须分桌/容量/锁定）始终优先。
      </div>
    </div>
  );
}

function Cost({ k, v, cls, hint }: { k: string; v: number; cls?: string; hint?: string }) {
  return (
    <div className={`cost ${cls ?? ''}`} title={hint}>
      <div className="v mono">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

export function DiagnosticsBanner({
  reasons,
  onDismiss,
}: {
  reasons: string[];
  onDismiss: () => void;
}) {
  if (reasons.length === 0) return null;
  return (
    <div className="plan-panel" style={{ background: '#fdf3f2', borderTopColor: '#e3b8b2' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <b style={{ color: 'var(--danger)' }}>自动排座未执行：硬条件无解</b>
        <span style={{ flex: 1 }} />
        <button onClick={onDismiss}>知道了</button>
      </div>
      <ul className="diag-list">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <div className="small">请解除相应硬条件（解锁座位/修改必须同桌或分桌关系/增加容量）后重试。</div>
    </div>
  );
}
