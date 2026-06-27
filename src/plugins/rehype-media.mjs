/**
 * rehype: 画像構文をメディア埋め込みに拡張
 *
 * 型検出優先度: data-type 属性 > title 属性 > URL 拡張子
 * 対応: video, audio, pdf, youtube, twitter/x
 */
import { visit } from "unist-util-visit";

// メディアタイプ定義

const EXT_TO_TYPE = {
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".avi": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".pdf": "pdf",
};

const KNOWN_TYPES = new Set([
  "video",
  "audio",
  "pdf",
  "youtube",
  "twitter",
  "x",
]);

// ヘルパー

function getExtension(url) {
  try {
    const pathname = new URL(url, "https://example.com").pathname;
    const dot = pathname.lastIndexOf(".");
    return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
  } catch {
    return "";
  }
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/.test(
    url,
  );
}

function getYouTubeId(url) {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/,
  );
  return m ? m[1] : null;
}

function isTwitterUrl(url) {
  return /(?:twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
}

/**
 * img ノードのメディアタイプを解決。
 * data-type > title > URL パターンの順でチェック。
 */
function resolveType(src, properties) {
  // 1. data-type 属性
  const explicit = (properties.dataType ?? properties["data-type"] ?? "")
    .toString()
    .toLowerCase()
    .trim();
  if (explicit && KNOWN_TYPES.has(explicit)) return explicit;

  // 2. title 属性
  const titleHint = (properties.title ?? "").toString().toLowerCase().trim();
  if (titleHint && KNOWN_TYPES.has(titleHint)) return titleHint;

  // 3. URL パターン
  if (isYouTubeUrl(src)) return "youtube";
  if (isTwitterUrl(src)) return "twitter";

  const ext = getExtension(src);
  return EXT_TO_TYPE[ext] ?? null;
}

// ビルダー

function buildVideo(src, alt) {
  return {
    type: "element",
    tagName: "video",
    properties: {
      src,
      controls: true,
      preload: "metadata",
      className: ["media-video"],
      title: alt || undefined,
    },
    children: [
      { type: "text", value: "お使いのブラウザは動画タグに対応していません。" },
    ],
  };
}

function buildAudio(src) {
  return {
    type: "element",
    tagName: "audio",
    properties: {
      src,
      controls: true,
      preload: "metadata",
      className: ["media-audio"],
    },
    children: [
      { type: "text", value: "お使いのブラウザは音声タグに対応していません。" },
    ],
  };
}

function iconifyIcon(icon, size = "20") {
  return {
    type: "element",
    tagName: "iconify-icon",
    properties: {
      icon,
      width: size,
      height: size,
      "aria-hidden": "true",
    },
    children: [],
  };
}

/**
 * PDF.js ベースの自前ビューワー。
 * デスクトップ/スマホ問わずページを canvas 描画する。
 * JS が無効・失敗した場合は .pdf-fallback の「開く」リンクが表示される
 * (プログレッシブエンハンスメント)。
 * 実際の初期化は BlogPost.astro のスクリプトが行う。
 */
function buildPdf(src, alt) {
  const label = alt || "PDF";
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["pdf-viewer"],
      "data-pdf-src": src,
      "data-pdf-label": label,
    },
    children: [
      // ツールバー (JS 初期化後に表示)
      {
        type: "element",
        tagName: "div",
        properties: { className: ["pdf-toolbar"], hidden: true },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["pdf-page-indicator"] },
            children: [{ type: "text", value: "" }],
          },
          {
            type: "element",
            tagName: "div",
            properties: { className: ["pdf-toolbar-actions"] },
            children: [
              {
                type: "element",
                tagName: "button",
                properties: {
                  type: "button",
                  className: ["pdf-btn", "pdf-mode"],
                  "aria-label": "プレゼン表示",
                  title: "プレゼン表示",
                },
                children: [
                  iconifyIcon("material-symbols:slideshow"),
                  {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["pdf-mode-label"] },
                    children: [{ type: "text", value: "プレゼン表示" }],
                  },
                ],
              },
              {
                type: "element",
                tagName: "button",
                properties: {
                  type: "button",
                  className: ["pdf-btn", "pdf-zoom-out"],
                  "aria-label": "縮小",
                  title: "縮小",
                },
                children: [iconifyIcon("material-symbols:zoom-out")],
              },
              {
                type: "element",
                tagName: "button",
                properties: {
                  type: "button",
                  className: ["pdf-btn", "pdf-zoom-in"],
                  "aria-label": "拡大",
                  title: "拡大",
                },
                children: [iconifyIcon("material-symbols:zoom-in")],
              },
              {
                type: "element",
                tagName: "button",
                properties: {
                  type: "button",
                  className: ["pdf-btn", "pdf-fullscreen"],
                  "aria-label": "全画面表示",
                  title: "全画面表示",
                },
                children: [iconifyIcon("material-symbols:fullscreen")],
              },
              {
                type: "element",
                tagName: "a",
                properties: {
                  href: src,
                  target: "_blank",
                  rel: ["noopener", "noreferrer"],
                  className: ["pdf-btn", "pdf-open"],
                  "aria-label": "新しいタブで開く",
                  title: "新しいタブで開く",
                },
                children: [iconifyIcon("material-symbols:open-in-new")],
              },
            ],
          },
        ],
      },
      // ページ描画領域 (JS 初期化後に表示)
      {
        type: "element",
        tagName: "div",
        properties: { className: ["pdf-pages"], hidden: true },
        children: [],
      },
      // JS 無効/失敗時のフォールバック
      {
        type: "element",
        tagName: "div",
        properties: { className: ["pdf-fallback"] },
        children: [
          {
            type: "element",
            tagName: "a",
            properties: {
              href: src,
              target: "_blank",
              rel: ["noopener", "noreferrer"],
              className: ["pdf-link"],
            },
            children: [
              iconifyIcon("material-symbols:picture-as-pdf", "32"),
              {
                type: "element",
                tagName: "span",
                properties: { className: ["pdf-link-label"] },
                children: [{ type: "text", value: label }],
              },
              {
                type: "element",
                tagName: "span",
                properties: { className: ["pdf-link-hint"] },
                children: [{ type: "text", value: "タップして PDF を開く" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildYouTube(src, alt) {
  const videoId = getYouTubeId(src);
  if (!videoId) return null;
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["youtube-embed"] },
    children: [
      {
        type: "element",
        tagName: "iframe",
        properties: {
          src: `https://www.youtube-nocookie.com/embed/${videoId}`,
          width: "100%",
          height: "400",
          frameBorder: "0",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowFullscreen: true,
          style: "border: none; border-radius: 8px; aspect-ratio: 16/9;",
          title: alt || "YouTube Video",
        },
        children: [],
      },
    ],
  };
}

function buildTwitter(src) {
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["twitter-embed"] },
    children: [
      {
        type: "element",
        tagName: "blockquote",
        properties: { className: ["twitter-tweet"], dataTheme: "dark" },
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: src },
            children: [{ type: "text", value: "Tweet" }],
          },
        ],
      },
      {
        type: "element",
        tagName: "script",
        properties: {
          async: true,
          src: "https://platform.twitter.com/widgets.js",
          charSet: "utf-8",
        },
        children: [],
      },
    ],
  };
}

// メインプラグイン

export default function rehypeMedia() {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "img") return;

      const src = node.properties?.src ?? "";
      const alt = node.properties?.alt ?? "";
      if (!src) return;

      const type = resolveType(src, node.properties ?? {});

      let replacement = null;

      switch (type) {
        case "video":
          replacement = buildVideo(src, alt);
          break;
        case "audio":
          replacement = buildAudio(src);
          break;
        case "pdf":
          replacement = buildPdf(src, alt);
          break;
        case "youtube":
          replacement = buildYouTube(src, alt);
          break;
        case "twitter":
        case "x":
          replacement = buildTwitter(src);
          break;
        default:
          // Plain image — leave the <img> as-is
          return;
      }

      if (replacement) {
        parent.children[index] = replacement;
      }
    });
  };
}
