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
import os from 'node:os';
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

// ★運び先の名札を 字で 確かめる★（倉庫の名は 書かない＝namefuda ② の決まり。テスト線の名札と 突き合わせる）
//   env は prod・倉庫と鍵は テスト線と 別・招待の着く先は https で -test の配信を 向かない
export function readCfg(text) { const w = {}; new Function('window', text)(w); return w.SUPA || null; }
export function checkTarget(fromText, toText) {
  let F, T;
  try { F = readCfg(fromText); T = readCfg(toText); } catch (e) { return '名札が 読めない：' + e.message; }
  if (!T) return '運び先の名札に window.SUPA が 無い';
  if (T.env !== 'prod') return '運び先の名札が prod では ない（' + T.env + '）';
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(T.url || '')) return '運び先の名札の url の形が 違う';
  if (!F || T.url === F.url) return '運び先の名札が テスト線と 同じ倉庫を 向いている';
  if (!/^sb_publishable_/.test(T.key || '') || T.key === F.key) return '運び先の名札の鍵が 公開用でないか テスト線と 同じ';
  for (const [app, u] of Object.entries(T.invite || {})) {
    if (!/^https:\/\//.test(u)) return '招待の着く先が https でない：' + app;
    if (/-test[.-]/.test(new URL(u).hostname)) return '本番の招待が テストの配信を 向く：' + app + ' → ' + u;
  }
  return null;
}
// ★運び先の作業木の門★（本番で commit する時に 門と noreply が 効いているか）
export function checkGate(dir) {
  const g = (k) => { try { return execFileSync('git', ['config', '--get', k], { cwd: dir, encoding: 'utf8' }).trim(); } catch { return ''; } };
  if (g('core.hooksPath') !== '.githooks') return '運び先に core.hooksPath .githooks が 無い';
  if (!/noreply\.github\.com$/.test(g('user.email'))) return '運び先の user.email が noreply でない';
  return null;
}
function selfGate() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobu-gate-'));
  try {
    execFileSync('git', ['init', '-q', d]);
    const before = checkGate(d);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: d });
    execFileSync('git', ['config', 'user.email', 'someone@example.com'], { cwd: d });
    const half = checkGate(d);
    execFileSync('git', ['config', 'user.email', 'x@users.noreply.github.com'], { cwd: d });
    return [
      ['門の無い入れ物へは 運ばない', !!before],
      ['門だけで noreply の無い入れ物へは 運ばない', !!half],
      ['門と noreply の在る入れ物へは 運ぶ', checkGate(d) === null],
    ];
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
function selfCfg() {
  const u = (c) => "'https://' + '" + c.repeat(20) + "' + '.supabase' + '.co'";
  const cfg = (env, c, key, inv) => 'window.SUPA = { url: ' + u(c) + ", key: '" + key + "', env: '" + env + "', invite: " + JSON.stringify(inv) + ' };';
  const F = cfg('test', 'a', 'sb_publishable_A', { m: 'https://x-test.vercel.app/' });
  const P = (c, k, inv) => cfg('prod', c, k, inv);
  return [
    ['本番の名札（別の倉庫・prod・本番の着く先）は 通す', checkTarget(F, P('b', 'sb_publishable_B', { m: 'https://x.vercel.app/' })) === null],
    ['招待なし（invite:{}）の本番の名札は 通す', checkTarget(F, P('b', 'sb_publishable_B', {})) === null],
    ['env が test の名札は 止める', !!checkTarget(F, cfg('test', 'b', 'sb_publishable_B', {}))],
    ['prod の字でも テスト線と 同じ倉庫なら 止める', !!checkTarget(F, P('a', 'sb_publishable_B', {}))],
    ['テスト線と 同じ鍵なら 止める', !!checkTarget(F, P('b', 'sb_publishable_A', {}))],
    ['本番の招待が -test の配信を 向けば 止める', !!checkTarget(F, P('b', 'sb_publishable_B', { m: 'https://x-test.vercel.app/' }))],
    ['本番の招待が http なら 止める', !!checkTarget(F, P('b', 'sb_publishable_B', { m: 'http://x.vercel.app/' }))],
    ...selfGate(),
  ];
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const list = fileList(ROOT);
  const checks = [
    ['名札（js/supa-config.js）を 運ぶ一覧に 入れていない', !list.includes('js/supa-config.js')],
    ['git が 見ていない物（node_modules）を 運ばない', !list.some((f) => f.startsWith('node_modules/'))],
    ['運ぶ物が 在る（0本を 緑にしない）', list.length > 10],
    ...selfCfg(),
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
const why = checkTarget(fs.readFileSync(path.join(ROOT, 'js', 'supa-config.js'), 'utf8'), fs.readFileSync(cfgTo, 'utf8')) || checkGate(TO);
if (why) { console.error('★' + why + '★＝運びません'); process.exit(1); }
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
