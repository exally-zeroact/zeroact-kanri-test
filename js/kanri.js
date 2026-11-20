/* kanri.js — 全アプリ共通の管理（司さんだけ）
 * ・パスワードで入る → exally_admins に自分の行が在る人だけ先へ
 * ・上でアプリを切り替え → 人ごとの plan（無料・有料・お試し・停止）を一覧で見て切り替える
 * ・招待URLを作る（1人に1本・1回だけ・7日）→ 送る／写す
 * 倉庫の向き先は js/supa-config.js（名札）だけが持つ。
 * 一覧のアドレスは客の書いた字でなく auth.users から（rpc app_admin_list）。招待の印は app_invites から。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CFG = window.SUPA || {};
  var sb = window.supabase.createClient(CFG.url, CFG.key);

  // 表の app の名 → 画面の名（無い名は字のまま出す）
  var LABEL = { mahjong: '麻雀', daiko: 'ダイコメ', payslip: '給料明細', suite: 'Rakunally', nomiya: 'Castally', invoice: '請求書' };
  var PLANS = [['free', '無料'], ['paid', '有料'], ['trial', 'お試し'], ['disabled', '停止']];
  var PAGE = 500;

  var rows = [], invites = [], cur = '', me = '';
  // お試し・停止へ下げるのは2回押し（5秒）＝持ち主の行を1回で止めるとその端末が業務を始められなくなる（ダイコメ 11-20 の注）
  var DOWN = { trial: 1, disabled: 1 }, ARM_MS = 5000, arm = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function label(app) { return LABEL[app] || app; }
  function ymd(t) { if (!t) return ''; var d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  var toastT = null;
  function toast(m, ms) { var t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2000); }
  function show(id) { ['login', 'denied', 'panel'].forEach(function (x) { $(x).classList.toggle('hide', x !== id); }); }

  // 倉庫を読み切る：件数（count exact）に届くまで送る。1ページの長さで終わりを決めない。
  async function readAll(mk) {
    var got = [], total = null;
    for (var from = 0; ; from += PAGE) {
      var r = await mk(from, from + PAGE - 1);
      if (r.error) throw r.error;
      if (total === null) total = r.count;
      got = got.concat(r.data || []);
      if (total === null || total === undefined) throw new Error('件数が読めない');
      if (got.length >= total) break;
      if (!r.data || r.data.length === 0) throw new Error('途中で読めなくなった（' + got.length + '/' + total + '）');
    }
    return got;
  }

  // ── 入る ──
  $('signin').onclick = async function () {
    $('loginErr').textContent = '';
    var r = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
    if (r.error) { $('loginErr').textContent = '入れませんでした。アドレスとパスワードを確かめてください。'; return; }
    start();
  };
  async function out() { await sb.auth.signOut(); show('login'); }
  $('out1').onclick = out; $('out2').onclick = out;

  async function start() {
    var u = (await sb.auth.getUser()).data.user;
    if (!u) { show('login'); return; }
    me = u.id;
    var a = await sb.from('exally_admins').select('account_id').eq('account_id', u.id).maybeSingle();
    if (a.error || !a.data) { show('denied'); return; }
    show('panel');
    await load();
  }

  async function load() {
    try {
      rows = await readAll(function (a, b) { return sb.rpc('app_admin_list', {}, { count: 'exact' }).range(a, b); });
      invites = await readAll(function (a, b) { return sb.rpc('app_invite_list', {}, { count: 'exact' }).range(a, b); });
    } catch (e) { toast('読めませんでした：' + (e.message || e)); return; }
    drawApps(); draw();
  }

  function appsInUse() {
    var set = {};
    Object.keys(LABEL).forEach(function (k) { set[k] = 1; });
    Object.keys(CFG.invite || {}).forEach(function (k) { set[k] = 1; });
    rows.forEach(function (r) { set[r.app] = 1; });
    return Object.keys(set);
  }

  function drawApps() {
    var list = [''].concat(appsInUse());
    $('apps').innerHTML = list.map(function (k) {
      return '<button type="button" data-app="' + esc(k) + '" aria-pressed="' + (k === cur) + '">' + esc(k ? label(k) : '全部') + '</button>';
    }).join('');
    Array.prototype.forEach.call($('apps').querySelectorAll('button'), function (b) {
      b.onclick = function () { cur = b.getAttribute('data-app'); drawApps(); draw(); };
    });
  }

  function draw() {
    var mine = rows.filter(function (r) { return !cur || r.app === cur; });
    // 数
    $('counts').innerHTML = PLANS.map(function (p) {
      var n = mine.filter(function (r) { return r.plan === p[0]; }).length;
      return '<div>' + p[1] + '<b>' + n + '</b></div>';
    }).join('');
    // 招待
    var base = cur && CFG.invite && CFG.invite[cur];
    $('inviteBox').classList.toggle('hide', !cur);
    $('mkInvite').disabled = !base;
    $('inviteNote').textContent = !cur ? '' : (base ? label(cur) + ' に1人だけ無料で入れるURLを作ります（7日・1回だけ）。' : label(cur) + ' はまだ招待の着く所がありません。');
    $('inviteOut').classList.add('hide');
    var inv = invites.filter(function (i) { return i.app === cur; });
    $('invites').innerHTML = inv.map(function (i) {
      var st = i.used_at ? ('使った：' + esc(i.used_email || '')) : i.revoked_at ? '取り消し' : (new Date(i.expires_at) <= new Date() ? '切れた' : '未使用（' + ymd(i.expires_at) + 'まで）');
      var btn = (!i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date()) ? '<button class="btn-sub" type="button" data-revoke="' + esc(i.id) + '">取り消す</button>' : '';
      return '<div class="inv"><span>' + ymd(i.created_at) + ' ' + st + '</span>' + btn + '</div>';
    }).join('');
    Array.prototype.forEach.call($('invites').querySelectorAll('[data-revoke]'), function (b) {
      b.onclick = async function () {
        b.disabled = true;
        var r = await sb.rpc('app_invite_revoke', { p_id: b.getAttribute('data-revoke') });
        if (r.error || r.data !== true) { toast('取り消せませんでした'); b.disabled = false; return; }
        toast('取り消しました'); load();
      };
    });
    // 人
    var q = $('q').value.trim().toLowerCase();
    var shown = mine.filter(function (r) { return !q || String(r.email || '').toLowerCase().indexOf(q) >= 0; });
    $('list').innerHTML = shown.length ? shown.map(function (r) {
      var seg = PLANS.map(function (p) {
        return '<button type="button" data-plan="' + p[0] + '" aria-pressed="' + (r.plan === p[0]) + '" data-id="' + esc(r.account_id) + '" data-app="' + esc(r.app) + '">' + p[1] + '</button>';
      }).join('');
      return '<div class="row"><div class="who">' + esc(r.email || '（アドレス無し）') + (r.account_id === me ? '<span class="tag">自分</span>' : '') + (r.invited ? '<span class="tag">招待</span>' : '') + (r.is_anonymous ? '<span class="tag">匿名</span>' : '') + '</div>'
        + '<div class="sub">' + esc(label(r.app)) + '・' + ymd(r.created_at) + 'から' + (r.expires_at ? '・' + ymd(r.expires_at) + 'まで' : '') + '</div>'
        + '<div class="seg">' + seg + '</div></div>';
    }).join('') : '<p class="sub">まだ誰もいません。</p>';
    Array.prototype.forEach.call($('list').querySelectorAll('.seg button'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id'), app = b.getAttribute('data-app'), plan = b.getAttribute('data-plan');
        var now = rows.filter(function (x) { return x.account_id === id && x.app === app; })[0];
        if (now && now.plan === plan) return;
        if (DOWN[plan]) {
          var key = id + '|' + app + '|' + plan;
          if (!arm || arm.key !== key || Date.now() - arm.t > ARM_MS) {
            arm = { key: key, t: Date.now() };
            Array.prototype.forEach.call($('list').querySelectorAll('.arm'), function (x) { x.classList.remove('arm'); });
            b.classList.add('arm');
            var pn = PLANS.filter(function (p) { return p[0] === plan; })[0][1];
            toast((id === me ? '自分の' + label(app) + 'を' + pn + 'にすると、その端末で業務を始められなくなります。' : label(app) + 'を' + pn + 'にします。') + 'もう一度押すと変えます', ARM_MS);
            return;
          }
          arm = null;
        }
        setPlan(id, app, plan, b);
      };
    });
  }
  $('q').oninput = draw;

  async function setPlan(id, app, plan, btn) {
    btn.disabled = true;
    var r = await sb.from('exally_entitlements').update({ plan: plan, updated_at: new Date().toISOString() })
      .eq('account_id', id).eq('app', app).select('account_id');
    // 0行の update は「変えた」と言わない
    if (r.error || !r.data || r.data.length !== 1) { toast('変えられませんでした'); btn.disabled = false; return; }
    rows.forEach(function (x) { if (x.account_id === id && x.app === app) x.plan = plan; });
    toast(label(app) + 'を' + PLANS.filter(function (p) { return p[0] === plan; })[0][1] + 'にしました');
    draw();
  }

  // ── 招待 ──
  var lastUrl = '';
  $('mkInvite').onclick = async function () {
    var base = CFG.invite && CFG.invite[cur];
    if (!base) return;
    $('mkInvite').disabled = true;
    var r = await sb.rpc('app_invite_create', { p_app: cur });
    $('mkInvite').disabled = false;
    if (r.error || !r.data || !r.data.token) { toast('作れませんでした'); return; }
    lastUrl = base + '#invite=' + r.data.token;
    $('inviteUrl').textContent = lastUrl;
    $('inviteOut').classList.remove('hide');
    invites.unshift({ id: r.data.id, app: cur, created_at: new Date().toISOString(), expires_at: r.data.expires_at });
    var keep = lastUrl; draw(); lastUrl = keep;
    $('inviteUrl').textContent = lastUrl; $('inviteOut').classList.remove('hide');
  };
  $('share').onclick = async function () {
    if (!lastUrl) return;
    if (navigator.share) { try { await navigator.share({ text: label(cur) + 'の招待です', url: lastUrl }); } catch (e) { /* 閉じただけ */ } }
    else { $('copy').onclick(); }
  };
  $('copy').onclick = async function () {
    if (!lastUrl) return;
    try { await navigator.clipboard.writeText(lastUrl); toast('写しました'); } catch (e) { toast('写せませんでした'); }
  };

  sb.auth.getSession().then(function (s) { if (s.data.session) start(); else show('login'); });
})();
