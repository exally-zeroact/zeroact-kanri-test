// 試験を 全部 走らせる。★1本ずつ 受け止める★（1本の失敗で 後ろを 止めない・社内の決まり）
// ★0本は 緑にしない★＝見つけた本数を 必ず出し、0本なら 赤。
// ★exit 3＝未測定★（測る証拠が まだ無い）＝緑とも 赤とも 別に 数える。1本でも 在れば 全体は 緑と 言わない
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// ★走らせる一覧は字で書く★（scripts/tests-registered.mjs が読めるように）。置き場と一覧が食い違えば赤＝足し忘れを止める
const files = ['hakobu.test.mjs', 'kinshi-ji.test.mjs', 'namefuda.test.mjs'];
const oki = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
if (JSON.stringify(oki) !== JSON.stringify([...files].sort())) { console.log('★一覧と置き場が食い違う★ 置き場=' + oki.join(',') + ' 一覧=' + files.join(',')); process.exit(1); }
let bad = 0, mi = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { encoding: 'utf8' });
  const ok = r.status === 0, mite = r.status === 3;
  if (mite) mi++; else if (!ok) bad++;
  process.stdout.write(`${ok ? '緑' : mite ? '未測定' : '赤'} ${f}\n`);
  if (!ok) process.stdout.write((r.stdout || '') + (r.stderr || '') + '\n');
}
console.log(`\n試験 ${files.length}本 ／ 赤 ${bad}本 ／ 未測定 ${mi}本`);
if (files.length === 0) { console.log('★試験が 0本＝緑にしない★'); process.exit(1); }
process.exit(bad ? 1 : mi ? 3 : 0);
