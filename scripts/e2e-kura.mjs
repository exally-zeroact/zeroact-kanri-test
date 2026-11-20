// scripts/e2e-kura.mjs — ★②実 UI の層★ 管理画面をテスト倉庫 khaw で本物の Playwright で押す（使い捨ての人2人を作り・finally で必ず消し・残り0を数える）
// 手元だけ（倉庫の鍵 ~/.supabase-token が要る＝CI では走らない）。khaw 以外を向く名札なら走らない。
// 使い方: node scripts/e2e-kura.mjs [chromium|webkit ...]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const require = createRequire(import.meta.url);
const pw = require('playwright');

const REF = 'khawdrnvssdenumbiwfg';             // ★テスト倉庫だけ★
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSERS = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit'];
const OUT = path.join(os.tmpdir(), 'kanri-e2e'); fs.mkdirSync(OUT, { recursive: true });
const cfg = fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8');
if (!cfg.includes(REF)) throw new Error('名札が khaw でない＝止める');
const URL_ = `https://${REF}.supabase.co`;
const tok = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.supabase-token', 'utf8')).token;
const MG = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'kanri-e2e' };

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: MG, body: JSON.stringify({ query: q }) });
  const t = await r.text(); if (r.status !== 201 && r.status !== 200) throw new Error('sql ' + r.status + ' ' + t); return JSON.parse(t);
}
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: MG })).json();
const svc = (keys.find(k => k.name === 'service_role') || keys.find(k => k.type === 'secret')).api_key;
const AH = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

const stamp = Date.now().toString(36);
const P = crypto.randomBytes(12).toString('base64url') + 'a1';
const made = [];
async function mkUser(tag) {
  const email = `kanri-e2e-${tag}-${stamp}@example.com`;
  const r = await fetch(URL_ + '/auth/v1/admin/users', { method: 'POST', headers: AH, body: JSON.stringify({ email, password: P, email_confirm: true }) });
  const j = await r.json(); if (!j.id) throw new Error('人を作れない ' + JSON.stringify(j));
  made.push(j.id); return { id: j.id, email };
}
const isUuid = s => /^[0-9a-f-]{36}$/.test(s);
async function cleanup() {
  const ids = made.filter(isUuid); if (!ids.length) return;
  const list = ids.map(i => `'${i}'`).join(',');
  await sql(`delete from exally.app_invites where created_by in (${list}) or used_by in (${list}); delete from exally.app_entitlements where account_id in (${list}); delete from exally.app_admins where account_id in (${list});`);
  for (const id of ids) { const r = await fetch(URL_ + '/auth/v1/admin/users/' + id, { method: 'DELETE', headers: AH }); console.log('人を消した', r.status); }
  const left = await sql(`select (select count(*) from auth.users where id in (${list})) u, (select count(*) from exally.app_invites where created_by in (${list})) i, (select count(*) from exally.app_entitlements where account_id in (${list})) e, (select count(*) from exally.app_admins where account_id in (${list})) a`);
  console.log('残り', JSON.stringify(left[0]));
}

// 小さな配信（作業木をそのまま出す）
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

let ok = 0, ng = 0;
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log('✓', name); } else { ng++; console.log('✗', name, extra); } };

