# world-food-map

作った海外料理・食べた国を記録して、世界地図に色を塗るサイト。

- 記録はスマホの **Notion アプリ**から（データベースにページを追加するだけ）
- GitHub Actions を**手動実行**すると、Notionの内容を取り込んで地図データ (`src/data/eaten.json`) を更新・コミット
- サイトは **Cloudflare Pages** の Git 連携で `main` への push を検知して自動デプロイ

## 仕組み

```
[Notion DB]  (スマホで記録)
     |  手動で GitHub Actions "Update food map from Notion" を実行
     v
[GitHub Actions] --node scripts/fetch-notion.mjs--> src/data/eaten.json を更新してpush
     |
     v
[Cloudflare Pages]  push を検知して自動ビルド・公開
```

更新頻度が低い前提のため、Notion Webhookやcronは使わず「記録が溜まったら手動でActionsを実行」という運用にしています。

## セットアップ

### 1. Notion 側

1. https://www.notion.so/my-integrations で internal integration を作成し、Secret（`ntn_...`）を控える
2. データベース「世界ごはんログ」を開き、右上の `...` → `コネクト` から作成した integration を接続（共有）する
3. データベースのURL（`https://www.notion.so/xxxx?v=yyyy` の `xxxx` 部分、ハイフンなし32文字）を Database ID として控える

### 2. GitHub 側

リポジトリの Settings → Secrets and variables → Actions で以下を登録:

- `NOTION_TOKEN`: 上記で控えた integration の Secret
- `NOTION_DATABASE_ID`: 上記で控えた Database ID

### 3. Cloudflare Pages 側

1. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
2. このリポジトリ (`m-tetsu/world-food-map`) を選択
3. Build command: `npm run build` / Output directory: `dist`
4. デプロイ後、必要なら Custom domains でreadybridgeとは別の独自ドメインを割り当て可能（未設定でも `*.pages.dev` で公開される）

## 記録の追加方法（運用）

1. スマホの Notion アプリで「世界ごはんログ」DBに1行追加（料理名・国・食べた日・写真・メモ）
   - 「国」は地図データ(world-atlas)に含まれる174の国・地域をあらかじめ select の選択肢として登録済み。タップして数文字入力すれば絞り込める（Notionはカテゴリ→国の2段階選択には対応していないため、フリーワード検索できる1段階のselectにしている）
2. 記録が溜まったら GitHub の Actions タブ → "Update food map from Notion" → Run workflow を手動実行
3. 数十秒でコミットされ、Cloudflare Pagesが自動で再デプロイ

174ヶ国でカバーしていない国（南極や係争地域など数ヶ国のみ）を追加したくなった場合のみ、Notionのselectに新規オプションを足したうえで `src/data/countryCodes.mjs` に手動でISO 3166-1 numericコードを追記する（`scripts/generate-country-codes.mjs` の元データが対象外の国のため自動生成はできない）。

## ローカル開発

```bash
npm install
npm run dev        # http://localhost:4321
npm run build
npm run preview

# Notionから手動で取り込みたい場合
NOTION_TOKEN=xxx NOTION_DATABASE_ID=xxx npm run fetch-notion
```

## 技術スタック

- Astro（静的サイト生成、ビルド時に世界地図SVGを生成。クライアントJS 0）
- d3-geo / topojson-client / world-atlas（Natural Earthデータ、パブリックドメイン）
- @notionhq/client（Notion APIからの取り込みスクリプト用）
- i18n-iso-countries（`scripts/generate-country-codes.mjs` で国名⇔ISOコード変換に使用。ビルドや通常運用では使わない）
