/* supa-config.js — ★この線の名札（テスト線 zeroact-kanri-test）★
 * どちらの線かは ★このファイルだけ★ で決める。本番 zeroact-kanri へは運ばない（scripts/hakobu.mjs の NEVER_SHIP）。
 * url と publishable（公開鍵）は画面に埋めてよい物（RLS と関数の中の管理者の確かめで守る）。
 * invite＝招待 URL の着く先（アプリの名 → その線の受け口）。# の後ろに字を付ける（配信の記録・Referer に乗らない）。
 *   着く先がまだ無いアプリは書かない＝画面の「招待URLを作る」が押せない。
 */
window.SUPA = {
  url: 'https://khawdrnvssdenumbiwfg.supabase.co',
  key: 'sb_publishable_UrRIobyVFbaJI_85RBxBOA_GZ4OUxPm',
  env: 'test',
  invite: {
    mahjong: 'https://mahjong-dtm-test.vercel.app/',
    daiko: 'https://daikou-app-test.vercel.app/login.html'
  }
};
