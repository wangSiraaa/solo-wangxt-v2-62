// 禁止占用多边形几何检查的单元测试（纯函数，无 glpk/浏览器依赖）
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'node_modules/.tmp/geometry-bundle.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/lib/geometrySmoke.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const geo = await import(outfile);
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

console.log('几何：点在多边形内（射线法）');
check('矩形内点判定', () => {
  const rect = geo.rectPoly(0, 0, 100, 100);
  assert.strictEqual(geo.pointInPoly({ x: 50, y: 50 }, rect), true);
  assert.strictEqual(geo.pointInPoly({ x: 150, y: 50 }, rect), false);
  assert.strictEqual(geo.pointInPoly({ x: 50, y: 150 }, rect), false);
});
check('凹形过道多边形', () => {
  const aisle = [[0, 0], [60, 0], [60, 40], [100, 40], [100, 100], [0, 100]];
  assert.strictEqual(geo.pointIn({ x: 30, y: 80 }, aisle), true);
  assert.strictEqual(geo.pointIn({ x: 80, y: 20 }, aisle), false);
});

console.log('几何：桌子占地 vs 禁止区');
check('圆桌压在过道上 => 报违规', () => {
  const r = geo.roundTableViolates({ x: 30, y: 50, radius: 40 }, geo.rectZone(0, 0, 60, 100));
  assert.strictEqual(r, true);
});
check('圆桌远离过道 => 无违规', () => {
  const r = geo.roundTableViolates({ x: 300, y: 300, radius: 40 }, geo.rectZone(0, 0, 60, 100));
  assert.strictEqual(r, false);
});
check('长桌与出口缓冲区部分重叠 => 报违规', () => {
  const r = geo.rectTableViolates({ x: 150, y: 50, halfW: 80, halfH: 30 }, geo.rectZone(100, 0, 200, 100));
  assert.strictEqual(r, true);
});
check('椅子余量参与判定：桌身不压但椅子圈压区 => 报违规', () => {
  // 桌缘距区域 20px，但椅子余量 28 => 违规
  const r = geo.roundTableViolates({ x: 68, y: 50, radius: 20 }, geo.rectZone(0, 0, 60, 100), 28);
  assert.strictEqual(r, true);
});

console.log('几何：样例工程的桌位均不压禁止区');
check('样例 5 桌与过道/消防出口无相交', () => {
  const v = geo.sampleViolations();
  assert.deepStrictEqual(v, [], '违规桌：' + JSON.stringify(v));
});

console.log(failures === 0 ? '\n几何测试全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
