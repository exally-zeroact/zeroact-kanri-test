// ★配信に乗せる物・乗せない物★（.vercelignore の見張り）
//  ① 画面に要る物（index.html・css/・js/・lib/）は1本も外さない
//  ② 門・試験・道具・覚書・SQL（docs/ supabase/ tests/ scripts/ .githooks/ .github/ CLAUDE.md）は全部外す
//  ③ git が追う物を1本ずつ当てて、どちらにも入らない物が在れば赤＝足した物の行き先を決め忘れない
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pats = readFileSync(path.join(root, '.vercelignore'), 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
const ignored = (f) => pats.some((p) => p.endsWith('/') ? (f.startsWith(p) || f.includes('/' + p)) : (f === p || f.endsWith('/' + p)));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const NOSERU = (f) => f === 'index.html' || /^(css|js|lib)\//.test(f);
const SOTO = ['package.json', 'package-lock.json', '.vercelignore']; // Vercel が読む物・配信では 404
let noseru = 0, hazusu = 0;
const mayoi = [];
for (const f of files) {
  if (NOSERU(f)) { assert.ok(!ignored(f), '画面に要る物を外している：' + f); noseru++; continue; }
  if (SOTO.includes(f)) continue;
  if (ignored(f)) hazusu++; else mayoi.push(f);
}
assert.deepEqual(mayoi, [], '配信に乗るか外すか決めていない物：' + mayoi.join(', '));
assert.ok(noseru >= 5, '乗せる物が少なすぎる（' + noseru + '本）');
for (const must of ['CLAUDE.md', 'supabase/', 'scripts/', 'tests/', 'docs/']) assert.ok(pats.includes(must), '外す一覧に ' + must + ' が無い');
console.log('haishin 緑（乗せる ' + noseru + '本・外す ' + hazusu + '本）');
