// ★名札（js/supa-config.js）の 見張り★（Zeimally の namefuda を写し、①' と ② の例外を足した）
//  ① 帯は test の時だけ（prod・名札なし・知らない値 は 出さない）
//  ①' 名札の 線 と 倉庫が 合っているか（test＝khaw／prod＝tnfw）＝片方だけ入れ替わる形（帯も出ず画面で気づけない）を止める
//  ② 倉庫の 名前（ref）を 持つのは 名札だけ。例外＝下の KHAW_PIN（テスト倉庫に釘付けした手元の道具＝khaw しか持ってはいけない）とこのファイル
//  ⑤ 招待の着く先＝https・test は -test の配信・prod は -test 以外（本番の客がテストへ飛ぶのを止める）
//  ③ 名札の 線 と この repo の 線（git の origin の名前）が 合っているか
//     ★フォルダ名では 決めない★。origin が まだ無い時は ★未測定（exit 3）★＝緑と 呼ばない
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ★この試験だけが 両方の ref を持つ★（突き合わせる相手が無いと何も言えない）
const REFS = { test: 'khawdrnvssdenumbiwfg', prod: 'tnfwipbgfgjaymlszeid' };
const SELF = 'tests/namefuda.test.mjs';
const KHAW_PIN = ['scripts/apply-sql.mjs', 'scripts/kura-shiken.mjs', 'scripts/e2e-kura.mjs'];

// ① 帯の 決め方
const { shouldShow } = require('../js/env-badge.js');
assert.equal(shouldShow({ env: 'test' }), true);
for (const x of [{ env: 'prod' }, {}, null, undefined, { env: 'staging' }, { env: 'TEST' }]) assert.equal(!!shouldShow(x), false, JSON.stringify(x));

// 名札を 読む
const w = {}; new Function('window', readFileSync(path.join(root, 'js/supa-config.js'), 'utf8'))(w);
const S = w.SUPA;
assert.ok(S && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(S.url), '名札の url の形');
assert.ok(S.env === 'test' || S.env === 'prod', '名札の env は test か prod');
assert.ok(/^sb_publishable_/.test(S.key), '名札の鍵は 公開用(publishable)だけ（secret を 画面に 置かない）');
const ref = S.url.slice(8, 28);
// ①'
assert.equal(ref, REFS[S.env], '名札 ' + S.env + ' なのに倉庫が ' + ref);
// ⑤ 招待の着く先は https・本番の名札なら -test の配信を 向かない（テスト線は -test を向く）
for (const [app, u] of Object.entries(S.invite || {})) {
  assert.ok(/^https:\/\//.test(u), '招待の着く先が https でない：' + app);
  const isTest = /-test[.-]/.test(new URL(u).hostname);
  assert.equal(isTest, S.env === 'test', '名札 ' + S.env + ' なのに 招待 ' + app + ' の着く先が ' + u);
}

// ② ref の 字は 名札にしか 無い（例外の道具は khaw だけ・本番の ref を持たない）
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const naka = [];
let pinSeen = 0;
for (const f of files) {
  if (f === 'js/supa-config.js' || f === SELF || f.startsWith('lib/') || /\.(png|jpg|ico)$/.test(f) || f === 'package-lock.json') continue;
  let t; try { t = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  if (KHAW_PIN.includes(f)) {
    pinSeen++;
    assert.ok(t.includes(REFS.test), f + ' はテスト倉庫に釘付けのはず');
    assert.ok(!t.includes(REFS.prod), f + ' に本番の倉庫の名がある');
    continue;
  }
  if (/\b[a-z0-9]{20}\.supabase\.co\b/.test(t) || t.includes(REFS.test) || t.includes(REFS.prod)) naka.push(f);
}
assert.deepEqual(naka, [], '倉庫の名前が 名札の外に 書いてある：' + naka.join(', '));
assert.equal(pinSeen, KHAW_PIN.length, '釘付けの道具が揃っていない（名を変えたら KHAW_PIN も直す）');

// ③ 名札の線 と repo の線
let origin = '';
try { origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
if (!origin) { console.log('namefuda ①①\'② 緑／③ ★未測定★（origin が まだ無い＝線を 決める 証拠が 無い）'); process.exit(3); }
const repo = origin.replace(/\.git$/, '').split('/').pop();
const want = /-test$/.test(repo) ? 'test' : 'prod';
assert.equal(S.env, want, 'origin ' + repo + ' なのに 名札が ' + S.env);
console.log('namefuda 緑（' + repo + ' ＝ ' + S.env + '）');
