# 管理アプリ 設計 v1（11-20・設計前 taiketsu に出す）

## 頼み
司さん直「全アプリを切り替えて一覧で見れるような（無料や有料など）アプリ作っとけ」＋「URL送ってそこで新規登録させて管理する」「おれがやることを増やすな」。
司さんの手＝①アプリを選ぶ ②「招待URLを作る」1押し→共有（LINE 等）③一覧で plan を切り替える。アドレスを打つ手は無い。

## 測った今（読むだけ・khaw と tnfw）
- public.exally_entitlements / public.exally_admins は窓（security_invoker）。元表名がずれ：khaw=exally.app_entitlements/app_admins、tnfw=exally.exally_entitlements/exally_admins。
- 列：account_id・app・plan・email・expires_at・note・created_at・updated_at。PK (account_id, app)。FK auth.users cascade。plan/app に check 無し。
- 決まり：ee_read_own／ee_admin_read／ee_admin_update（is_exally_admin()）／ee_insert_own_trial（誰でも自分の trial をどの app にも足せる）。delete 無し。
- tnfw の今：payslip free2 trial1・suite free1 trial3・nomiya trial3（計10行）。mahjong・daikome は0行。
- 今の管理画面：rakually kyuyo/admin.html＋js/admin.js（窓を select・plan を update・法定データの配信）。これは Rakunally の持ち物として残す（法定配信はそちらの仕事）。

## 名前・置き場
- repo：exally-zeroact/zeroact-kanri-test（テスト線）・zeroact-kanri（本番）。公開。vercel も同名（両方 DEPLOYMENT_NOT_FOUND を測った・kanri.vercel.app は他人が使用中）。
- 社内の道具なので商標は取らない。画面の名は「管理」。他アプリの名・色を借りない。

## 表（全アプリ共通・exally 部屋・両倉庫で同じ名）
### exally.app_invites（新）
| 列 | 型 | 意味 |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| app | text not null check (app ~ '^[a-z][a-z0-9_]{1,30}$') | 'mahjong' / 'daikome' 等 |
| token_hash | text not null unique | sha256(生の字) の hex。生の字は持たない |
| made_by | uuid not null references auth.users | 作った管理者 |
| created_at | timestamptz default now() | |
| expires_at | timestamptz not null default now()+interval '14 days' | |
| used_by | uuid references auth.users on delete set null | |
| used_email | text | 使った時のアドレス（一覧に出す・後で消えても残る） |
| used_at | timestamptz | |
| revoked_at | timestamptz | |
- RLS 有効・決まりは admin の select だけ（is_exally_admin()）。insert/update は関数だけ（definer）。
- public に窓 public.app_invites（security_invoker）。

### 関数（public・security definer・search_path 固定）
1. `app_invite_create(p_app text) returns text`：is_exally_admin() でなければ例外。生の字＝gen_random_bytes(24) を base64url、token_hash を入れ、生の字を1回だけ返す。
2. `app_invite_accept(p_token text) returns jsonb`：
   - auth.uid() 必須・セッションの amr（auth.jwt()->'amr'）に method 'otp' が在る＝そのアドレスへのメールのリンク／番号で今入った人だけ。
   - token_hash 一致・used_at 空・revoked_at 空・expires_at > now() を for update で取る。
   - 1つでも外れたら {ok:false} だけ返す（理由は分けない）。
   - 当たれば exally.*_entitlements に (uid, app, 'free', email=auth.users.email, note='invite:'||id) を upsert（既に paid なら plan を下げない＝paid は残す）、招待に used_by/used_email/used_at を書く。{ok:true, app} を返す。
3. `app_invite_revoke(p_id uuid)`：admin のみ・未使用の物に revoked_at。
- 元表の名のずれは関数の中で窓 public.exally_entitlements へ書く形にして吸収（definer なので窓越しに書ける・ee_admin_update は通らなくてよい）→要測：窓が自動更新可能か（単一表の窓なので可の見立て）。

## 無料の読み方（全アプリ揃え・麻雀の案 3 を採る）
- 「そのアプリの行が plan free（expires_at 空か先）」かつ「今のセッションの amr に otp」＝無料。
- 訳：共有 auth は autoconfirm＝他人が友達のアドレスで先にパスワード登録しておけば、友達が招待を受けた後もパスワードで同じアカウントに入れる。otp の時だけ無料と読めば、その他人には効かない。
- trial は各アプリが決める（麻雀は trial を何にも使わない＝ee_insert_own_trial の穴が効かない）。

## URL の着く所
- 各アプリの画面：`https://<アプリの配信>/#invite=<生の字>`（# の後ろ＝配信の記録・Referer に乗らない）。管理アプリはアプリごとの着く先の一覧を持つ（コードの定数・テスト線と本番で名札から分ける）。
- 各アプリの役目：# から字を取り出して sessionStorage に置き→メールのリンク／番号で登録・ログイン→入った直後に rpc('app_invite_accept') →成功なら無料の画面へ。字は使ったらすぐ消す。
- 共通の受け口の小さな js（invite-accept.js）を管理アプリの repo に置き、各アプリは写す（借りるのは見えない物だけ）。

