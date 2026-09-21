# OBS演出アプリケーション 現在状態仕様書

最終更新日: 2026-07-18

このドキュメントは、現時点の実装状態を次の開発者またはAIエージェントへ共有するための仕様メモです。企画上の理想仕様ではなく、現在のコードベースで実装済みの機能、重要な挙動、既知の制約を中心に記載します。

## 1. アプリ概要

OBS Studio のブラウザソースに透明背景の Overlay を表示し、Control UI からリアルタイムに演出を送るローカルアプリケーションです。

主な用途:

- TikTok LIVE などのイベントを受け取り、OBS Overlay 上で演出を出す
- Control UI から手動でエフェクトをテストする
- 画像、動画、音声アセットをローカル管理する
- プリセット単位で複数エフェクトを組み合わせる
- ギフト履歴や記録済みギフトを使ってトリガーを設定する

## 2. 技術スタック

- TypeScript
- Node.js
- pnpm workspace
- Fastify
- @fastify/websocket
- @fastify/static
- React
- React Router
- Vite
- Zod
- Vitest
- ESLint
- Prettier

## 3. ワークスペース構成

```text
apps/
  server/   Fastify API、WebSocket、Runtime、TikTok、アセット管理
  control/  React Control UI
  overlay/  OBS 用 Overlay 表示

packages/
  shared-types/  サーバー、Control、Overlay の共有型

docs/
  CURRENT_STATE_SPEC.md
```

## 4. 起動 URL

サーバーの既定ポートは `3190` です。

- Control UI: `http://127.0.0.1:3190/control`
- Dashboard: `http://127.0.0.1:3190/control/dashboard`
- OBS Overlay 1: `http://127.0.0.1:3190/overlay`
- OBS Overlay 指定: `http://127.0.0.1:3190/overlay/:overlayId`
- Health Check: `http://127.0.0.1:3190/health`
- Status API: `http://127.0.0.1:3190/api/v1/status`

Overlay ID は `1` から `10` まで対応しています。`/overlay` は Overlay 1 として扱われます。

## 5. 起動方法

Windows では以下を使います。

```bat
scripts\install.bat
scripts\start-dev.bat
```

主な開発コマンド:

```bat
corepack pnpm build
corepack pnpm lint
corepack pnpm test
```

補足: 現在の環境では Vite/esbuild がサンドボックス制限で失敗することがあります。サーバー側の `build` と `test`、Overlay の `tsc --noEmit` は直近の変更で確認済みです。

## 6. サーバー機能

主なファイル:

- `apps/server/src/app.ts`
- `apps/server/src/server.ts`
- `apps/server/src/server.test.ts`
- `apps/server/src/api/routes`
- `apps/server/src/runtime`
- `apps/server/src/effects`

実装済み:

- Fastify HTTP API
- Control UI と Overlay の静的配信
- `/ws/control` Control 用 WebSocket
- `/ws/overlay` Overlay 用 WebSocket
- `/ws/overlay/:overlayId` Overlay ID 指定 WebSocket
- Health Check
- Status API
- NormalizedEvent 受信 API
- API キー認証
- Zod バリデーション
- eventId 重複除外
- Event Bus
- Event history
- UI log buffer
- Runtime Effect Object Store
- Overlay runtime snapshot
- Effect configuration 管理
- Preset 管理
- Asset catalog 管理
- TikTok connector / Browser connector / Raw capture
- Gift catalog

## 7. 主要 API

イベント:

- `POST /api/v1/events`
- `GET /api/v1/events/history`
- `DELETE /api/v1/events/history`
- `POST /api/v1/events/:eventId/replay`

エフェクト:

- `GET /api/v1/effect-definitions`
- `GET /api/v1/effect-configurations`
- `POST /api/v1/effect-configurations`
- `PATCH /api/v1/effect-configurations/:id`
- `DELETE /api/v1/effect-configurations/:id`
- `POST /api/v1/effect-configurations/:id/test`

Overlay:

- `GET /api/v1/overlays`
- `GET /api/v1/overlays/:overlayId`
- `POST /api/v1/overlays/:overlayId/test`
- `GET /api/v1/overlays/:overlayId/runtime`
- `DELETE /api/v1/overlays/:overlayId/runtime`

アセット:

- `GET /api/v1/assets`
- `PUT /api/v1/assets/upload?filename=<fileName>`
- `PATCH /api/v1/assets/:id`
- `DELETE /api/v1/assets/:id`
- `/asset-files/<fileName>` でローカルコピー済みファイルを配信

プリセット:

