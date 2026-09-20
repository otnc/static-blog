# テンプレートとして使う方へ

このリポジトリをフォークまたはクローンして自分のブログとして使うための手順です。

---

## 0. 前提

- **Node.js** 22.12.0 以上
- **pnpm** 10.32.0 以上
- GitHub Pages でのデプロイを想定 (`.github/workflows/deploy.yml` 同梱)

```bash
pnpm install
pnpm dev     # ローカル開発サーバー
pnpm build   # 静的ビルド（dist/）
pnpm preview # ビルド結果のプレビュー
```

---

## 1. `src/consts.ts` を書き換える

**ここを変えるだけで、ヘッダー、フッター、OGP、RSS、About ページ、サイドバー、metaタグなど、サイト全体に反映されます。**

```ts
export const SITE_TITLE = "あなたのブログ名";
export const SITE_DESCRIPTION = "ブログの説明文";
export const SITE_URL = "https://your-blog.example.com"; // 末尾スラッシュなし
export const TWITTER_HANDLE = "@your_handle";
export const GITHUB_URL = "https://github.com/you";
export const PORTFOLIO_URL = "https://your-portfolio.example.com";
export const AUTHOR_NAME = "あなたの名前";
export const AUTHOR_BIO = "自己紹介文";
```

| 定数 | 反映先 |
|---|---|
| `SITE_TITLE` | ヘッダー、OGP `og:title` / `og:site_name`、RSS フィードタイトル、`<title>` タグ |
| `SITE_DESCRIPTION` | OGP `og:description`、RSS、`<meta name="description">` |
| `SITE_URL` | OGP URL、canonical URL、`astro.config.mjs` の `site`、RSS |
| `TWITTER_HANDLE` | Twitter Card `twitter:site` / `twitter:creator`、フッター・サイドバーのリンク |
| `GITHUB_URL` | フッター・サイドバー・About ページのリンク |
| `PORTFOLIO_URL` | フッター・サイドバー・About ページのリンク |
| `AUTHOR_NAME` | `<meta name="author">`、フッター著作権表記、サイドバー表示名、About ページ |
| `AUTHOR_BIO` | サイドバーの自己紹介、About ページの自己紹介 |

> `astro.config.mjs` の `site` は `SITE_URL` を自動参照しているため個別の変更は不要です。

---

## 2. ドメイン設定

### `public/CNAME`

GitHub Pages でカスタムドメインを使う場合はドメインを書き換えてください。
カスタムドメインを使わない場合はファイルを削除してください。

### `.env.example`

`SITE` の値を `SITE_URL` と同じ URL に変更してください。
このファイルは `remark-link-card` プラグインがローカルリンクの OGP を取得するために使います。

---

## 3. 画像の差し替え

| ファイル | 用途 | 推奨サイズ |
|---|---|---|
| `public/icon.png` | ファビコン・ヘッダーロゴ・プロフィールアイコン | 正方形 (512×512 程度) |
| `public/header.png` | ヘッダーバナー画像 | 横長 (自由) |
| `public/thumbnail.png` | OGP 画像のデフォルト背景として合成される | 1200×630 |

