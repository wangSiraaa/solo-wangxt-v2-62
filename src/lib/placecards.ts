// ───────────────────────────────────────────────────────────────────────────
// 桌卡导出
// 关键：忌口数据从独立的 dietary 列表（IndexedDB dietary store 权威副本）读取，
// 而不是从座位分配里带出来。因此无论宾客怎样换座 / 重新自动排座 / 撤下再安排，
// 桌卡上的忌口都不会丢失。未入座宾客可选是否一并导出（标注“未排座”）。
// ───────────────────────────────────────────────────────────────────────────

import type { DietaryRestriction, WeddingProject } from '../types';

export interface PlaceCard {
  guestName: string;
  tableLabel: string | null;
  seatIndex: number | null;
  dietary: DietaryRestriction[];
  rsvp: string;
}

const RSVP_LABEL: Record<string, string> = {
  accepted: '已出席',
  pending: '未回复',
  declined: '已婉拒',
};

export function buildPlaceCards(
  project: WeddingProject,
  dietary: DietaryRestriction[],
  opts: { includeUnseated?: boolean } = {},
): PlaceCard[] {
  const dietaryByGuest = new Map<string, DietaryRestriction[]>();
  for (const d of dietary) {
    const list = dietaryByGuest.get(d.guestId) ?? [];
    list.push(d);
    dietaryByGuest.set(d.guestId, list);
  }

  const cards: PlaceCard[] = [];

  for (const g of project.guests) {
    if (g.rsvp === 'declined') continue;
    const assignment = project.assignments.find((a) => a.guestId === g.id);
    if (!assignment && !opts.includeUnseated) continue;
    const table = assignment
      ? project.tables.find((t) => t.id === assignment.tableId)
      : null;
    cards.push({
      guestName: g.displayName,
      tableLabel: table?.label ?? null,
      seatIndex: assignment?.seatIndex ?? null,
      dietary: dietaryByGuest.get(g.id) ?? [],
      rsvp: RSVP_LABEL[g.rsvp] ?? g.rsvp,
    });
  }

  // 排序：桌号 → 座位序号，未排座附后
  cards.sort((a, b) => {
    if (!a.tableLabel && b.tableLabel) return 1;
    if (a.tableLabel && !b.tableLabel) return -1;
    const c = (a.tableLabel ?? '').localeCompare(b.tableLabel ?? '', 'zh');
    if (c !== 0) return c;
    return (a.seatIndex ?? 0) - (b.seatIndex ?? 0);
  });
  return cards;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function placeCardsHtml(
  project: WeddingProject,
  dietary: DietaryRestriction[],
  includeUnseated: boolean,
): string {
  const cards = buildPlaceCards(project, dietary, { includeUnseated });
  const items = cards
    .map((c) => {
      const diet =
        c.dietary.length > 0
          ? `<div class="diet">忌口：${escapeHtml(
              c.dietary.map((d) => (d.detail ? `${d.type}（${d.detail}）` : d.type)).join('、'),
            )}</div>`
          : '<div class="diet diet-none">无特殊忌口</div>';
      const seat =
        c.tableLabel && c.seatIndex !== null
          ? `<div class="table">${escapeHtml(c.tableLabel)} · 第 ${c.seatIndex + 1} 位</div>`
          : '<div class="table unseated">未排座</div>';
      return `
        <section class="card${c.tableLabel ? '' : ' card-unseated'}">
          <div class="name">${escapeHtml(c.guestName)}</div>
          ${seat}
          ${diet}
          <div class="rsvp">${escapeHtml(c.rsvp)}</div>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(project.name)} · 桌卡</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Serif SC", "Songti SC", serif; margin: 0; padding: 24px; background: #f6f2ec; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 4px; }
  .meta { text-align: center; color: #8a7d6d; font-size: 12px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .card {
    background: #fffdf8; border: 1px solid #d9c7ac; border-radius: 10px;
    padding: 20px; min-height: 150px; display: flex; flex-direction: column; gap: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
  }
  .card-unseated { border-style: dashed; opacity: .75; }
  .name { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .table { font-size: 15px; color: #7c5a2e; }
  .unseated { color: #a3503a; }
  .diet { font-size: 13px; color: #2f6b4f; background: #eef7f1; border-radius: 6px; padding: 6px 8px; }
  .diet-none { color: #9a9084; background: transparent; padding: 0; }
  .rsvp { margin-top: auto; font-size: 11px; color: #a99c8c; }
  @media print {
    body { background: #fff; padding: 0; }
    .card { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(project.name)} · 桌卡</h1>
  <div class="meta">生成时间 ${new Date().toLocaleString('zh-CN')} · 共 ${cards.length} 张 · 忌口独立存档，换座不丢失</div>
  <div class="grid">${items}</div>
</body>
</html>`;
}

/** 触发下载一个离线 HTML 文件（无服务端） */
export function downloadPlaceCards(
  project: WeddingProject,
  dietary: DietaryRestriction[],
  includeUnseated: boolean,
): void {
  const html = placeCardsHtml(project, dietary, includeUnseated);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = project.name.replace(/[\\/:*?"<>|]/g, '_');
  a.href = url;
  a.download = `桌卡_${safe}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
