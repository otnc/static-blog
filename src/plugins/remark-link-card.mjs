/**
 * remark: @[](url) 構文で OGP リンクカードを埋め込み
 * ビルド時に OGP メタデータを取得してリッチカードを生成。
 * ローカル記事リンク (/article/xxx) はファイルシステムから直接読み取り。
 */
import fs from "fs";
import path from "path";
import { visit } from "unist-util-visit";
import matter from "gray-matter";
import he from "he";
import { load as cheerioLoad } from "cheerio";

// ビルド時メモリキャッシュ（同一ビルド内での重複フェッチ防止）
const ogpCache = new Map();

// ---- OGP のローカル専用永続ディスクキャッシュ ----
// 目的: ローカルの dev / build で外部 OGP の再取得（1件5秒タイムアウト）を避けて高速化する。
// 重要: CI ではバイパスし常にライブ取得するため、デプロイ成果物の挙動は一切変わらない。
//       失敗(null)はキャッシュしない（次回再取得）。`OGP_CACHE=0` で一時無効化可能。
const DISK_CACHE_ENABLED =
  !process.env.CI && process.env.OGP_CACHE !== "0";
const DISK_CACHE_PATH = path.resolve(process.cwd(), ".cache/ogp.json");
const diskCache = new Map();

if (DISK_CACHE_ENABLED) {
  try {
    const raw = fs.readFileSync(DISK_CACHE_PATH, "utf8");
    for (const [k, v] of Object.entries(JSON.parse(raw))) diskCache.set(k, v);
  } catch {
    // キャッシュ未作成 or 破損時は無視（空から開始）
  }
}

function persistDiskCache() {
  try {
    fs.mkdirSync(path.dirname(DISK_CACHE_PATH), { recursive: true });
    // U+2028(LS)/U+2029(PS) はJSONとして正当だがエディタが警告を出すためエスケープ。
    // パース結果は同一。
    const json = JSON.stringify(Object.fromEntries(diskCache))
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    fs.writeFileSync(DISK_CACHE_PATH, json);
  } catch {
    // 書き込み失敗は致命的でないため無視
  }
}

// サイトオリジン取得
function resolveSiteOrigin() {
  const fromEnv =
    (typeof process !== "undefined" && process.env.SITE) ||
    (typeof import.meta !== "undefined" && import.meta.env?.SITE);
  if (fromEnv) return fromEnv;

  try {
    const configPath = path.resolve(process.cwd(), "astro.config.mjs");
    const configText = fs.readFileSync(configPath, "utf8");
    const match = configText.match(/\bsite\s*:\s*["']([^"']+)["']/);
    if (match) return match[1];
  } catch {
    // ignore
  }

  return "";
}

const SITE_ORIGIN = resolveSiteOrigin();

// ローカル記事メタデータのキャッシュ
const localArticleCache = new Map();