## 管理アプリの画面（1枚）
- 上：アプリの切り替え（全部／麻雀／ダイコメ／Rakunally(payslip)／Exally(suite)／Castally(nomiya)／Timeally／Zeimally…）＋数（無料・有料・お試し・停止）。
- 一覧：アドレス・plan（押して切り替え trial/paid/free/disabled）・始めた日・招待から来たか。倉庫は fetchAll で読み切る（件数でページ終わりを決めない）。
- 招待：アプリを選んで「招待URLを作る」→ URL と「共有」（navigator.share・無ければ写す）。未使用／使用済み（誰が）／取り消しの一覧。
- ログイン：メールの番号（otp）で入り、exally_admins に居る人だけ。居なければ何も出さない。

## 線と門（atarashii-app の通り）
- js/supa-config.js を線ごとに1本（テスト=khaw・本番=tnfw）・名札の ref を縛る試験・env-badge・運ぶ道具の NEVER_SHIP。
- .githooks 4本＋commit-msg・noreply のメール・tests-registered。
- 試験：①倉庫（khaw）に関数を当てて、招待の作る→受ける→2回目弾く→期限切れ弾く→取り消し弾く→otp でない人弾く→admin でない人が作れない、を数える ②Playwright で管理画面の全ボタン。

## 決めていない（司さんへは訊かない見立て＝お金の出方は変えない）
- 有料（paid）は Stripe webhook が書く＝この設計では作らない（列は同じ表）。

## v1 に足した（ダイコメ [a20ecd]・麻雀 [4f73fc] の案と揃えた・11-20）
- 関数の名：`public.app_invite_create(p_app)`・`public.app_invite_claim(p_token)`（accept でなく claim に揃える）・`public.app_invite_revoke(p_id)`。置き場は public（rpc が届く部屋・is_exally_admin と同じ）。表は exally.app_invites。
- 期限 7日（ダイコメ案）。
- claim の確かめ（麻雀 §3.0 D と同じ）：amr に otp が在り その timestamp が1時間以内・auth.users.email_confirmed_at 在り・phone 空。足りない時は招待を減らさず {ok:false, need_otp:true}。招待の取りは `update … where token_hash=… and used_at is null and revoked_at is null and expires_at>now() returning app` が1行なら同じ取引で upsert＝同時に2人でも1人だけ。それ以外は {ok:false} だけ。
- app の名：'mahjong'・'daiko'（今の APP_LABEL に daiko:'ダイコメ' 在り）・payslip・suite・nomiya・invoice。
- paid の行は claim で下げない。disabled の行は claim で free に戻さない（司さんが止めた人を招待の字で戻させない）。
- 当てるのは管理アプリの席（zeroact-kanri-test の supabase/ から khaw→緑→本番 tnfw）。各アプリは関数を呼ぶだけで、表を作らない・当てない。
- pgcrypto 1.3 は両倉庫に在る（要測：置き場の schema＝extensions か）。
- 読む側の式（共通の決め）：無料＝ plan 'free'（expires_at 空か先）× 今のセッションの amr に otp × phone 空。人のセッションで門を読むアプリ（麻雀）はこの式そのもの。端末で門を読むアプリ（ダイコメ＝会社の url_token・人のセッション無し）は式を読めない＝代わりに「claim と会社作りは otp セッションだけ」「事務所の無料の印は otp セッションの時だけ」「パスワードの決め直し→他の端末を出す案内」で閉じる（ダイコメ紙の末尾「麻雀との違い」）。

## v2（taiketsu 止め7件の直し・11-20 夕）＝正本は C:/Users/zeroa/zeroact-kanri-test/supabase/001_app_invites.sql
- S1 客の画面：字は localStorage に期限つき（7日・使ったら消す）で置く。番号（メールの6桁）を同じタブで打つ道を主にする。開いたら history.replaceState で # を消す。
- S2 許す amr＝otp・magiclink・email/signup・invite（1時間以内）。email_change・recovery は入れない。測った：両倉庫とも auth.flow_state 0件（PKCE を使った跡なし）・amr は password と otp だけ（本番 otp 3・テスト otp 3）。
- S3 claim は jwt の email = auth.users.email を見て used_email を残す。読む式 app_is_free は「招待で付いた行なら jwt の email = used_email」を足す。
- S4 一覧は app_admin_list()（管理者だけ・アドレスは auth.users・招待の印は app_invites.used_by）。客が書ける email・note の字は使わない。
- S5 1枚に揃えた：関数は public・字は hex 64桁・列は created_by・返しは {ok,app,plan|already} ／ {ok:false,reason: need_otp|stopped|used|expired|revoked|bad}・app 名 'daiko'。
- S6 読む式は招待で付いた行だけに当てる（招待より前の free 行は今のまま）。
- S7 disabled＝減らさず stopped／paid＝使い切って already:'paid'／trial・free（期限切れ含む）＝free・expires_at null。
- N1 extensions.gen_random_bytes／N4 匿名は need_otp／N5 6関数とも anon・public から外した（proacl を測った＝authenticated・postgres・service_role だけ）。
- 試し：tests/invite-kura.sql（取引の中で 17件・最後に raise で巻き戻す）＝khaw で 17/17・残り0（invites 0・行15のまま）。