- `GET /api/v1/presets`
- `POST /api/v1/presets`
- `PATCH /api/v1/presets/:id`
- `DELETE /api/v1/presets/:id`
- `POST /api/v1/presets/:id/slots`
- `PATCH /api/v1/presets/:id/slots/:slotId`
- `DELETE /api/v1/presets/:id/slots/:slotId`
- `POST /api/v1/presets/:id/save`
- `POST /api/v1/presets/:id/select`

TikTok / Gifts / Logs:

- TikTok 接続、Mock event、Raw capture、Browser frame capture 系 API
- Gift catalog API
- Logs API

System:

- `GET /api/v1/system/fonts`
- `POST /api/v1/system/fonts/rescan`

## 8. Control UI

主なページ:

- Dashboard
- Connections
- TikTok LIVE
- TikTok Raw Events
- TikTok Browser Frames
- HTTP API
- OBS
- Event Monitor
- Event Test
- Gift Records
- Effects
- Overlays
- Assets
- Presets
- Macros
- Rules
- Logs
- Settings

実装済みの UI 挙動:

- 左サイドバーによるページ遷移
- React Router による直接 URL アクセス
- Control WebSocket の接続状態表示
- Overlay 接続数表示
- Dashboard の受信統計
- Event Monitor のフィルター、詳細表示、再送
- Logs のフィルター、コピー、詳細表示
- Settings の言語設定
- 英語 / 日本語表示切替

## 9. アセット管理

アセット画面では、画像、動画、音声をローカルアセットとしてアップロードできます。

実装済み:

- 複数ファイルアップロード
- 日本語ファイル名の表示対応
- 対応 MIME:
  - `image/*`
  - `video/*`
  - `audio/*`
  - `application/octet-stream` は拡張子から判定
- 500MB までのアップロード制限
- アップロード済みアセットは `data/assets/files` にコピー
- Catalog は `data/assets/catalog.json`
- アップロード済みアセットの名前変更
- アップロード済みアセットの削除
- 同梱アセットは編集不可
- 音声アセット詳細で再生 / 停止
- 音声プレビューの初期音量は 50%
- 音量スライダー
- アセット一覧のみスクロール
- 詳細パネルは一覧スクロールに巻き込まれにくい固定表示
- 検索バー
  - 名前
  - ファイル名
  - 説明
  - MIME type
  - 拡張子
  - 種別
  - 日本語検索対応として `NFKC` 正規化と小文字化を使用
- フィルター
  - すべて
  - 画像
  - 動画
  - 音声
  - その他
  - 詳細
- 詳細フィルターでは存在する拡張子ごとに絞り込み可能
- 並び替え
  - アルファベット順
  - あいうえお順
  - 追加順
  - アセットサイズ順
  - 昇順 / 降順
- 表示方法
  - タイル型
  - リスト型
- リスト型ではプレビュー画像を表示しない

現在の複数アップロードは、既存の単体アップロード API を Control UI 側から順番に呼ぶ方式です。

## 10. プリセット機能

プリセットは、Effects Library とは別に、ユーザーが実際に使う演出セットとして扱います。

実装済み:

- 新規プリセット作成
- プリセット名 / Description 編集
- Description は Preset name の下に配置
- Blank Effect の追加
- Blank Effect から Effects を指定
- Effects の詳細設定をプリセット内で編集
- 保存ボタン
- プリセットを作成しただけでは確定せず、保存で反映
- 選択したプリセットは一覧の先頭へ移動
- 使用頻度が高いプリセットほど上に残りやすい
- Simple Media Effect のアセット系設定は縦並び
- Gift trigger は Gift ID 入力または記録済みギフトから選択
- 記録済みギフト選択は別 UI でタイル表示
- ギフト名検索、コイン数による表示調整のための土台あり

## 11. エフェクト

共有型では `EffectKind` に複数エフェクト種別が追加されています。

主な実装済みエフェクト:

- `flash`
- `falling-image`
- `simple-media`
- `pitching-machine-ball`
- `gift-combo-text`

Effect configuration は対象 Overlay を指定できます。未指定の場合は Overlay 1 へフォールバックします。

## 12. Gift Combo Text Effect

主なファイル:

- `apps/server/src/effects/builtins/giftComboText.ts`
- `apps/overlay/src/main.tsx`
- `apps/overlay/src/styles.css`
- `apps/control/src/pages/EffectsPage.tsx`

実装済み:

- ギフト数連動のコンボテキスト表示
- Effect definition ID は `gift-combo-text`
- Runtime object type は `gift-combo-text`
- 対象ギフトは `all-gifts` または `specific-gifts`
- `specific-gifts` は Gift ID CSV と記録済みギフト選択 UI から設定
- ギフト数は `normalizedGiftQuantity`、なければ `repeatCount` を使用
- `gift` / `gift-streak-start` / `gift-streak-end` をカウント対象
- `gift-streak-update` は二重加算回避のため現時点では対象外
- 同じ設定に対する追加ギフトは既存表示の目標コンボ数へ加算
- 受付猶予時間が切れるまでコンボ表示を維持し、期限後に終了状態へ移行
- 表示言語は English / 日本語
- 日本語表示は `10コンボ`、英語表示は `10 combo`
- フォントファミリー、サイズ、太さ、文字間隔を設定可能
- Windows system fonts を API で列挙し、Control UI の候補に表示
- フォントが見つからない場合はブラウザ側のフォールバックフォントを使用
- 文字色は単色または CMY rainbow
- CMY rainbow は cyan / white / magenta / dark gray / yellow / white / cyan / dark gray / cyan の流れ
- 縁取り色、太さ、不透明度を設定可能
- 音声アセットを選択可能
- 音量、最小再生間隔を設定可能
- コンボ数に応じたピッチ変化に対応
- カウント速度は一定または加速
- 加速は `base + (max - base) * (1 - exp(-k * combo))` に近い式で描画側が補間
- Test ボタンでは 10 個分のギフトを送った想定でプレビュー
- Event Monitor からの replay でも通常イベントとして条件一致時に動作

制約:

- `gift-streak-update` の扱いは、TikTok 実イベントの重複挙動を見ながら調整余地あり
- Gift image のローカルキャッシュは未完成のため、記録済みギフト UI は catalog の画像 URL に依存
- CMY rainbow の細かい色変更 UI は schema 側の土台が中心で、Control UI では基本設定を優先

## 13. Pitching Machine Ball Effect

主なファイル:

- `apps/server/src/effects/builtins/pitchingMachineBall.ts`
- `apps/overlay/src/main.tsx`
- `apps/overlay/src/styles.css`
- `apps/control/src/pages/EffectsPage.tsx`
- `apps/control/src/pages/PresetsPage.tsx`

実装済み:

- ピッチングマシーン画像をアセットから選択
- ボール画像をアセットから選択
- 発射音を音声アセットから選択
- 衝突音を音声アセットから選択
- 音量設定
- 座標ピッカー UI
- 座標は数値表記
- Overlay サイズに合わせた座標選択
- 発射端は左右のみ
- 発射端の選択方式は UI から削除
- 内部挙動は毎回ランダムで左または右
- 上下からは出現しない
- 左右端の補正 px
  - `0`: 左 `0`、右 `overlayWidth`
  - `-80`: 左 `80`、右 `overlayWidth - 80`
  - `80`: 左 `-80`、右 `overlayWidth + 80`
- マシーンは画面端のランダムな Y 座標に出現
- リスナー 1 人につき 1 台のマシーン
- 同じリスナーが複数ギフトを送った場合、同じマシーンから連続発射
- 複数リスナーでは複数マシーン
- 発射後にも追加ギフトを受け取る猶予時間
- マシーン斜め上にリスナー名表示
- マシーン出現アニメーション
- 出現後に標的座標へ照準角度をつける
- 発射時に反動アニメーション
- ボールは指定座標に到達した瞬間に衝突後演出へ移行
- ボール寿命設定
- マシーン退場アニメーション
- 退場時は少し内側へオーバーシュートしてからスライドアウト
- マシーンのレイヤーはボールより前面
- 右から出るマシーンは 90 度回転ではなく左右反転
- Flicker 対策
  - machine objects と animated objects を分離
  - machine は frame time による不要な再描画を避ける
  - runtime object update で配列順を不要に変えない

Pitching Machine のテストシナリオ:

- 通常テスト
- 同じユーザーからギフトを受け取った時
- 複数ユーザーからギフトを受け取った時
- 新たなリスナーのギフトをテスト

## 14. 座標ピッカー

実装済み:

- Overlay サイズを表示
- GUI 上で座標を選択
- 数値入力で座標指定
- `%` 表記ではなく数値表記
- 再利用可能な UI として設計

今後、他エフェクトの座標指定にも流用予定です。

## 15. 言語設定

Settings 画面で表示言語を選択できます。

対応済み:

- English
- 日本語
- 設定はブラウザの localStorage に保存
- `document.documentElement.lang` に反映
- Preset / Effects / Assets / Settings など主要画面の表示文言を日本語化

将来的には他言語を追加できる構造です。

## 16. TikTok LIVE / Raw Capture / Browser Connector

実装済み:

- TikTok connector mode:
  - browser
  - library
  - mock