/** consts.ts から SITE_TITLE を取得 */
function resolveSiteTitle() {
  try {
    const constsPath = path.resolve(process.cwd(), "src/consts.ts");
    const text = fs.readFileSync(constsPath, "utf8");
    const m = text.match(/SITE_TITLE\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

const SITE_TITLE_VALUE = resolveSiteTitle();

/**
 * ローカルの /article/{slug} パスから記事メタデータを直接取得。
 * HTTP 不要で GitHub Actions 上でも確実に動作。
 */
function resolveLocalArticle(localPath) {
  if (localArticleCache.has(localPath)) return localArticleCache.get(localPath);

  // /article/{slug} or /article/{slug}/ からスラッグを抽出
  const slugMatch = localPath.match(/^\/(article|blog)\/([^/]+)\/?$/);
  if (!slugMatch) {
    localArticleCache.set(localPath, null);
    return null;
  }

  const slug = slugMatch[2];
  const contentDir = path.resolve(process.cwd(), "src/content/blog");

  // .mdx or .md を探す
  let filePath = null;
  for (const ext of [".mdx", ".md"]) {
    const candidate = path.join(contentDir, `${slug}${ext}`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    localArticleCache.set(localPath, null);
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data } = matter(raw);

    const result = {
      title: data.title || slug,
      description: data.description || "",
      image: `/og/${slug}.png`,
      siteName: SITE_TITLE_VALUE || "Blog",
    };

    localArticleCache.set(localPath, result);
    return result;
  } catch {
    localArticleCache.set(localPath, null);
    return null;
  }
}

// ヘルパー

/** HTML から <meta> の content 値を抽出（cheerio で DOM パース） */
function getMeta($, ...properties) {
  for (const prop of properties) {
    const value =
      $(`meta[property="${prop}"]`).attr("content") ??
      $(`meta[name="${prop}"]`).attr("content");
    if (value != null) return value.trim();
  }
  return null;
}

/** レスポンスから <head> 部分のみを読み取る（最大 32KB） */
async function readHead(res) {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const decoder = new TextDecoder();
  let html = "";
  const MAX_BYTES = 32 * 1024;
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      html += decoder.decode(value, { stream: true });
      // </head> を見つけたら残りは不要
      if (/<\/head>/i.test(html)) break;
      if (totalBytes >= MAX_BYTES) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return html;
}

async function fetchOgp(url) {
  if (ogpCache.has(url)) return ogpCache.get(url);

  // ローカル永続キャッシュにヒットすればネットへ行かない（CI では無効）
  if (DISK_CACHE_ENABLED && diskCache.has(url)) {
    const cached = diskCache.get(url);
    ogpCache.set(url, cached);
    return cached;
  }

  // 同一 URL の並行フェッチを防止（Promise を共有）
  const promise = _doFetchOgp(url);
  ogpCache.set(url, promise);
  const result = await promise;
  ogpCache.set(url, result);

  // 成功結果のみローカルへ永続化（失敗 null は保存せず次回再取得）
  if (DISK_CACHE_ENABLED && result) {
    diskCache.set(url, result);
    persistDiskCache();
  }
  return result;
}

async function _doFetchOgp(url) {
  let result = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkCard/1.0)",
        Accept: "text/html,application/xhtml+xml",
        // Range ヘッダーで先頭部分のみリクエスト（対応サーバーのみ）
        Range: "bytes=0-32767",
      },
    });
    clearTimeout(timer);

    if (!res.ok && res.status !== 206) {
      return null;
    }

    // レスポンスをストリーミングで読み、</head> を検出したら打ち切り
    const html = await readHead(res);
    const $ = cheerioLoad(html);

    const title =
      getMeta($, "og:title", "twitter:title") ??
      ($("title").first().text().trim() || url);

    const description =
      getMeta($, "og:description", "twitter:description", "description") ?? "";

    const image =
      getMeta($, "og:image", "og:image:secure_url", "twitter:image") ?? null;

    const siteName =
      getMeta($, "og:site_name") ??
      (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

    result = {
      title: he.decode(title),
      description: he.decode(description),
      image,
      siteName: he.decode(siteName),
    };
  } catch {
    result = null;
  }

  ogpCache.set(url, result);
  return result;
}

// カードビルダー

/**
 * mdxJsxFlowElement ノードを構築。
 * @astrojs/mdx が remark プラグインから受け付ける唯一の HTML 注入方法。
 */
function jsxAttr(name, value) {
  return { type: "mdxJsxAttribute", name, value: String(value) };
}

function jsxElem(name, attrPairs, children) {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: (attrPairs ?? []).map(([n, v]) => jsxAttr(n, v)),
    children: children ?? [],
  };
}

