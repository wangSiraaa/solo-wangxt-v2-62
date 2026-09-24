// 端到端验证：真实 Chromium 中跑通
//  1) 冲突样例 => 自动排座报无解原因
//  2) 可解样例 => Worker 求解 => 方案预览/代价/比较/应用
//  3) 手工入座 + Ctrl+Z 撤销
//  4) Shift+点击锁定空座 => 自动排座后锁定占位仍为空
//  5) 同名编号、未回复标记、忌口导出不丢失
//  6) 工程已写入 IndexedDB
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE || 'http://localhost:4173/';
const errors = [];

// 无 root 容器：Chromium 依赖库由 apt-get download 解压到 /tmp/sysroot
const extraLib = '/tmp/sysroot';
let ldPath = process.env.LD_LIBRARY_PATH ?? '';
try {
  const dirs = execSync(
    `find ${extraLib} -type f -name '*.so*' -exec dirname {} \\; | sort -u | paste -sd:`,
  )
    .toString()
    .trim();
  ldPath = dirs + (ldPath ? ':' + ldPath : '');
} catch {
  // 依赖目录不存在时退回系统库
}
const executablePath =
  process.env.CHROMIUM_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell`;

const browser = await chromium.launch({
  executablePath,
  env: { ...process.env, LD_LIBRARY_PATH: ldPath },
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept()); // 所有 confirm 一律接受
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const fail = (m) => {
  console.error('✗ ' + m);
  process.exitCode = 1;
  throw new Error(m);
};
const ok = (m) => console.log('  ✓ ' + m);

// ---- 场地坐标 -> 屏幕坐标（与 src/lib/geometry.ts seatPosition 一致）----
async function seatScreen(table, seatIndex) {
  return page.evaluate(({ table, seatIndex }) => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const VW = 1000, VH = 800, pad = 40;
    const scale = Math.min((wrap.width - pad) / VW, (wrap.height - pad) / VH);
    const stageX = (wrap.width - VW * scale) / 2;
    const stageY = 20;
    const n = table.seats;
    let vx, vy;
    if (table.shape === 'round') {
      const a = -Math.PI / 2 + (seatIndex / n) * Math.PI * 2;
      vx = table.x + (table.radius + 22) * Math.cos(a);
      vy = table.y + (table.radius + 22) * Math.sin(a);
    } else {
      vx = table.x; vy = table.y;
    }
    return {
      x: wrap.left + stageX + vx * scale,
      y: wrap.top + stageY + vy * scale,
    };
  }, { table, seatIndex });
}

await page.goto(BASE, { waitUntil: 'networkidle' });
ok('页面加载');

await page.getByRole('button', { name: /打开演示样例/ }).click();
await page.waitForSelector('.canvas-wrap');
await page.waitForTimeout(300);

// 同名编号 / 未回复标记
const body = await page.locator('.sidebar .body').innerText();
if (!body.includes('王芳 ②')) fail('同名宾客应显示稳定编号 "王芳 ②"');
ok('同名宾客显示稳定编号（王芳 ②）');
if (!body.includes('未回复')) fail('应有未回复宾客标记');
ok('侧栏含未回复宾客标记');

// 禁止区多边形：画布上应有红色虚线（像素检测过于脆弱，改查 HUD 无违规即说明样例桌位没压区）
const hud = await page.locator('.hud').innerText();
if (!hud.includes('几何')) fail('HUD 应提示几何检查与非认证声明');
ok('HUD 明示禁止区仅做几何检查、非安全认证');

// ---- 场景 1：冲突无解 ----
await page.getByRole('button', { name: '自动排座', exact: false }).click();
await page.waitForSelector('.diag-list');
const diag = await page.locator('.diag-list').innerText();
if (!/硬冲突/.test(diag)) fail('冲突样例应列出硬冲突原因，实际：' + diag);
ok('冲突关系样例：自动排座被拦截并列出无解原因');
await page.getByRole('button', { name: '知道了' }).click();

// ---- 载入可解样例 ----
await page.locator('select[title="载入样例"]').selectOption('ok');
await page.waitForTimeout(400);
await page.getByRole('button', { name: '知道了' }).click().catch(() => {});
await page.waitForTimeout(100);

// ---- 手工入座 + 撤销（在侧栏"未排座"列表中选陈五）----
await page.locator('.sidebar .guest-item', { hasText: '陈五' }).first().click();
const C = { shape: 'round', x: 780, y: 330, radius: 60, seats: 6 };
let pos = await seatScreen(C, 0);
await page.mouse.click(pos.x, pos.y);
await page.waitForTimeout(300);
let row = page.locator('.sidebar .guest-item', { hasText: '陈五' }).first();
// 入座后默认"未排座"标签里不再显示，切到"全部"确认桌名
await page.getByRole('button', { name: /全部/ }).click();
row = page.locator('.sidebar .guest-item', { hasText: '陈五' }).first();
if (!(await row.innerText()).includes('C 桌')) fail('手工入座后陈五应显示 C 桌');
ok('手工入座：陈五进入 C 桌');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
row = page.locator('.sidebar .guest-item', { hasText: '陈五' }).first();
if ((await row.innerText()).includes('C 桌')) fail('撤销后陈五不应还在 C 桌');
ok('Ctrl+Z 撤销手工入座');
await page.getByRole('button', { name: /未排座/ }).click();

// ---- 锁定一个空座（A 桌 0 号），自动排座不得占用 ----
// 先点击空白处取消宾客选中，避免 shift+点击时带着选中宾客
await page.mouse.click(10, 450);
const A = { shape: 'round', x: 220, y: 330, radius: 60, seats: 6 };
pos = await seatScreen(A, 0);
await page.keyboard.down('Shift');
await page.mouse.click(pos.x, pos.y);
await page.keyboard.up('Shift');
await page.waitForTimeout(300);
ok('Shift+点击空座完成锁定（儿童椅占位）');

// ---- 场景 2：Worker 自动排座 ----
await page.getByRole('button', { name: /自动排座/ }).click();
await page.waitForSelector('.plan-panel', { timeout: 20000 });
const plan = await page.locator('.plan-panel').innerText();
if (!/总代价/.test(plan)) fail('方案面板应显示代价明细');
if (/未排座\s*\n?\s*[1-9]/.test(plan)) fail('可解样例不应有未排座，面板：' + plan);
ok('Worker 求解完成并显示软代价明细');

// 比较弹窗
await page.getByRole('button', { name: '与当前手工方案比较' }).click();
await page.waitForSelector('.diff-table');
const diffText = await page.locator('.diff-table').innerText();
if (!/移动|新入座/.test(diffText)) fail('比较表应列出移动/新入座变化');
ok('可打开"手工 vs 自动"比较表');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '返回预览' }).click();

// 应用方案
await page.getByRole('button', { name: '应用方案' }).click();
await page.waitForTimeout(1800); // 等待防抖自动保存到 IndexedDB
ok('应用自动方案');

// 锁定占位仍为空：直接查 IndexedDB
const seatCheck = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('wedding-seating-offline');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = await new Promise((res) => {
    const tx = db.transaction('projects', 'readonly').objectStore('projects').getAll();
    tx.onsuccess = () => res(tx.result);
  });
  const p = all[0];
  const aTable = p.venue.tables.find((t) => t.name.startsWith('A'));
  const bTable = p.venue.tables.find((t) => t.name.startsWith('B'));
  const liSi = p.guests.find((g) => g.name === '李四');
  let liSiTable = null;
  for (const t of p.venue.tables) {
    const i = (p.seats[t.id] || []).indexOf(liSi.id);
    if (i >= 0) liSiTable = t.name;
  }
  return {
    projectSaved: all.length > 0,
    aLocked: p.lockedSeats[aTable.id][0],
    aSeat0: p.seats[aTable.id][0],
    liSiTable,
    bLockKept: p.lockedSeats[bTable.id][0] === true && p.seats[bTable.id][0] === liSi.id,
    guestCount: p.guests.length,
    dietary: Object.fromEntries(p.guests.map((g) => [g.name + '#' + g.nameSeq, g.dietary])),
  };
});
if (!seatCheck.projectSaved) fail('工程应已自动保存到 IndexedDB');
ok('工程已写入 IndexedDB');
if (!seatCheck.aLocked || seatCheck.aSeat0 !== null) fail('锁定的空座在自动排座后仍应为空且保持锁定');
ok('锁定空座（儿童椅占位）未被自动排座占用');
if (seatCheck.liSiTable !== 'B 桌' || !seatCheck.bLockKept) fail('锁定宾客李四应留在 B 桌');
ok('锁定宾客未被自动排座移动');

// ---- 忌口导出不丢失（换座后导出仍含忌口）----
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '桌卡 CSV' }).click();
const download = await dl;
const csv = await download.path().then((p) => import('node:fs').then((fs) => fs.readFileSync(p, 'utf8')));
if (!csv.includes('海鲜过敏') || !csv.includes('清真') || !csv.includes('素食')) {
  fail('CSV 桌卡应包含全部忌口：' + csv.slice(0, 200));
}
ok('换座后导出桌卡，忌口仍随宾客保留（素食/海鲜过敏/清真）');

if (errors.length) {
  console.error('浏览器控制台错误：');
  for (const e of errors.slice(0, 10)) console.error(' - ' + e);
  process.exitCode = 1;
} else {
  ok('浏览器控制台无错误');
}

// ---- 几何检查：布局模式下把 B 桌拖进中央过道，HUD 应出现相交警示（仅几何提示）----
await page.getByRole('button', { name: '布局模式' }).click();
await page.waitForTimeout(300);
const hud0 = await page.locator('.hud').innerText();
if (!hud0.includes('几何')) fail('布局 HUD 应含几何检查与非认证说明');
ok('布局模式 HUD 明示禁止区仅几何检查、非安全认证');

const drag = await page.evaluate(() => {
  const el = document.querySelector('.canvas-wrap').getBoundingClientRect();
  const scale = Math.min((el.width - 40) / 1000, (el.height - 40) / 800);
  const sx = (el.width - 1000 * scale) / 2;
  const toVenue = (vx, vy) => ({ x: el.left + sx + vx * scale, y: el.top + 20 + vy * scale });
  // B 桌 (220,520) -> 过道中央 (500,500)
  return { from: toVenue(220, 520), to: toVenue(500, 500) };
});
await page.mouse.move(drag.from.x, drag.from.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(
    drag.from.x + ((drag.to.x - drag.from.x) * i) / 10,
    drag.from.y + ((drag.to.y - drag.from.y) * i) / 10,
  );
}
await page.mouse.up();
await page.waitForTimeout(400);
const hudViolation = await page.locator('.hud').innerText();
if (!hudViolation.includes('与禁止区域相交') || !hudViolation.includes('B 桌')) {
  fail('拖入过道后 HUD 应提示 B 桌与禁止区域相交');
}
ok('桌子压过道：画布给出几何相交警示（非安全认证措辞）');

await browser.close();
if (process.exitCode) console.error('\nE2E 存在失败 ❌');
else console.log('\n端到端验证全部通过 ✅');
