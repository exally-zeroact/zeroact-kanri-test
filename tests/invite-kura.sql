-- tests/invite-kura.sql — 招待の関数を テスト倉庫（khaw）で 1つの取引の中で試す。
-- 最後に わざと raise exception で 結果を返す＝取引ごと巻き戻る（倉庫に何も残らない）。
-- 走らせ方: node scripts/kura-shiken.mjs tests/invite-kura.sql
do $$
declare
  v_admin uuid; v_admin_mail text;
  u1 uuid; m1 text; u2 uuid; m2 text; u3 uuid; m3 text; u4 uuid; m4 text;
  t jsonb; tok text; tok2 text; r jsonb; ok int := 0; ng int := 0; log text := '';
  now_s bigint := extract(epoch from now())::bigint;
  b boolean; n int;
begin
  select a.account_id, u.email into v_admin, v_admin_mail from exally.app_admins a join auth.users u on u.id = a.account_id limit 1;
  select id, email into u1, m1 from auth.users where email is not null and coalesce(is_anonymous,false)=false and nullif(phone,'') is null and id <> v_admin and id not in (select account_id from exally.app_admins) order by created_at limit 1 offset 0;
  select id, email into u2, m2 from auth.users where email is not null and coalesce(is_anonymous,false)=false and nullif(phone,'') is null and id <> v_admin and id not in (select account_id from exally.app_admins) order by created_at limit 1 offset 1;
  select id, email into u3, m3 from auth.users where email is not null and coalesce(is_anonymous,false)=false and nullif(phone,'') is null and id <> v_admin and id not in (select account_id from exally.app_admins) order by created_at limit 1 offset 2;
  select id, email into u4, m4 from auth.users where email is not null and coalesce(is_anonymous,false)=false and nullif(phone,'') is null and id <> v_admin and id not in (select account_id from exally.app_admins) order by created_at limit 1 offset 3;
  if u4 is null then raise exception 'KEKKA 試しの人が4人おらん'; end if;

  -- 呼ぶ人を切り替える小道具（jwt の形＝Supabase の amr [{method,timestamp}]）

  -- ① 管理者でない人は作れない
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  begin
    perform public.app_invite_create('kanri_shiken'); ng := ng + 1; log := log || ' ✗①作れた';
  exception when insufficient_privilege then ok := ok + 1; log := log || ' ✓①';
  end;

  -- ② 管理者は作れる（字は64桁・倉庫は hash だけ）
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'email',v_admin_mail,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',now_s)))::text, true);
  t := public.app_invite_create('kanri_shiken'); tok := t->>'token';
  if tok ~ '^[0-9a-f]{64}$' and not exists (select 1 from exally.app_invites where token_hash = tok) then ok := ok + 1; log := log || ' ✓②'; else ng := ng + 1; log := log || ' ✗②'; end if;
  tok2 := (public.app_invite_create('kanri_shiken'))->>'token';

  -- ③ パスワードで入った人は need_otp・招待は減らない
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'reason' = 'need_otp' and exists (select 1 from exally.app_invites where token_hash = encode(sha256(convert_to(tok,'UTF8')),'hex') and used_at is null) then ok := ok + 1; log := log || ' ✓③'; else ng := ng + 1; log := log || ' ✗③' || r::text; end if;

  -- ④ otp でも 2時間前は need_otp
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s - 7200)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'reason' = 'need_otp' then ok := ok + 1; log := log || ' ✓④'; else ng := ng + 1; log := log || ' ✗④' || r::text; end if;

  -- ⑤ email_change・recovery の amr は need_otp
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','email_change','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'reason' = 'need_otp' then ok := ok + 1; log := log || ' ✓⑤'; else ng := ng + 1; log := log || ' ✗⑤' || r::text; end if;

  -- ⑥ jwt の email が倉庫と違えば need_otp
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email','zz-' || m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'reason' = 'need_otp' then ok := ok + 1; log := log || ' ✓⑥'; else ng := ng + 1; log := log || ' ✗⑥' || r::text; end if;

  -- ⑦ 字の形が違う・無い字は bad
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  r := public.app_invite_claim('abc');
  b := r->>'reason' = 'bad';
  r := public.app_invite_claim(repeat('0', 64));
  if b and r->>'reason' = 'bad' then ok := ok + 1; log := log || ' ✓⑦'; else ng := ng + 1; log := log || ' ✗⑦' || r::text; end if;

  -- ⑧ otp で今入った本人は free になる（行が無い所から）
  r := public.app_invite_claim(tok);
  if r->>'ok' = 'true' and r->>'plan' = 'free'
     and exists (select 1 from public.exally_entitlements where account_id = u1 and app = 'kanri_shiken' and plan = 'free' and expires_at is null)
     and exists (select 1 from exally.app_invites where used_by = u1 and used_email = lower(m1) and used_at is not null)
  then ok := ok + 1; log := log || ' ✓⑧'; else ng := ng + 1; log := log || ' ✗⑧' || r::text; end if;

  -- ⑨ 読む式：otp＋同じアドレス＝true／パスワード＝false／別アドレス（アドレス変更の他人）＝false
  b := public.app_is_free('kanri_shiken');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',now_s)))::text, true);
  b := b and not public.app_is_free('kanri_shiken');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email','other-' || m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  b := b and not public.app_is_free('kanri_shiken');
  -- メールで入って2時間たったセッションでも無料のまま（読む式は時間を縛らない）
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s - 7200)))::text, true);
  b := b and public.app_is_free('kanri_shiken');
  if b then ok := ok + 1; log := log || ' ✓⑨'; else ng := ng + 1; log := log || ' ✗⑨'; end if;

  -- ⑨b 招待の無料を受けた人に後から電話が付く＝SMS の otp セッションでは無料にならない（電話を外せば戻る）
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u1,'email',m1,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  update auth.users set phone = '819000000000' where id = u1;
  b := not public.app_is_free('kanri_shiken');
  update auth.users set phone = null where id = u1;
  b := b and public.app_is_free('kanri_shiken');
  if b then ok := ok + 1; log := log || ' ✓⑨b'; else ng := ng + 1; log := log || ' ✗⑨b'; end if;

  -- ⑩ 2人目が同じ字＝used
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u2,'email',m2,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'reason' = 'used' and not exists (select 1 from public.exally_entitlements where account_id = u2 and app = 'kanri_shiken') then ok := ok + 1; log := log || ' ✓⑩'; else ng := ng + 1; log := log || ' ✗⑩' || r::text; end if;

  -- ⑪ 止めた人（disabled）は stopped・招待は減らない
  insert into public.exally_entitlements (account_id, app, plan) values (u2, 'kanri_shiken', 'disabled');
  r := public.app_invite_claim(tok2);
  if r->>'reason' = 'stopped' and exists (select 1 from public.exally_entitlements where account_id = u2 and app = 'kanri_shiken' and plan = 'disabled')
     and exists (select 1 from exally.app_invites where token_hash = encode(sha256(convert_to(tok2,'UTF8')),'hex') and used_at is null)
  then ok := ok + 1; log := log || ' ✓⑪'; else ng := ng + 1; log := log || ' ✗⑪' || r::text; end if;

  -- ⑫ 有料の人は下げない（already paid・招待は使い切る）
  insert into public.exally_entitlements (account_id, app, plan) values (u3, 'kanri_shiken', 'paid');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u3,'email',m3,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','magiclink','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok2);
  if r->>'already' = 'paid' and exists (select 1 from public.exally_entitlements where account_id = u3 and app = 'kanri_shiken' and plan = 'paid') then ok := ok + 1; log := log || ' ✓⑫'; else ng := ng + 1; log := log || ' ✗⑫' || r::text; end if;

  -- ⑬ お試し（期限つき）→ free・期限なし／⑭ 期限切れ・取り消しの字
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'email',v_admin_mail,'role','authenticated','amr','[]'::jsonb)::text, true);
  t := public.app_invite_create('kanri_shiken'); tok := t->>'token';
  insert into public.exally_entitlements (account_id, app, plan, expires_at) values (u4, 'kanri_shiken', 'trial', now() - interval '1 day');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u4,'email',m4,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'plan' = 'free' and exists (select 1 from public.exally_entitlements where account_id = u4 and app = 'kanri_shiken' and plan = 'free' and expires_at is null) then ok := ok + 1; log := log || ' ✓⑬'; else ng := ng + 1; log := log || ' ✗⑬' || r::text; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'email',v_admin_mail,'role','authenticated','amr','[]'::jsonb)::text, true);
  t := public.app_invite_create('kanri_shiken'); tok := t->>'token';
  update exally.app_invites set expires_at = now() - interval '1 second' where id = (t->>'id')::uuid;
  t := public.app_invite_create('kanri_shiken'); tok2 := t->>'token';
  b := public.app_invite_revoke((t->>'id')::uuid) and not public.app_invite_revoke((t->>'id')::uuid);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u2,'email',m2,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  if b and (public.app_invite_claim(tok))->>'reason' = 'expired' and (public.app_invite_claim(tok2))->>'reason' = 'revoked' then ok := ok + 1; log := log || ' ✓⑭'; else ng := ng + 1; log := log || ' ✗⑭'; end if;

  -- ⑮ 一覧：管理者でない人は弾く／管理者は auth.users のアドレス・招待の印
  begin
    perform * from public.app_admin_list(); ng := ng + 1; log := log || ' ✗⑮a';
  exception when insufficient_privilege then ok := ok + 1; log := log || ' ✓⑮a';
  end;
  update public.exally_entitlements set email = 'katari@example.invalid' where account_id = u3 and app = 'kanri_shiken';
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'email',v_admin_mail,'role','authenticated','amr','[]'::jsonb)::text, true);
  select count(*) into n from public.app_admin_list() l where l.app = 'kanri_shiken' and (
       (l.account_id = u1 and l.invited and l.email = m1)
    or (l.account_id = u3 and l.email = m3)
    or (l.account_id = u2 and not l.invited and l.plan = 'disabled'));
  if n = 3 then ok := ok + 1; log := log || ' ✓⑮b'; else ng := ng + 1; log := log || ' ✗⑮b n=' || n; end if;

  -- ⑯ 今在る（招待より前の）free 行は 読む式で パスワードでも free のまま
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u2,'email',m2,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',now_s)))::text, true);
  update public.exally_entitlements set plan = 'free' where account_id = u2 and app = 'kanri_shiken';
  if public.app_is_free('kanri_shiken') then ok := ok + 1; log := log || ' ✓⑯'; else ng := ng + 1; log := log || ' ✗⑯'; end if;

  -- ⑰ もう無料の人（⑬で free になった u4）が別の招待を使う＝already free・招待は減らない
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'email',v_admin_mail,'role','authenticated','amr','[]'::jsonb)::text, true);
  t := public.app_invite_create('kanri_shiken'); tok := t->>'token';
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u4,'email',m4,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',now_s)))::text, true);
  r := public.app_invite_claim(tok);
  if r->>'already' = 'free' and exists (select 1 from exally.app_invites where id = (t->>'id')::uuid and used_at is null) then ok := ok + 1; log := log || ' ✓⑰'; else ng := ng + 1; log := log || ' ✗⑰' || r::text; end if;

  raise exception 'KEKKA ok=% ng=% :%', ok, ng, log;
end $$;