function buildCard(ogp, url, customLabel) {
  const title = customLabel || ogp?.title || url;
  const description = ogp?.description?.trim() || "";
  const image = ogp?.image || null;
  const siteName =
    ogp?.siteName ||
    (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();

  const t = (val) => ({ type: "text", value: val });

  const textChildren = [
    jsxElem("p", [["class", "link-card-title"]], [t(title)]),
    ...(description
      ? [jsxElem("p", [["class", "link-card-description"]], [t(description)])]
      : []),
    jsxElem("p", [["class", "link-card-sitename"]], [t(siteName)]),
  ];

  const imgElem = image
    ? jsxElem("img", [
        ["class", "link-card-image"],
        ["src", image],
        ["alt", ""],
        ["loading", "lazy"],
        ["decoding", "async"],
      ])
    : jsxElem("div", [["class", "link-card-image link-card-image--none"]]);

  return jsxElem(
    "a",
    [
      ["class", "link-card"],
      ["href", url],
      ["target", "_blank"],
      ["rel", "noopener noreferrer"],
    ],
    [
      jsxElem(
        "div",
        [["class", "link-card-body"]],
        [jsxElem("div", [["class", "link-card-text"]], textChildren), imgElem],
      ),
    ],
  );
}

// ヘルパー: paragraph 分割

/** break ノードで行に分割 */
function splitByBreaks(children) {
  const lines = [];
  let current = [];
  for (const child of children) {
    if (child.type === "break") {
      lines.push(current);
      current = [];
    } else {
      current.push(child);
    }
  }
  lines.push(current);
  return lines;
}

/** @[...](url) パターンにマッチするか */
function isCardLine(line) {
  const m = line.filter((c) => !(c.type === "text" && c.value === ""));
  return (
    m.length === 2 &&
    m[0].type === "text" &&
    m[0].value === "@" &&
    m[1].type === "link" && // remote URLs or local site paths
    (m[1].url.startsWith("http") || m[1].url.startsWith("/"))
  );
}

function getCardInfo(line) {
  const m = line.filter((c) => !(c.type === "text" && c.value === ""));
  const link = m[1];
  const label =
    link.children
      .filter((c) => c.type === "text")
      .map((c) => c.value)
      .join("") || null;
  return { url: link.url, label };
}

function resolveUrlForOgp(url) {
  if (url.startsWith("/")) {
    const origin = SITE_ORIGIN.endsWith("/")
      ? SITE_ORIGIN.slice(0, -1)
      : SITE_ORIGIN;
    return `${origin}${url}`;
  }
  return url;
}

// メインプラグイン

export default function remarkLinkCard() {
  return async (tree) => {
    const tasks = [];

    visit(tree, "paragraph", (node, index, parent) => {
      if (!parent || index == null) return;

      const lines = splitByBreaks(node.children);

      // Skip paragraphs with no card lines
      if (!lines.some(isCardLine)) return;

      // Build segments: {type:"card", url, label} | {type:"text", nodes[]}
      const segments = lines.map((line) => {
        if (isCardLine(line)) {
          return { type: "card", ...getCardInfo(line) };
        }
        const hasContent = line.some(
          (c) => !(c.type === "text" && c.value.trim() === ""),
        );
        return { type: "text", nodes: line, hasContent };
      });

      tasks.push({ node, parent, segments });
    });

    await Promise.all(
      tasks.map(async ({ node, parent, segments }) => {
        const replacements = [];
        let textBuffer = []; // accumulate consecutive text-lines

        const flushText = () => {
          if (textBuffer.length === 0) return;
          const paraChildren = [];
          for (let i = 0; i < textBuffer.length; i++) {
            if (i > 0) paraChildren.push({ type: "break" });
            paraChildren.push(...textBuffer[i]);
          }
          replacements.push({ type: "paragraph", children: paraChildren });
          textBuffer = [];
        };

        for (const seg of segments) {
          if (seg.type === "card") {
            flushText();
            const isRemote = seg.url.startsWith("http");
            const isLocal = seg.url.startsWith("/");

            let ogp;
            if (isLocal) {
              // ローカル記事はファイルシステムから直接取得（HTTP 不要）
              ogp = resolveLocalArticle(seg.url);
              if (!ogp && SITE_ORIGIN) {
                // ファイルが見つからない場合は HTTP フォールバック
                ogp = await fetchOgp(resolveUrlForOgp(seg.url));
              }
            } else {
              ogp = await fetchOgp(seg.url);
            }

            replacements.push(buildCard(ogp, seg.url, seg.label));
          } else if (seg.hasContent) {
            textBuffer.push(seg.nodes);
          }
        }
        flushText();

        const i = parent.children.indexOf(node);
        if (i !== -1) parent.children.splice(i, 1, ...replacements);
      }),
    );
  };
}
