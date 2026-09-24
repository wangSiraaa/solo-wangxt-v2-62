import { useMemo, useState } from 'react';
import type {
  AutoPlanCandidate,
  Guest,
  GuestRelation,
  PlannerState,
  ProximityStrength,
  RelationKind,
  SolveCostBreakdown,
  TableDef,
  WeddingProject,
} from '../types';
import type { GeometryIssue } from '../lib/geometry';
import type { DietaryRestriction } from '../types';

interface InspectorProps {
  state: PlannerState;
  dietary: DietaryRestriction[];
  geometryIssues: GeometryIssue[];
  manualScore: SolveCostBreakdown;
  onSeatGuest: (guestId: string, tableId: string, seatIndex?: number) => void;
  onUnseatGuest: (guestId: string) => void;
  onToggleLock: (guestId: string) => void;
  onEditGuest: (guestId: string, patch: Partial<Guest>) => void;
  onDeleteGuest: (guestId: string) => void;
  onChangeTable: (tableId: string, patch: Partial<TableDef>) => void;
  onAddChildChair: (tableId: string) => void;
  onRemoveChildChair: (assignmentId: string) => void;
  onAddRelation: (rel: Omit<GuestRelation, 'id'>) => void;
  onDeleteRelation: (id: string) => void;
  onAddPreference: (guestId: string, tableId: string | undefined, strength: ProximityStrength) => void;
  onDeletePreference: (id: string) => void;
  onUpsertDietary: (guestId: string, type: string, detail?: string) => void;
  onDeleteDietary: (id: string) => void;
  onApplyCandidate: () => void;
  onDiscardCandidate: () => void;
}

function ScoreCard({
  title,
  score,
  variant,
}: {
  title: string;
  score: SolveCostBreakdown;
  variant: 'manual' | 'auto';
}) {
  return (
    <div className={`cost-card ${variant}`}>
      <div className="muted">{title}</div>
      <div className="big">{score.total}</div>
      <div className="cost-line">
        <span>同桌偏好</span>
        <span>{score.preferNear}</span>
      </div>
      <div className="cost-line">
        <span>靠近主桌</span>
        <span>{score.tablePreference}</span>
      </div>
      <div className="cost-line">
        <span>未回复排入</span>
        <span>{score.pendingSeated}</span>
      </div>
    </div>
  );
}

function CandidatePanel({
  candidate,
  manualScore,
  onApply,
  onDiscard,
}: {
  candidate: AutoPlanCandidate;
  manualScore: SolveCostBreakdown;
  onApply: () => void;
  onDiscard: () => void;
}) {
  if (candidate.status === 'infeasible') {
    return (
      <div className="candidate-bar infeasible">
        <h3>⚠️ 自动排座无解</h3>
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>
          当前硬条件（家庭同桌 / 明确避让 / 锁定座位 / 容量）互相冲突，求解器（glpk.js, Worker 内）
          确认不存在可行方案。可能原因：
        </div>
        <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.8 }}>
          {candidate.infeasibilityHint}
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          当前手工方案未被改动。可解锁部分座位或调整避让关系后重试。
        </div>
        <div className="btn-row">
          <button onClick={onDiscard}>关闭</button>
        </div>
      </div>
    );
  }

  const diff = candidate.costBreakdown.total - manualScore.total;
  return (
    <div className="candidate-bar">
      <h3>自动方案候选（尚未应用）</h3>
      <div className="cost-grid">
        <ScoreCard title="当前手工方案" score={manualScore} variant="manual" />
        <ScoreCard title="自动方案" score={candidate.costBreakdown} variant="auto" />
      </div>
      <div style={{ fontSize: 12 }}>
        {diff < 0 ? (
          <>
            自动方案软代价 <b style={{ color: 'var(--green)' }}>低 {-diff}</b>，偏好满足更好。
          </>
        ) : diff === 0 ? (
          <>两套方案软代价相同。</>
        ) : (
          <>
            自动方案软代价反而高 {diff}（可能受锁定座位限制），请人工判断。
          </>
        )}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        锁定座位在自动方案中原地保留；预览中橙色座位为自动结果。应用后仍可撤销。
      </div>
      <div className="btn-row">
        <button className="primary" onClick={onApply}>
          应用自动方案
        </button>
        <button onClick={onDiscard}>放弃，保留手工方案</button>
      </div>
    </div>
  );
}

