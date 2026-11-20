-- 001_app_invites.sql — 全アプリ共通の「招待 URL で無料」（管理アプリの席が当てる・各アプリは rpc を呼ぶだけ）
-- 置き場：表は exally 部屋・関数は public（rpc が届く部屋・is_exally_admin と同じ）。
-- 元表の名は倉庫でずれる（テスト=exally.app_entitlements／本番=exally.exally_entitlements）＝
--   書くのは両方で同じ名の窓 public.exally_entitlements 越し（is_insertable_into=YES を測った）。
-- 返しの形（全アプリ共通・これ以外を返さない）：
--   {ok:true,  app, plan:'free'}       … 無料を付けた（招待を使い切る）
--   {ok:true,  app, already:'paid'}    … もう有料＝下げない（招待を使い切る・画面は「もう有料です」）
--   {ok:true,  app, already:'free'}    … もう無料（期限なしか先）＝招待は減らさない
--   {ok:false, reason:'need_otp'}      … メールのリンク／番号で今入っていない（招待は減らさない）
--   {ok:false, reason:'stopped'}       … 司さんが止めた人（disabled）＝戻さない（招待は減らさない）
--   {ok:false, reason:'used'|'expired'|'revoked'|'bad'}

-- ★この表にはダイコメの trigger が付く（after insert・after update of used_by・app='daiko' だけ）★
--   daiko の招待が使われた時に、先取りした他人（友達のアドレスで先にパスワード登録した人）を締め出す。
--   この表を作り直す・trigger を落とす時は、先にダイコメの席へ知らせる（向こうが当て直す）。
--   本番 tnfw では、ダイコメの trigger が当たるまで daiko の招待を作らない（本番の名札 invite に daiko を書かない＝押せない）。
create table if not exists exally.app_invites (
  id          uuid primary key default gen_random_uuid(),
  app         text not null check (app ~ '^[a-z][a-z0-9_]{1,30}$'),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references auth.users(id) on delete set null,
  used_email  text,
  used_at     timestamptz,
  revoked_at  timestamptz
);
create index if not exists app_invites_used_by on exally.app_invites (used_by, app);
alter table exally.app_invites enable row level security;
drop policy if exists ai_admin_read on exally.app_invites;
create policy ai_admin_read on exally.app_invites for select using (public.is_exally_admin());
revoke all on exally.app_invites from anon, authenticated, public;
grant select on exally.app_invites to authenticated;

-- 許すログインのやり方＝本人のメールに届いた物でしか通れない道だけ（email_change・recovery は入れない）
--   p_within_sec：その入り方が何秒以内か（claim＝3600。読む式＝null＝縛らない＝メールで入ったセッションの間ずっと）
drop function if exists public.app_session_by_mail();
create or replace function public.app_session_by_mail(p_within_sec int default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
    where a->>'method' in ('otp','magiclink','email/signup','invite')
      and (p_within_sec is null
           or to_timestamp((a->>'timestamp')::numeric) > now() - make_interval(secs => p_within_sec))
  );
$$;

-- 招待を作る（管理者だけ・生の字は1回だけ返す・倉庫には sha256 だけ）
create or replace function public.app_invite_create(p_app text)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_raw text; v_id uuid; v_exp timestamptz;
begin
  if not public.is_exally_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into exally.app_invites (app, token_hash, created_by)
    values (p_app, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), auth.uid())
    returning id, expires_at into v_id, v_exp;
  return jsonb_build_object('id', v_id, 'token', v_raw, 'expires_at', v_exp);
end $$;

