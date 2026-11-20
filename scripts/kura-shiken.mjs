// scripts/kura-shiken.mjs — tests/*.sql（最後に raise exception 'KEKKA …' で巻き戻る試し）をテスト倉庫 khaw だけで走らせて数える。
import fs from 'node:fs';
const REF = 'khawdrnvssdenumbiwfg';
const file = process.argv[2]; const want = Number(process.argv[3] || 0);
const q = fs.readFileSync(file, 'utf8');
if (!/raise exception 'KEKKA/.test(q)) { console.error('KEKKA で巻き戻らない試しは走らせない'); process.exitCode = 2; }
else {
  const tok = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.supabase-token', 'utf8')).token;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'kanri-shiken' }, body: JSON.stringify({ query: q }) });
  const t = await r.text();
  const m = t.match(/KEKKA ok=(\d+) ng=(\d+) :([^"\\]*)/);
  if (!m) { console.log('KEKKA が無い（試しが途中で落ちた）:', t.slice(0, 800)); process.exitCode = 1; }
  else {
    const ok = +m[1], ng = +m[2];
    console.log(`ref=${REF} ok=${ok} ng=${ng} 期待=${want}`); console.log(m[3].trim());
    process.exitCode = (ng === 0 && (!want || ok === want)) ? 0 : 1;
  }
}