function GuestInspector({
  guest,
  project,
  dietary,
  onSeatGuest,
  onUnseatGuest,
  onToggleLock,
  onEditGuest,
  onDeleteGuest,
  onAddRelation,
  onDeleteRelation,
  onAddPreference,
  onDeletePreference,
  onUpsertDietary,
  onDeleteDietary,
}: {
  guest: Guest;
  project: WeddingProject;
  dietary: DietaryRestriction[];
} & Pick<
  InspectorProps,
  | 'onSeatGuest'
  | 'onUnseatGuest'
  | 'onToggleLock'
  | 'onEditGuest'
  | 'onDeleteGuest'
  | 'onAddRelation'
  | 'onDeleteRelation'
  | 'onAddPreference'
  | 'onDeletePreference'
  | 'onUpsertDietary'
  | 'onDeleteDietary'
>) {
  const assignment = project.assignments.find((a) => a.guestId === guest.id);
  const table = assignment ? project.tables.find((t) => t.id === assignment.tableId) : null;
  const [targetTable, setTargetTable] = useState(project.tables[0]?.id ?? '');
  const [dietType, setDietType] = useState('');
  const [dietDetail, setDietDetail] = useState('');
  const [relOther, setRelOther] = useState('');
  const [relKind, setRelKind] = useState<RelationKind>('family');

  const myRelations = project.relations.filter(
    (r) => r.guestA === guest.id || r.guestB === guest.id,
  );
  const myPreferences = project.tablePreferences.filter((p) => p.guestId === guest.id);
  const myDietary = dietary.filter((d) => d.guestId === guest.id);

  const otherName = (id: string) => project.guests.find((g) => g.id === id)?.displayName ?? id;

  return (
    <>
      <div className="section">
        <h3>宾客信息</h3>
        <div className="field">
          <label>显示名</label>
          <span style={{ fontWeight: 600 }}>{guest.displayName}</span>
        </div>
        <div className="field">
          <label>回复状态</label>
          <select
            value={guest.rsvp}
            onChange={(e) => onEditGuest(guest.id, { rsvp: e.target.value as Guest['rsvp'] })}
          >
            <option value="accepted">已接受</option>
            <option value="pending">未回复</option>
            <option value="declined">已婉拒</option>
          </select>
        </div>
        <div className="field wrap">
          <label>
            <input
              type="checkbox"
              checked={guest.isChild}
              onChange={(e) => onEditGuest(guest.id, { isChild: e.target.checked })}
            />{' '}
            儿童（儿童椅标记）
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="danger" onClick={() => onDeleteGuest(guest.id)}>
            删除宾客
          </button>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          删除宾客不会删除其忌口记录（忌口独立存储）。
        </div>
      </div>

      <div className="section">
        <h3>座位</h3>
        {assignment && table ? (
          <>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>
              当前：<b>{table.label}</b> · 第 {assignment.seatIndex + 1} 位
              {assignment.locked ? ' 🔒 已锁定' : ''}
            </div>
            <div className="row">
              <button onClick={() => onToggleLock(guest.id)}>
                {assignment.locked ? '解锁（允许自动排座移动）' : '锁定座位（自动排座不可动）'}
              </button>
              <button onClick={() => onUnseatGuest(guest.id)} disabled={assignment.locked}>
                撤下
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>
              {guest.rsvp === 'declined'
                ? '该宾客已婉拒，不参与排座。'
                : guest.rsvp === 'pending'
                  ? '该宾客尚未回复：自动排座默认不安排，但可以手工指定座位。'
                  : '尚未入座。'}
            </div>
            {guest.rsvp !== 'declined' && (
              <div className="field">
                <label>安排到</label>
                <select value={targetTable} onChange={(e) => setTargetTable(e.target.value)}>
                  {project.tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  disabled={!targetTable}
                  onClick={() => onSeatGuest(guest.id, targetTable)}
                >
                  安排
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="section">
        <h3>关系（硬条件 + 软偏好）</h3>
        {myRelations.length === 0 && <div className="muted">暂无关系</div>}
        {myRelations.map((r) => {
          const other = r.guestA === guest.id ? r.guestB : r.guestA;
          const label =
            r.kind === 'family' ? '家庭·必须同桌' : r.kind === 'avoid' ? '避让·必须分桌' : '希望同桌（软）';
          return (
            <div className="relation-row" key={r.id}>
              <span className={`kind-tag ${r.kind}`}>{label}</span>
              <span style={{ flex: 1 }}>{otherName(other)}</span>
              <button className="ghost" onClick={() => onDeleteRelation(r.id)}>
                ✕
              </button>
            </div>
          );
        })}
        {myPreferences.map((p) => {
          const target = p.tableId
            ? project.tables.find((t) => t.id === p.tableId)?.label
            : '主桌';
          return (
            <div className="relation-row" key={p.id}>
              <span className="kind-tag preferNear">
                靠近{target}（{p.strength === 'next-to' ? '要求紧邻' : '尽量靠近'}·软）
              </span>
              <span style={{ flex: 1 }} />
              <button className="ghost" onClick={() => onDeletePreference(p.id)}>
                ✕
              </button>
            </div>
          );
        })}
        <div style={{ marginTop: 8 }}>
          <div className="field">
            <label>对象</label>
            <select value={relOther} onChange={(e) => setRelOther(e.target.value)}>
              <option value="">选择宾客…</option>
              {project.guests
                .filter((g) => g.id !== guest.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.displayName}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label>类型</label>
            <select value={relKind} onChange={(e) => setRelKind(e.target.value as RelationKind)}>
              <option value="family">家庭同行（硬·同桌）</option>
              <option value="avoid">明确避让（硬·分桌）</option>
              <option value="preferNear">希望同桌（软·代价）</option>
            </select>
          </div>
          <button
            disabled={!relOther}
            onClick={() => {
              if (!relOther) return;
              onAddRelation({
                guestA: guest.id,
                guestB: relOther,
                kind: relKind,
                weight: relKind === 'preferNear' ? 10 : undefined,
              });
              setRelOther('');
            }}
          >
            添加关系
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="field">
            <label>靠近桌</label>
            <select
              onChange={(e) => {
                const val = e.target.value;
                onAddPreference(
                  guest.id,
                  val === '__head__' ? undefined : val,
                  'near',
                );
                e.target.value = '';
              }}
              defaultValue=""
            >
              <option value="" disabled>
                添加靠近偏好…
              </option>
              <option value="__head__">任意主桌（软）</option>
              {project.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>忌口（独立于席位存储）</h3>
        {myDietary.length === 0 && (
          <div className="muted">无忌口。换座/重新自动排座不会影响此处数据，导出桌卡始终读取这里。</div>
        )}
        {myDietary.map((d) => (
          <div className="diet-row" key={d.id}>
            <span style={{ fontWeight: 600 }}>{d.type}</span>
            {d.detail && <span className="muted" style={{ flex: 1 }}>{d.detail}</span>}
            <span style={{ flex: d.detail ? 0 : 1 }} />
            <button className="ghost" onClick={() => onDeleteDietary(d.id)}>
              ✕
            </button>
          </div>
        ))}
        <div className="field" style={{ marginTop: 8 }}>
          <label>忌口类型</label>
          <input
            type="text"
            list="diet-types"
            value={dietType}
            placeholder="素食 / 清真 / 坚果过敏…"
            onChange={(e) => setDietType(e.target.value)}
          />
        </div>
        <div className="field">
          <label>细节</label>
          <input
            type="text"
            value={dietDetail}
            placeholder="可选"
            onChange={(e) => setDietDetail(e.target.value)}
          />
        </div>
        <button
          disabled={!dietType.trim()}
          onClick={() => {
            onUpsertDietary(guest.id, dietType, dietDetail.trim() || undefined);
            setDietType('');
            setDietDetail('');
          }}
        >
          添加忌口
        </button>
        <datalist id="diet-types">
          <option value="素食" />
          <option value="清真" />
          <option value="坚果过敏" />
          <option value="海鲜过敏" />
          <option value="无麸质" />
        </datalist>
      </div>
    </>
  );
}

function TableInspector({
  table,
  project,
  geometryIssues,
  onChangeTable,
  onAddChildChair,
  onRemoveChildChair,
}: {
  table: TableDef;
  project: WeddingProject;
  geometryIssues: GeometryIssue[];
} & Pick<InspectorProps, 'onChangeTable' | 'onAddChildChair' | 'onRemoveChildChair'>) {
  const issues = geometryIssues.filter((i) => i.tableId === table.id);
  const chairs = project.assignments.filter(
    (a) => a.tableId === table.id && a.childChair && !a.guestId,
  );
  const used = project.assignments.filter((a) => a.tableId === table.id).length;

  return (
    <>
      <div className="section">
        <h3>桌子信息</h3>
        <div className="field">
          <label>名称</label>
          <input
            type="text"
            value={table.label}
            onChange={(e) => onChangeTable(table.id, { label: e.target.value })}
          />
        </div>
        <div className="field">
          <label>容量</label>
          <input
            type="number"
            min={1}
            max={30}
            value={table.capacity}
            onChange={(e) => onChangeTable(table.id, { capacity: Math.max(1, Number(e.target.value)) })}
          />
        </div>
        <div className="field">
          <label>桌形</label>
          <select
            value={table.shape}
            onChange={(e) =>
              onChangeTable(table.id, { shape: e.target.value as TableDef['shape'] })
            }
          >
            <option value="round">圆桌</option>
            <option value="rect">长桌</option>
          </select>
        </div>
        <div className="field wrap">
          <label>
            <input
              type="checkbox"
              checked={table.isHeadTable}
              onChange={(e) => onChangeTable(table.id, { isHeadTable: e.target.checked })}
            />{' '}
            主桌（“靠近主桌”偏好的参照）
          </label>
        </div>
        <div className="muted">
          坐标 ({table.x}, {table.y}) · 已用 {used}/{table.capacity}
          {used > table.capacity && <span style={{ color: 'var(--red)' }}>（超员）</span>}
        </div>
      </div>

      <div className="section">
        <h3>儿童椅占位</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          用于随父母前来、未单独登记的婴幼儿。占位占用一个容量、默认锁定，自动排座不会移动。
        </div>
        {chairs.map((a) => (
          <div className="relation-row" key={a.id}>
            <span>第 {a.seatIndex + 1} 位 · 童椅占位 🔒</span>
            <span style={{ flex: 1 }} />
            <button className="ghost" onClick={() => onRemoveChildChair(a.id)}>
              移除
            </button>
          </div>
        ))}
        <button disabled={used >= table.capacity} onClick={() => onAddChildChair(table.id)}>
          ＋ 添加儿童椅占位
        </button>
      </div>

      {issues.length > 0 && (
        <div className="section">
          <h3 style={{ color: 'var(--red)' }}>几何问题</h3>
          <ul className="issue-list" style={{ marginTop: 0 }}>
            {issues.map((i, idx) => (
              <li key={idx}>{i.detail}</li>
            ))}
          </ul>
          <div className="muted">
            可直接在画布上把桌子拖离红色区域。该检查仅为几何占用判断，不构成安全认证。
          </div>
        </div>
      )}
    </>
  );
}

export default function Inspector(props: InspectorProps) {
  const { state, dietary, geometryIssues, manualScore } = props;
  const guest = useMemo(
    () => state.project.guests.find((g) => g.id === state.selectedGuestId) ?? null,
    [state.project.guests, state.selectedGuestId],
  );
  const table = useMemo(
    () => state.project.tables.find((t) => t.id === state.selectedTableId) ?? null,
    [state.project.tables, state.selectedTableId],
  );

  return (
    <aside className="inspector">
      <div className="panel-head">
        检查器
        <span className="muted">{guest ? '宾客' : table ? '桌子' : '概览'}</span>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {state.autoCandidate && (
          <CandidatePanel
            candidate={state.autoCandidate}
            manualScore={manualScore}
            onApply={props.onApplyCandidate}
            onDiscard={props.onDiscardCandidate}
          />
        )}
        {guest ? (
          <GuestInspector
            guest={guest}
            project={state.project}
            dietary={dietary}
            onSeatGuest={props.onSeatGuest}
            onUnseatGuest={props.onUnseatGuest}
            onToggleLock={props.onToggleLock}
            onEditGuest={props.onEditGuest}
            onDeleteGuest={props.onDeleteGuest}
            onAddRelation={props.onAddRelation}
            onDeleteRelation={props.onDeleteRelation}
            onAddPreference={props.onAddPreference}
            onDeletePreference={props.onDeletePreference}
            onUpsertDietary={props.onUpsertDietary}
            onDeleteDietary={props.onDeleteDietary}
          />
        ) : table ? (
          <TableInspector
            table={table}
            project={state.project}
            geometryIssues={geometryIssues}
            onChangeTable={props.onChangeTable}
            onAddChildChair={props.onAddChildChair}
            onRemoveChildChair={props.onRemoveChildChair}
          />
        ) : (
          <div className="section">
            <h3>当前手工方案软代价</h3>
            <ScoreCard title="手工方案（实时）" score={manualScore} variant="manual" />
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
              软代价越小越好：硬条件（家庭同桌、避让分桌、容量、锁定）不参与代价而是必须满足；
              “希望同桌”“靠近主桌”等偏好可放宽，未满足时累加代价。
            </div>
            {geometryIssues.length > 0 && (
              <>
                <h3 style={{ color: 'var(--red)', marginTop: 14 }}>场地几何问题</h3>
                <ul className="issue-list" style={{ marginTop: 0 }}>
                  {geometryIssues.slice(0, 20).map((i, idx) => (
                    <li key={idx}>{i.detail}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <div className="disclaimer">
        过道、消防出口缓冲区等禁止占用多边形来自项目场地数据，仅做几何占用检查，
        不声称通过任何消防安全认证或合规审查。
      </div>
    </aside>
  );
}
