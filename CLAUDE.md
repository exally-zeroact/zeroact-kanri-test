# 管理アプリ（zeroact-kanri-test ＝ テスト線 ／ zeroact-kanri ＝ 本番）

全アプリ共通の管理画面。開けるのは `public.exally_admins` に行がある人（司さん）だけ。
上でアプリを切り替え、人ごとの 無料・有料・お試し・停止（`public.exally_entitlements` の plan）を一覧で見て切り替える。
招待 URL（1人に1本・1回だけ・7日）もここで出す＝登録してメールで確かめた人はそのアプリが無料。

- 設計の正本＝`supabase/001_app_invites.sql` の頭の返しの形と `docs/sekkei.md` の「## v2」。
- アプリごとの名簿は作らない。司さんがアドレスを打つ手は作らない。
- お金の出方を変える決めは司さんに訊く。

## どちらの線か
- 名札 `js/supa-config.js` だけで決める（test＝khaw／prod＝tnfw）。名札は線ごとに1本・本番へ運ばない（`scripts/hakobu.mjs` の NEVER_SHIP）。
- `tests/namefuda.test.mjs` が ①帯 ①'名札の線と倉庫 ②倉庫の名は名札の外に無い ③origin の名と名札 を縛る。
- 倉庫に当てる道具（`scripts/apply-sql.mjs`・`kura-shiken.mjs`・`e2e-kura.mjs`）は khaw に釘付け。本番 tnfw への SQL は本番前 taiketsu の後に別の道で。
- 本番は読むだけで確かめる。作る・書く試しは khaw だけ。

## 試験（2層検証・global-rules §11）
① 本物のエンジンに全パターンを流し、客に見える返しで期待値と突き合わせる
　＝`npm run kura`（`tests/invite-kura.sql` を khaw の取引の中で流し、最後に raise で巻き戻す・18/18・残り0）
② 実 UI（Playwright）で全タブ・全ボタン・全入力を押し、JS エラー 0・倉庫に書かれた値まで確かめる
　＝`npm run e2e`（chromium＋webkit・使い捨ての人2人を作って finally で消し、残り0を数える・絵は %TEMP%/kanri-e2e）
- ①② は倉庫の鍵（~/.supabase-token）が要る＝手元だけ。CI は `node tests/run.mjs`（名札・運ぶ道具・実在の字）＋ `scripts/tests-registered.mjs` とその自己確認。
- 数が緑でも絵を開くまで OK を出さない。

## 押す
- 書き手は noreply（`git config --local user.email`）。門は `.githooks`（core.hooksPath）＝メール・実在の字・commit の文。
- テスト線で緑 → 同じ差分を `node scripts/hakobu.mjs --to <本番の作業木>` で本番へ運ぶ。`git archive | tar` 禁止。
- push の後は kensan。本番前は taiketsu（差分ごと）。
