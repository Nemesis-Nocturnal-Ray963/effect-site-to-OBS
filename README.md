# OBS Effect App

OBS Studio のブラウザソースに透明背景の Overlay を表示し、Control UI からリアルタイムに演出を送るローカルアプリケーションです。

TikTok LIVE などのイベントを受け取り、OBS Overlay 上で演出を出すことを目指しています。

## 主な機能

- Control UI から手動でエフェクトをテスト
- OBS 用 Overlay の表示
- 画像、動画、音声アセットのローカル管理
- プリセット単位で複数エフェクトを組み合わせ
- TikTok LIVE イベントやギフトを使ったトリガー設定

## 技術スタック

- TypeScript
- Node.js
- pnpm workspace
- Fastify
- React
- Vite
- Zod
- Vitest
- ESLint
- Prettier

## 起動方法

```bat
scripts\install.bat
scripts\start-dev.bat
```

または:

```powershell
corepack pnpm install
corepack pnpm build
corepack pnpm --filter @obs-effect/server start
```

## 設定を引き継ぐアップデート

アプリのサーバーとTikTokブラウザを終了してから、`scripts\update.bat` を実行してください。Git版・ZIP版を自動判別し、設定・素材を含む `data` をバックアップして保持したまま、GitHubのmainからプログラムを更新します。

更新の確認だけなら `scripts\update.bat --check` を実行します。完了後は `scripts\start-dev.bat` で起動し直してください。

詳細は [アップデート手順と復旧について](docs/updating.md) を参照してください。

## URL

- Control UI: http://127.0.0.1:3190/control
- Dashboard: http://127.0.0.1:3190/control/dashboard
- OBS Overlay: http://127.0.0.1:3190/overlay
- Health Check: http://127.0.0.1:3190/health
- Status API: http://127.0.0.1:3190/api/v1/status

## ワークスペース構成

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
