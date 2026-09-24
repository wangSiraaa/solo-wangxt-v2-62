// 桌卡导出：忌口与席位独立存储——桌卡从 guest.dietary 直接读取，
// 因此无论宾客如何换座，忌口信息始终跟着宾客走，不会因导出而丢失。

import type { SeatingProject } from '../types';
import { guestLabel } from './ids';
import { triggerDownload } from './db';

interface CardRow {
  table: string;
  seat: number;
  guest: string;
  dietary: string;
  child: boolean;
  rsvp: string;
}

export function buildCardRows(p: SeatingProject): CardRow[] {
  const byId = new Map(p.guests.map((g) => [g.id, g]));
  const rows: CardRow[] = [];
  for (const t of p.venue.tables) {
    const row = p.seats[t.id] ?? [];
    row.forEach((gid, i) => {
      if (!gid) return;
      const g = byId.get(gid);
      if (!g) return;
      if (g.rsvp === 'declined') return; // 谢绝出席不导出
      rows.push({
        table: t.name,
        seat: i + 1,
        guest: guestLabel(g),
        dietary: g.dietary || '',
        child: g.isChild,
        rsvp: g.rsvp === 'pending' ? '未回复' : '已确认',
      });
    });
  }
  rows.sort((a, b) => a.table.localeCompare(b.table, 'zh') || a.seat - b.seat);
  return rows;
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCardsCsv(p: SeatingProject): void {
  const rows = buildCardRows(p);
  const header = ['桌名', '座位号', '宾客', '忌口', '儿童', '出席状态'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [r.table, String(r.seat), r.guest, r.dietary, r.child ? '是' : '', r.rsvp]
        .map(csvEscape)
        .join(','),
    ),
  ];
  // 加 BOM 保证 Excel 正确识别 UTF-8 中文
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `${p.name}-桌卡.csv`);
}

export function exportCardsHtml(p: SeatingProject): void {
  const rows = buildCardRows(p);
  const byTable = new Map<string, CardRow[]>();
  for (const r of rows) {
    const arr = byTable.get(r.table) ?? [];
    arr.push(r);
    byTable.set(r.table, arr);
  }
  const tablesHtml = [...byTable.entries()]
    .map(([table, cards]) => {
      const items = cards
        .map(
          (c) => `
        <div class="card${c.child ? ' child' : ''}">
          <div class="guest">${escapeHtml(c.guest)}</div>
          ${c.dietary ? `<div class="dietary">忌口：${escapeHtml(c.dietary)}</div>` : ''}
          ${c.child ? '<div class="tag">儿童椅</div>' : ''}
          ${c.rsvp === '未回复' ? '<div class="tag pending">未回复</div>' : ''}
          <div class="meta">${escapeHtml(table)} · ${c.seat} 号座</div>
        </div>`,
        )
        .join('');
      return `<section><h2>${escapeHtml(table)}</h2><div class="grid">${items}</div></section>`;
    })
    .join('');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${escapeHtml(p.name)} · 桌卡</title>
<style>
  body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#222}
  h1{font-size:20px} h2{font-size:16px;margin:24px 0 10px;border-left:4px solid #b4864b;padding-left:8px}
  .grid{display:flex;flex-wrap:wrap;gap:12px}
  .card{border:2px solid #b4864b;border-radius:10px;padding:12px 16px;min-width:170px;position:relative;background:#fffdf8}
  .card.child{border-style:dashed}
  .guest{font-size:18px;font-weight:600}
  .dietary{color:#c0392b;margin-top:6px;font-size:14px}
  .tag{position:absolute;top:6px;right:8px;font-size:11px;color:#888;border:1px solid #ccc;border-radius:4px;padding:0 4px}
  .tag.pending{color:#b8860b;border-color:#d4af37}
  .meta{color:#888;font-size:12px;margin-top:8px}
  .note{color:#888;font-size:12px;margin-top:32px}
</style></head><body>
<h1>${escapeHtml(p.name)} · 桌卡</h1>
<p class="hint">共 ${rows.length} 张桌卡，忌口独立于席位存储，重新排座后重新导出即可。</p>
${tablesHtml}
<p class="note">生成时间 ${new Date().toLocaleString('zh-CN')} · 离线导出，未经过任何服务器</p>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `${p.name}-桌卡.html`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