create or replace function public.app_invite_revoke(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare n int;
begin
  if not public.is_exally_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  update exally.app_invites set revoked_at = now() where id = p_id and used_at is null and revoked_at is null;
  get diagnostics n = row_count; return n = 1;
end $$;

-- 招待を受ける（本人のセッションで呼ぶ）
create or replace function public.app_invite_claim(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_uid uuid := auth.uid(); v_email text; v_anon boolean; v_phone text;
        v_hash text; v_inv exally.app_invites%rowtype; v_plan text; v_exp timestamptz;
begin
  if v_uid is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  select u.email, coalesce(u.is_anonymous, false), nullif(u.phone, '') into v_email, v_anon, v_phone
    from auth.users u where u.id = v_uid;
  if v_email is null or v_anon or v_phone is not null or not public.app_session_by_mail(3600)
     or lower(coalesce(auth.jwt()->>'email','')) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'reason', 'need_otp');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into v_inv from exally.app_invites where token_hash = v_hash for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if v_inv.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if v_inv.used_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if v_inv.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  select e.plan, e.expires_at into v_plan, v_exp from public.exally_entitlements e where e.account_id = v_uid and e.app = v_inv.app for update;
  if v_plan = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'stopped'); end if;
  -- もう無料（期限なしか先）＝招待を減らさない・行も変えない（招待より前の無料を招待の縛りに変えない）
  if v_plan = 'free' and (v_exp is null or v_exp > now()) then
    return jsonb_build_object('ok', true, 'app', v_inv.app, 'already', 'free');
  end if;

  update exally.app_invites set used_by = v_uid, used_email = lower(v_email), used_at = now() where id = v_inv.id;

  if v_plan = 'paid' then
    return jsonb_build_object('ok', true, 'app', v_inv.app, 'already', 'paid');
  elsif v_plan is null then
    insert into public.exally_entitlements (account_id, app, plan, email, expires_at, note, created_at, updated_at)
      values (v_uid, v_inv.app, 'free', lower(v_email), null, 'invite:' || v_inv.id, now(), now());
  else -- trial／期限切れの free → free・期限なし
    update public.exally_entitlements set plan = 'free', expires_at = null, email = lower(v_email),
           note = 'invite:' || v_inv.id, updated_at = now()
     where account_id = v_uid and app = v_inv.app;
  end if;
  return jsonb_build_object('ok', true, 'app', v_inv.app, 'plan', 'free');
end $$;

-- 読む側の式（招待で付いた無料だけに当てる・今在る free 行＝招待より前の物には当てない）：
--   無料 ＝ その app の行が plan 'free'（expires_at 空か先）
--         かつ （招待で付いた行なら）今のセッションがメールで入った物（時間は縛らない）で、jwt の email = used_email
--   訳：先に他人が友達のアドレスでパスワード登録していても、パスワードのセッションには効かない（共有 auth は autoconfirm）。
--       アドレスを変えた他人は jwt の email が used_email と違う＝効かない。
create or replace function public.app_is_free(p_app text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.exally_entitlements e
     where e.account_id = auth.uid() and e.app = p_app and e.plan = 'free'
       and (e.expires_at is null or e.expires_at > now())
       and (
         not exists (select 1 from exally.app_invites i where i.used_by = e.account_id and i.app = e.app)
         or (public.app_session_by_mail() and exists (
               select 1 from exally.app_invites i
                where i.used_by = e.account_id and i.app = e.app
                  and i.used_email = lower(coalesce(auth.jwt()->>'email',''))))
       )
  );
$$;

-- 管理画面の一覧（管理者だけ・アドレスは客の書いた字でなく auth.users から・招待から来たかは app_invites で）
create or replace function public.app_admin_list()
returns table (account_id uuid, app text, plan text, email text, expires_at timestamptz,
               created_at timestamptz, updated_at timestamptz, invited boolean, is_anonymous boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_exally_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  return query
    select e.account_id, e.app, e.plan, u.email::text, e.expires_at, e.created_at, e.updated_at,
           exists (select 1 from exally.app_invites i where i.used_by = e.account_id and i.app = e.app),
           coalesce(u.is_anonymous, false)
      from public.exally_entitlements e join auth.users u on u.id = e.account_id
     order by e.app, u.email;
end $$;

-- 招待の一覧（管理者だけ・生の字も hash も返さない）
create or replace function public.app_invite_list()
returns table (id uuid, app text, created_at timestamptz, expires_at timestamptz,
               used_email text, used_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_exally_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  return query select i.id, i.app, i.created_at, i.expires_at, i.used_email, i.used_at, i.revoked_at
    from exally.app_invites i order by i.created_at desc;
end $$;

revoke all on function public.app_session_by_mail(int) from public, anon;
revoke all on function public.app_invite_create(text) from public, anon;
revoke all on function public.app_invite_revoke(uuid) from public, anon;
revoke all on function public.app_invite_claim(text) from public, anon;
revoke all on function public.app_is_free(text) from public, anon;
revoke all on function public.app_admin_list() from public, anon;
grant execute on function public.app_session_by_mail(int) to authenticated;
grant execute on function public.app_invite_create(text) to authenticated;
grant execute on function public.app_invite_revoke(uuid) to authenticated;
grant execute on function public.app_invite_claim(text) to authenticated;
grant execute on function public.app_is_free(text) to authenticated;
grant execute on function public.app_admin_list() to authenticated;
revoke all on function public.app_invite_list() from public, anon;
grant execute on function public.app_invite_list() to authenticated;
