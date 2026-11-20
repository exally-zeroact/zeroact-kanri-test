/* hakobu.mjs ── ★テスト線(zeroact-kanri-test)の 中身を 本番(zeroact-kanri)の 入れ物へ 運ぶ★
 * 形は Rakunally の ship-all.mjs と 同じ決まり:
 *   ① ★js/supa-config.js（名札）は 絶対に 運ばない★＝本番の画面が テストの倉庫を 向く 事故を 構造で 止める
 *   ② ★git が 見ている物だけ★（node_modules・作りかけを 持ち込まない）＝テスト線に 未commit が 在れば 運ばない
 *   ③ ★運ぶ前と後で 数える★（新しく入る・変わる・同じ）
 *   ④ ★消さない★（本番にしか無い物は 残す）
 *   ⑤ ★運ぶだけ★。本番での commit・push は 人（か 押す係）が 中身を見てから
 *
 *   node scripts/hakobu.mjs --to <本番の入れ物> [--dry]
 *   node scripts/hakobu.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NEVER_SHIP = ['js/supa-config.js'];

export function fileList(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n').map((x) => x.trim()).filter(Boolean).filter((f) => !NEVER_SHIP.includes(f));
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const list = fileList(ROOT);
  const checks = [
    ['名札（js/supa-config.js）を 運ぶ一覧に 入れていない', !list.includes('js/supa-config.js')],
    ['git が 見ていない物（node_modules）を 運ばない', !list.some((f) => f.startsWith('node_modules/'))],
    ['運ぶ物が 在る（0本を 緑にしない）', list.length > 10],
  ];
  let bad = 0;
  for (const [n, ok] of checks) { console.log((ok ? '緑 ' : '赤 ') + n); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
}

const i = args.indexOf('--to');
const TO = i >= 0 ? path.resolve(args[i + 1] || '') : null;
const dry = args.includes('--dry');
if (!TO || !fs.existsSync(path.join(TO, '.git'))) { console.error('運び先（本番の git の入れ物）を --to で 渡してください'); process.exit(2); }
if (path.resolve(TO) === path.resolve(ROOT)) { console.error('運び元と 運び先が 同じです'); process.exit(2); }

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (dirty) { console.error('★テスト線に 未commit が あります★＝運びません（作りかけを 本番へ 持ち込まない）\n' + dirty); process.exit(1); }

const cfgTo = path.join(TO, 'js', 'supa-config.js');
if (!fs.existsSync(cfgTo)) { console.error('★本番の 名札（js/supa-config.js）が 在りません★＝先に 本番の名札を 置いてから'); process.exit(1); }
if (!/env:\s*'prod'/.test(fs.readFileSync(cfgTo, 'utf8'))) { console.error('★運び先の 名札が prod では ありません★＝運びません'); process.exit(1); }
const cfgBefore = sha(cfgTo);

let shin = 0, kawaru = 0, onaji = 0;
for (const f of fileList(ROOT)) {
  const from = path.join(ROOT, f), to = path.join(TO, f);
  const exists = fs.existsSync(to);
  if (exists && sha(from) === sha(to)) { onaji++; continue; }
  exists ? kawaru++ : shin++;
  if (!dry) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}
const cfgAfter = sha(cfgTo);
console.log((dry ? '【数えただけ】' : '【運んだ】') + ' 新しく入る ' + shin + '本 ／ 変わる ' + kawaru + '本 ／ 同じ ' + onaji + '本');
console.log('本番の名札 js/supa-config.js ＝ ' + (cfgBefore === cfgAfter ? '1文字も 変わっていない' : '★変わった★'));
if (cfgBefore !== cfgAfter) process.exit(1);
