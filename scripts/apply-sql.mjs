// scripts/apply-sql.mjs — SQL をテスト倉庫（khaw）にだけ当てる。本番 tnfw はこの道具では当てない（司さんの一言の後に別の道で）。
// 使い方: node scripts/apply-sql.mjs <file.sql>   ／  node scripts/apply-sql.mjs --q "<sql>"（試しの取引・rollback で終わる物だけ）
import fs from 'node:fs';
const TEST_REF = 'khawdrnvssdenumbiwfg';
const ref = TEST_REF;
const tok = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.supabase-token', 'utf8')).token;
let q;
if (process.argv[2] === '--q') {
  q = process.argv[3];
  if (!/^\s*begin\b[\s\S]*\brollback\s*;?\s*$/i.test(q)) { console.error('試しは begin … rollback だけ'); process.exit(2); }
} else {
  q = fs.readFileSync(process.argv[2], 'utf8');
  if (/\b(drop\s+table|truncate|delete\s+from)\b/i.test(q)) { console.error('消す系が入っている＝当てない'); process.exit(2); }
}
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'kanri-apply' },
  body: JSON.stringify({ query: q }) });
const t = await r.text();
console.log('ref=' + ref, 'status=' + r.status); console.log(t);
process.exitCode = (r.status === 201 || r.status === 200) ? 0 : 1;