> 記事ごとに OGP 背景を変えたい場合は `public/files/<記事ID>/_thumbnail.png` (1200×630) を配置するか、`pnpm thumbnail` の Web エディタで作成できます。詳細は [README.writer.md](./README.writer.md#サムネイルogp画像のカスタマイズ) を参照。

---

## 4. `src/pages/about.astro` を編集する

About ページは `consts.ts` の定数 (`AUTHOR_NAME`、`AUTHOR_BIO`、各URL) を参照していますが、**ページ本文はこのファイルに直接書かれています。** 以下を自分の内容に書き換えてください:

- **「このブログについて」セクション** — ブログの技術構成や説明文
- **ライセンス表記** — CC BY-NC-SA 4.0 の記述 (変更・削除は自由)
- **リンクセクション** — 定数を参照しているので通常は変更不要。SNS を増減したい場合はここを編集

同様に、`src/components/AboutSidebar.astro` にも「このブログについて」のテキストとライセンス表記があるので、合わせて編集してください。

---

## 5. テーマカラー (任意)

`src/styles/global.css` の CSS カスタムプロパティを編集します。

```css
/* ライトテーマ */
:root {
  --accent: #6c5ce7;        /* メインのアクセントカラー */
  --accent-hover: #5b4cdb;
}

/* ダークテーマ */
[data-theme="dark"] {
  --accent: #a78bfa;
  --accent-hover: #c4b5fd;
}
```

コードブロックのシンタックスハイライトテーマは `astro.config.mjs` の `shikiConfig.themes` で変更できます (デフォルト: `github-light` / `tokyo-night`)。

---

## 6. 記事の書き方

### 新しい記事を作成

```bash
pnpm new
```

対話形式で記事 ID・タイトル・タグなどを入力すると、`src/content/blog/<id>.mdx` と `public/files/<id>/` が自動生成されます。

### フロントマターの項目

```yaml
---
title: "記事タイトル"
description: "記事の説明"
pubDate: "2026-04-11"          # YYYY-MM-DD（JST）
updatedDate: null               # 更新日（任意）
tags: ["タグ1", "タグ2"]
pinned: false                   # トップに固定表示
hidden: false                   # 一覧・RSS から非表示
---
```

### 画像の配置

記事に使う画像は `public/files/<記事ID>/` に置き、MDX 内では以下のように参照します:

```md
![alt](/files/<記事ID>/image.png)
```

### ファイル管理 (任意)

```bash
pnpm file                   # article/<id> ブランチ上で実行すると自動で対象記事を判定
pnpm file <記事ID>           # 明示指定
```

ブラウザに VSCode 風のファイル管理画面が立ち上がり、`public/files/<記事ID>/` の中身を一覧・プレビュー・リネーム・削除・コピー (Markdown 埋め込み記法/URL) できます。画像 / 動画 / 音声 / PDF に対応。画像 (HEIC 含む) は自動で PNG 化、動画 / 音声 / PDF はそのまま保存されます。さらに画像はその場で `pnpm thumbnail` 同等の編集 (トリミング・回転・反転・1px ナッジ) も可能です。

### 記事ごとの OGP 画像 (任意)

```bash
pnpm thumbnail              # article/<id> ブランチ上で実行すると自動で対象記事を判定
pnpm thumbnail <記事ID>      # 明示指定
```

ブラウザに Web エディタが立ち上がり、トリミング・回転・反転・1px ナッジ (キーボードショートカット対応) で 1200×630 px のサムネイル背景を編集できます。保存すると `public/files/<記事ID>/_thumbnail.png` に書き出され、次回ビルドで反映されます (サイズが不正だとビルドエラーで止まります)。

### 対応している記法

標準 Markdown に加え、多数の拡張記法に対応しています。
詳細は `README.writer.md` を参照してください。

---

## 7. デプロイ

同梱の `.github/workflows/deploy.yml` が `main` ブランチへの push 時に自動ビルド&GitHub Pages デプロイを行います。

1. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定
2. カスタムドメインを使う場合は `public/CNAME` と DNS を設定
3. `main` に push すれば自動デプロイ

---

## 8. 既存のサンプル記事を削除する

フォーク後、以下を削除すればまっさらな状態になります:

- `src/content/blog/` 内の `.mdx` ファイルをすべて削除
- `public/files/` 内のフォルダをすべて削除

---

## 変更箇所チェックリスト

| # | 対象 | 必須 |
|---|---|---|
| 1 | `src/consts.ts` の全定数 | ✅ |
| 2 | `public/CNAME` (ドメイン変更 or 削除) | ✅ |
| 3 | `.env.example` の `SITE` | ✅ |
| 4 | `public/icon.png` / `header.png` / `thumbnail.png` | ✅ |
| 5 | `src/pages/about.astro` の本文 | ✅ |
| 6 | `src/components/AboutSidebar.astro` の「このブログについて」テキスト | ✅ |
| 7 | `src/styles/global.css` のテーマカラー | 任意 |
| 8 | サンプル記事の削除 | 任意 |
