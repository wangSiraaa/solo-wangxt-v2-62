// 求解器烟测：用真实 glpk.js（Node）验证
//   1) 样例冲突关系 => 预检判无解
//   2) 解除冲突 => 可解，锁定不动，儿童椅占位被扣除，代价明细合理
//   3) pending 纳入开关 + 容量收紧 => 出现未排座松弛
// 运行：node scripts/solver-smoke.mjs（需先 `npm run solver:bundle`，
//       `npm run solver:test` 会自动串联）。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'node_modules/.tmp/solver-bundle.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/lib/smokeEntry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  external: ['glpk.js'],
  logLevel: 'silent',
});

const { runScenarios } = await import(outfile);
const require = createRequire(import.meta.url);
const glpkFactory = require(path.join(root, 'node_modules/glpk.js/dist/glpk.js'));
const glpk = glpkFactory();

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
};

const r = await runScenarios(glpk);

console.log('场景 1：冲突关系形成无解');
check('预检 feasible=false 且给出原因', () => {
  assert.strictEqual(r.conflict.diagnostics.feasible, false);
  assert.ok(r.conflict.diagnostics.reasons.length >= 1);
});
check('原因含"必须同桌/分桌"矛盾描述', () => {
  assert.ok(r.conflict.diagnostics.reasons.some((x) => x.includes('硬冲突')));
});

console.log('场景 2：解除冲突 => 可解');
check('无松弛未排座宾客', () => {
  assert.strictEqual(r.ok.unseated.length, 0);
});
check('锁定宾客留在原桌（张三在主桌、李四在 B 桌）', () => {
  const at = new Map(r.ok.assignment.map((a) => [a.guestId, a.tableId]));
  assert.strictEqual(at.get(r.ok.names.zhangSan), r.ok.tables.head);
  assert.strictEqual(at.get(r.ok.names.liSi), r.ok.tables.b);
});
check('家庭同行：张家全员同桌（张美美也在主桌）', () => {
  const at = new Map(r.ok.assignment.map((a) => [a.guestId, a.tableId]));
  const t = at.get(r.ok.names.zhangMu);
  assert.strictEqual(at.get(r.ok.names.zhangSanMei), t);
});
check('主桌儿童椅占位：主桌只再容纳 3 名非锁定客（8-5=3）', () => {
  const atHead = r.ok.assignment
    .filter((a) => a.tableId === r.ok.tables.head && !r.ok.locked.has(a.guestId));
  assert.ok(atHead.length <= 3, `实际 ${atHead.length}`);
});
check('总代价为有限非负数且明细齐全', () => {
  const c = r.ok.cost;
  for (const k of ['near', 'like', 'dislike', 'unseated', 'total']) assert.ok(Number.isFinite(c[k]));
  assert.strictEqual(c.unseated, 0);
  assert.ok(c.near >= 0);
});

console.log('场景 3：pending 未回复宾客默认不参与，开关后参与');
check('默认 active 宾客数不含 pending', () => {
  assert.ok(!r.ok.activeNames.includes(r.ok.names.zhaoFu));
  assert.ok(!r.ok.activeNames.includes(r.ok.names.sunQi));
});
check('纳入 pending 后活动人数 +2', () => {
  assert.strictEqual(r.pending.activeNames.length, r.ok.activeNames.length + 2);
});

console.log('场景 4：容量收紧到必然溢出 => 松弛变量报告未排座且代价计入');
check('有未排座宾客且 unseated 代价 > 0', () => {
  assert.ok(r.tight.unseated.length > 0);
  assert.ok(r.tight.cost.unseated > 0);
});

console.log('场景 5：软条件可放宽（希望同桌但只有两张单座桌）');
check('仍可解，无未排座', () => {
  assert.strictEqual(r.soft.unseated.length, 0);
  assert.strictEqual(r.soft.assignment.length, 2);
});
check('两人分到不同桌 => like 代价 = 20，总代价 = 20', () => {
  assert.strictEqual(r.soft.cost.like, 20);
  assert.strictEqual(r.soft.cost.total, 20);
});

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