try {
  const adm = await mkUser('adm'), non = await mkUser('non');
  await sql(`insert into exally.app_admins(account_id) values ('${adm.id}'); insert into exally.app_entitlements(account_id, app, plan, email) values ('${adm.id}','mahjong','trial','${adm.email}'), ('${non.id}','daiko','paid','${non.email}');`);

  for (const bn of BROWSERS) {
    console.log('── ' + bn);
    const b = await pw[bn].launch();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: bn === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
    const bads = []; page.on('response', r => { if (r.status() >= 400) bads.push(r.status() + ' ' + r.url().split('?')[0] + (r.url().includes('grant_type=password') ? '?pw' : '')); });
    await page.goto(BASE);
    await page.waitForSelector('#login:not(.hide)');
    check('入口はログイン', await page.isVisible('#email'));

    await page.fill('#email', adm.email); await page.fill('#pw', 'wrong-pass-1'); await page.click('#signin');
    await page.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0);
    check('違うパスワード＝字が出る', (await page.textContent('#loginErr')).includes('入れませんでした'));

    await page.fill('#email', non.email); await page.fill('#pw', P); await page.click('#signin');
    await page.waitForSelector('#denied:not(.hide)', { timeout: 15000 });
    check('管理者でない人＝断る画面', await page.isVisible('#denied') && !(await page.isVisible('#panel')));
    await page.click('#out1'); await page.waitForSelector('#login:not(.hide)');

    await page.fill('#email', adm.email); await page.fill('#pw', P); await page.click('#signin');
    await page.waitForSelector('#panel:not(.hide)', { timeout: 15000 });
    await page.waitForSelector('#list .row', { timeout: 15000 });
    const nAll = await page.locator('#list .row').count();
    const dbAll = (await sql('select count(*)::int n from public.exally_entitlements'))[0].n;
    check('全部の一覧＝倉庫の数', nAll === dbAll, `画面${nAll} 倉庫${dbAll}`);
    check('「全部」では招待の箱を出さない', !(await page.isVisible('#inviteBox')));
    await page.screenshot({ path: path.join(OUT, `kanri-${bn}-zenbu.png`), fullPage: true });

    await page.click('#apps button[data-app="mahjong"]');
    check('麻雀に切り替え＝押された印', (await page.getAttribute('#apps button[data-app="mahjong"]', 'aria-pressed')) === 'true');
    const nMj = await page.locator('#list .row').count();
    const dbMj = (await sql(`select count(*)::int n from public.exally_entitlements where app='mahjong'`))[0].n;
    check('麻雀の一覧＝倉庫の数', nMj === dbMj, `画面${nMj} 倉庫${dbMj}`);
    const trialCnt = await page.textContent('#counts');
    const dbTrial = (await sql(`select count(*)::int n from public.exally_entitlements where app='mahjong' and plan='trial'`))[0].n;
    check('お試しの数＝倉庫', trialCnt.includes('お試し' + dbTrial), trialCnt);

    await page.fill('#q', adm.email.slice(0, 22));
    check('アドレスで探す＝1行', (await page.locator('#list .row').count()) === 1);
    const row = page.locator('#list .row').first();
    await row.locator('button[data-plan="free"]').click();
    await page.waitForFunction(() => document.querySelector('#list .row button[data-plan="free"]')?.getAttribute('aria-pressed') === 'true');
    const p1 = (await sql(`select plan from exally.app_entitlements where account_id='${adm.id}' and app='mahjong'`))[0].plan;
    check('無料に切り替え＝倉庫も free', p1 === 'free', p1);
    check('自分の行に「自分」の印', (await row.locator('.tag').allTextContents()).includes('自分'));
    await row.locator('button[data-plan="disabled"]').click();
    await page.waitForFunction(() => /もう一度押すと変えます/.test(document.getElementById('toast').textContent));
    const t1 = await page.textContent('#toast');
    const p1b = (await sql(`select plan from exally.app_entitlements where account_id='${adm.id}' and app='mahjong'`))[0].plan;
    check('停止は1回目では変えない（倉庫も free のまま）', p1b === 'free' && (await row.locator('button[data-plan="disabled"]').getAttribute('aria-pressed')) === 'false', p1b);
    check('自分の行＝端末が業務を始められなくなると出す', t1.includes('自分の麻雀を停止にすると、その端末で業務を始められなくなります'), t1);
    await row.locator('button[data-plan="disabled"]').click();
    await page.waitForFunction(() => document.querySelector('#list .row button[data-plan="disabled"]')?.getAttribute('aria-pressed') === 'true');
    const p2 = (await sql(`select plan from exally.app_entitlements where account_id='${adm.id}' and app='mahjong'`))[0].plan;
    check('停止に切り替え＝倉庫も disabled', p2 === 'disabled', p2);
    await row.locator('button[data-plan="trial"]').click();
    await row.locator('button[data-plan="trial"]').click();
    await page.waitForFunction(() => document.querySelector('#list .row button[data-plan="trial"]')?.getAttribute('aria-pressed') === 'true');
    await page.fill('#q', '');

    check('麻雀は招待を作れる', await page.isEnabled('#mkInvite'));
    await page.click('#mkInvite');
    await page.waitForSelector('#inviteOut:not(.hide)');
    const iu = await page.textContent('#inviteUrl');
    check('招待URL＝麻雀の着く先＋#invite=', /^https:\/\/mahjong-dtm-test\.vercel\.app\/#invite=[A-Za-z0-9_-]{20,}$/.test(iu), iu.replace(/=.*/, '=…'));
    const tokRaw = iu.split('#invite=')[1];
    const inDb = await sql(`select count(*)::int n, count(*) filter (where token_hash like '%${tokRaw.slice(0, 8)}%')::int raw from exally.app_invites where created_by='${adm.id}' and app='mahjong' and used_at is null and revoked_at is null`);
    check('倉庫に1本・生の字は置かない', inDb[0].n === 1 && inDb[0].raw === 0, JSON.stringify(inDb[0]));
    await page.screenshot({ path: path.join(OUT, `kanri-${bn}-shoutai.png`), fullPage: true });
    if (bn === 'chromium') {
      await page.click('#copy'); await page.waitForTimeout(300);
      check('写す＝クリップボードに URL', (await page.evaluate(() => navigator.clipboard.readText())) === iu);
    }
    const rv = page.locator('#invites [data-revoke]').first();
    check('未使用の招待に「取り消す」', await rv.isVisible());
    await rv.click();
    await page.waitForFunction(() => /取り消し/.test(document.getElementById('invites').textContent) && !document.querySelector('#invites [data-revoke]'), null, { timeout: 15000 }).catch(() => {});
    const rvDb = (await sql(`select count(*) filter (where revoked_at is not null)::int r, count(*)::int n from exally.app_invites where created_by='${adm.id}'`))[0];
    check('取り消し＝倉庫も revoked', rvDb.r === rvDb.n && rvDb.n >= 1, JSON.stringify(rvDb));
    await sql(`delete from exally.app_invites where created_by='${adm.id}'`);

    await page.click('#apps button[data-app="suite"]');
    check('着く先の無いアプリ＝招待を押せない', !(await page.isEnabled('#mkInvite')) && (await page.textContent('#inviteNote')).includes('まだ招待の着く所'));

    // 押す所の高さ（字14px→36・16px→44）
    const hs = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent).map(b => ({ t: b.textContent.trim().slice(0, 8), h: Math.round(b.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(b).fontSize) })));
    const bad = hs.filter(x => !((x.fs <= 14 && x.h >= 36) || (x.fs >= 16 && x.h >= 44) || (x.fs > 14 && x.fs < 16 && x.h >= 36)));
    check('ボタンの高さが字に合う', bad.length === 0, JSON.stringify(bad.slice(0, 5)));
    console.log('ボタン', JSON.stringify(hs.reduce((m, x) => { const k = x.fs + 'px→' + x.h; m[k] = (m[k] || 0) + 1; return m; }, {})));

    await page.click('#out2'); await page.waitForSelector('#login:not(.hide)');
    check('出る＝ログインに戻る', true);
    check('画面の誤り0', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
    const want = [`400 ${URL_}/auth/v1/token?pw`];
    check('400以上は違うパスワードの1本だけ', JSON.stringify(bads) === JSON.stringify(want), JSON.stringify(bads));
    await b.close();
  }
} catch (e) { ng++; console.log('✗ 落ちた', e.message); }
finally { await cleanup().catch(e => { ng++; console.log('✗ 片付け失敗', e.message); }); srv.close(); }
console.log(`結果 ✓${ok} ✗${ng}`);
process.exitCode = ng ? 1 : 0;