- `tiktok-live-connector` を optional adapter として利用
- Browser Connector は Chrome / Edge を CDP で起動
- TikTok LIVE ページを開く
- WebSocket frame capture
- Raw Event Capture
- Safe serialization
- secret-like fields の redaction
- JSON / JSONL export
- Raw Event Inspector
- Browser Frame Inspector
- Mock events
- Gift / Like aggregation

制約:

- TikTok の仕様変更に影響される可能性あり
- Browser WebSocket frame の完全な protobuf decoding は段階的対応

## 17. Gift Catalog

実装済み:

- TikTok gift catalog
- `data/gifts/catalog.json` に保存
- gift id、名前、alias、coin count、画像 URL、seen count などを管理
- sender/user 個人情報は catalog に保存しない
- 手動編集は `isManuallyEdited` として扱う
- 自動更新は手動編集した名前や値を上書きしない
- Gift Records UI
- 記録済みギフトを Preset trigger 選択に利用

## 18. Overlay Runtime

実装済み:

- Runtime object snapshot
- Interactive object mock
- Object move
- Object hit
- Runtime clear
- Overlay ID ごとの Runtime 管理
- `falling-image`
- `simple-media`
- `pitching-machine`
- `pitching-ball`
- `pitching-impact`
- `gift-combo-text`

Overlay CSS の基本要件:

```css
html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent !important;
}
```

## 19. OBS 推奨設定

OBS Studio のブラウザソース URL:

```text
http://127.0.0.1:3190/overlay
```

推奨:

- 横配信: 1920 x 1080
- 縦配信: 1080 x 1920
- FPS: 60
- 背景: 透明
- シーンが非アクティブになった時にブラウザを更新: OFF
- OBS が非表示時にソースをシャットダウン: OFF

## 20. 直近の検証状態

直近で確認済み:

- `corepack pnpm --filter @obs-effect/server build`
- `corepack pnpm --filter @obs-effect/server test`
- `corepack pnpm --filter @obs-effect/overlay exec tsc --noEmit`

Control 全体の `tsc --noEmit` は、既存の別ページ由来の TypeScript エラーが残っているため失敗することがあります。直近の Effects / Assets 画面変更では、変更ファイル由来のエラーが出ていないことを確認しています。

## 21. 既知の制約 / 未実装

- Rule Engine は UI/概念として残っているが、本格運用機能は未完成
- Macro 管理は将来拡張枠
- OBS WebSocket によるソース制御は未実装
- Electron / Windows `.exe` パッケージは未実装
- Playwright E2E は未整備
- アセットの multipart 一括 API は未実装
  - 現在は UI 側で単体アップロード API を複数回呼ぶ
- Gift image のローカルキャッシュは未完成
- TikTok 実接続は環境と TikTok 側仕様に依存

## 22. 次に開発する時の短い引き継ぎ

このアプリは pnpm workspace 構成で、`apps/server` が Fastify、`apps/control` が React/Vite、`apps/overlay` が React/Vite、`packages/shared-types` が共有型です。現在はアセット管理、プリセット、複数 Overlay、TikTok 周辺、Gift Catalog、Pitching Machine Ball Effect、Gift Combo Text Effect がかなり進んでいます。Pitching Machine Ball は左/右ランダム発射、左右端補正、照準角度、反動、退場演出まで実装済みです。Gift Combo Text はギフト数をコンボ数として加算し、受付猶予、表示言語、フォント、縁取り、CMY rainbow、音声とピッチ変化に対応済みです。アセット画面は複数アップロード、検索、フィルター、拡張子詳細フィルター、並び替え、タイル/リスト表示、音声プレビューに対応済みです。

## 23. Ball Reveal Effect

Effect definition ID は `ball-reveal` です。

- 左画面外から指定中心座標へ、ボールが放物線を描いて飛来
- 到着時にプログラム生成の発光・きらめきを表示し、ボールをフェードアウト
- 画像または動画を中心から 0% → 100% に拡大表示
- 画像は既定で4秒表示し、3秒目からフェードアウト
- 動画は拡大開始と同時に音声付きで再生し、終了前に映像と音量をフェードアウト
- 登録メディアは一巡するまで重複しないシャッフル方式
- 連続ギフトはOverlay側で順番待ちし、現在の送信者名と待機件数を表示
- メディア読み込み失敗時は失敗候補を除外し、ボール投擲から再実行
- Effects LibraryとPresetの両方で画像・動画の候補リストを編集可能
- ボール、軌道、発光、メディアサイズ、表示時間、動画音量、送信者名、キュー上限を設定可能
- ボール未指定時は `apps/overlay/src/assets/ball-reveal-default.png` を使用
