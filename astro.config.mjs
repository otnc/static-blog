// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkEmoji from "remark-emoji";

import remarkDetails from "./src/plugins/remark-details.mjs";
import remarkMermaid from "./src/plugins/remark-mermaid.mjs";
import remarkLinkCard from "./src/plugins/remark-link-card.mjs";
import remarkGithubAlerts from "./src/plugins/remark-github-alerts.mjs";
import remarkAutoLink from "./src/plugins/remark-auto-link.mjs";
import remarkUnderline from "./src/plugins/remark-underline.mjs";
import rehypeUnderline from "./src/plugins/rehype-underline.mjs";
import rehypeMedia from "./src/plugins/rehype-media.mjs";
import rehypeExternalLinks from "./src/plugins/rehype-external-links.mjs";
import { SITE_URL } from "./src/consts.ts";

export default defineConfig({
  site: SITE_URL,
  // OG 画像生成（satori+sharp）が CPU バウンドでルート生成の律速になっているため
  // ページ生成を並列化する。出力は変わらない。
  build: {
    concurrency: 4,
  },
  integrations: [
    mdx(),
    sitemap(),
    icon({
      include: {
        "material-symbols": [
          "apps",
          "arrow-back",
          "arrow-downward",
          "arrow-forward",
          "arrow-upward",
          "article-outline",
          "calendar-today-outline",
          "check",
          "check-circle-outline",
          "content-copy-outline",
          "dark-mode-outline",
          "error-outline",
          "format-list-bulleted",
          "home-outline",
          "info-outline",
          "keyboard-arrow-down",
          "keyboard-arrow-up",
          "label-outline",
          "language",
          "light-mode-outline",
          "lightbulb-outline",
          "link",
          "person-outline",
          "picture-as-pdf",
          "priority-high",
          "push-pin",
          "rss-feed",
          "schedule-outline",
          "search",
          "search-off",
          "sort-by-alpha",
          "update",
          "warning-outline",
        ],
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "tokyo-night" },
      defaultColor: false,
      wrap: false,
    },
    remarkPlugins: [
      remarkGfm,
      remarkBreaks,
      remarkEmoji,
      remarkMath,
      remarkUnderline, // remarkGfm の後に実行（~~ 解決後に __ を処理）
      remarkDetails,
      remarkMermaid,
      remarkGithubAlerts,
      remarkAutoLink,
      remarkLinkCard,
    ],
    rehypePlugins: [
      [rehypeKatex, { strict: false, throwOnError: false }],
      rehypeUnderline, // no-op（互換性のため保持）
      rehypeMedia,
      rehypeExternalLinks,
    ],
  },
});
