#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pug from "pug";
import kuromoji from "kuromoji";
import { toRomaji } from "wanakana";
import {
  compressUpload,
  compressPng,
  recompress,
} from "./lib/compress-image.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const blogDir = path.join(rootDir, "src", "content", "blog");
const publicFilesDir = path.join(rootDir, "public", "files");
const uiDir = path.join(__dirname, "upload-file");
const assetsDir = path.join(uiDir, "assets");
const layoutPath = path.join(uiDir, "layout.pug");

// 12630 (thumbnail) の隣。Astro (4321) などとも非衝突。
const SERVER_PORT = 12631;

// 記事 ID と同じ文字制限 (create-article.mjs / src/content.config.ts)
const NAME_FULL_RE = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
const FOLDER_RE = /^[a-z0-9_-]{1,32}$/;

// sharp が読める静止画形式 (拡張子ベース)
const SHARP_STATIC_EXTS = [
  ".png",
  ".apng",
  ".jpg",
  ".jpeg",
  ".jpe", // JPEG 別拡張子
  ".jfif", // JPEG File Interchange Format
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
];
// heic-convert で扱う形式
const HEIC_EXTS = [".heic", ".heif"];
const IMAGE_EXTS = [...SHARP_STATIC_EXTS, ...HEIC_EXTS];

// 動画形式
const VIDEO_EXTS = [
  // Web 標準 / モダン
  ".mp4",
  ".m4v",
  ".webm",
  // Apple QuickTime
  ".mov",
  // AVI / Windows
  ".avi",
  ".wmv",
  ".asf",
  // Matroska
  ".mkv",
  // Flash (レガシー)
  ".flv",
  ".f4v",
  // AVCHD カメラ
  ".mts",
  ".m2ts",
  // MPEG-2 TS
  ".ts",
  // OGG
  ".ogv",
  // モバイル
  ".3gp",
  // DVD
  ".vob",
  // RealMedia (レガシー)
  ".rm",
  ".rmvb",
];
// 音声形式
const AUDIO_EXTS = [
  // Web 標準 / モダン
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  // MPEG-4 系
  ".m4a",
  ".m4b",
  // AAC / Windows
  ".aac",
  ".wma",
  // Apple
  ".aiff",
  ".aif",
  ".caf",
  // ロスレス
  ".flac",
  // MIDI
  ".mid",
  ".midi",
  // モバイル録音
  ".amr",
];
const PDF_EXTS = [".pdf"];

const MIME_BY_EXT = {
  // image
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jpe": "image/jpeg",
  ".jfif": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // video
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".asf": "video/x-ms-asf",
  ".mkv": "video/x-matroska",
  ".flv": "video/x-flv",
  ".f4v": "video/x-f4v",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ts": "video/mp2t",
  ".ogv": "video/ogg",
  ".3gp": "video/3gpp",
  ".vob": "video/dvd",
  ".rm": "application/vnd.rn-realmedia",
  ".rmvb": "application/vnd.rn-realmedia-vbr",
  // audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".caf": "audio/x-caf",
  ".flac": "audio/flac",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".amr": "audio/amr",
  // pdf
  ".pdf": "application/pdf",
};

const compileLayout = pug.compileFile(layoutPath, {
  basedir: uiDir,
  pretty: false,
});

function getCurrentBranchArticleId() {
  try {
    const branch = execSync("git branch --show-current", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    const m = branch.match(/^article\/(.+)$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function resolveArticleId(argv) {
  const explicit = argv[2];
  if (explicit) return explicit;
  const branchId = getCurrentBranchArticleId();
  if (!branchId) {
    throw new Error(
      "記事IDが指定されておらず、現在のブランチも 'article/<id>' 形式ではありません。\n" +
        "  使い方: pnpm file <id>  または  article/<id> ブランチに切り替えてください。",
    );
  }
  return branchId;
}

function mimeOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function kindOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (PDF_EXTS.includes(ext)) return "pdf";
  return "other";
}

// ---------- 日本語 → ローマ字 ----------

const KUROMOJI_DICT_PATH = path.join(
  rootDir,
  "node_modules",
  "kuromoji",
  "dict",
);

let _kuromojiTokenizer = null;
function loadKuromoji() {
  if (_kuromojiTokenizer) return Promise.resolve(_kuromojiTokenizer);
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build((err, t) => {
      if (err) reject(err);
      else {
        _kuromojiTokenizer = t;
        resolve(t);
      }
    });
  });
}

// CJK統合漢字 / ひらがな / カタカナ / 全角英数記号
const HAS_JAPANESE_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿＀-￯]/;

/**
 * 日本語混じり文字列をローマ字に変換する。
 * - kuromoji で形態素解析し、各形態素の reading (カタカナ) を wanakana でローマ字化
 * - 連続する日本語形態素はハイフンで区切る (yama-no-shashin)
 * - 非日本語部分 (ASCII, 数字, 記号) はそのまま温存し、後段の sanitize に委ねる
 */
// ひらがな / カタカナ / 半角カタカナ のみで構成された文字列
const KANA_ONLY_RE = /^[぀-ゟ゠-ヿｦ-ﾟ]+$/;

async function japaneseToRomaji(text) {
  // 半角カタカナを全角に揃えておく (wanakana が確実に処理できる)
  const normalized = text.normalize("NFKC");
  if (!HAS_JAPANESE_RE.test(normalized)) return normalized;
  const tokenizer = await loadKuromoji();
  const tokens = tokenizer.tokenize(normalized);
  let out = "";
  let prevIsJp = false;
  for (const t of tokens) {
    const reading = t.reading && t.reading !== "*" ? t.reading : null;
    let romaji = null;
    if (reading) {
      romaji = toRomaji(reading);
    } else if (KANA_ONLY_RE.test(t.surface_form)) {
      // 辞書外のカタカナ語 (例: 外来語の固有名詞) を救う
      romaji = toRomaji(t.surface_form);
    }
    if (romaji) {
      if (prevIsJp) out += "-";
      out += romaji;
      prevIsJp = true;
    } else {
      out += t.surface_form;
      prevIsJp = false;
    }
  }
  return out;
}

function isHeic(buffer) {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("ascii");
  return [
    "heic",
    "heix",
    "hevc",
    "hevx",
    "mif1",
    "msf1",
    "heim",
    "heis",
  ].includes(brand);
}

/**
 * 入力文字列を最終的に [a-zA-Z0-9_-]+ に正規化する共通処理。
 * - 日本語が含まれていれば kuromoji + wanakana でローマ字化
 * - 空白を `-` に置換
 * - 許可外文字を削除
 * - 連続するハイフン/アンダースコアを 1 つにまとめ、両端をトリム
 */
async function normalizeToBaseName(text) {
  const romanized = await japaneseToRomaji(String(text ?? "").normalize("NFC"));
  return (
    romanized
      // NFD decompose → strip combining diacritics (é→e, è→e, ü→u, ñ→n …)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/[-_]{2,}/g, (m) => m[0])
      .replace(/^[-_]+|[-_]+$/g, "")
  );
}

/**
 * アップロード用のファイル名サニタイズ。
 * 日本語はローマ字化、許可外文字は除去。空になった場合は null。
 */
async function sanitizeUploadName(originalName, fallbackExt) {
  const raw = String(originalName ?? "");
  const ext = path.extname(raw).toLowerCase();
  const stem = path.basename(raw, ext);
  const base = await normalizeToBaseName(stem);
  if (!base) return null;
  return base + (fallbackExt || ext);
}

/**
 * リネーム用の正規化。日本語入力もローマ字化して許容する。
 * 戻り値: { name: '正規化後の name.ext', changed: 元と異なれば true } または null
 */
async function normalizeRenameName(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const ext = path.extname(trimmed).toLowerCase();
  const stem = path.basename(trimmed, ext);
  if (!ext || !/^\.[a-zA-Z0-9]+$/.test(ext)) return null;
  const base = await normalizeToBaseName(stem);
  if (!base) return null;
  const result = base + ext;
  return { name: result, changed: result !== trimmed };
}

/** 既存ファイル参照用 (古い不正名も含めて受け付ける) */
function sanitizeExistingName(name) {
  const cleaned = String(name ?? "")
    .normalize("NFC")
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned;
}

function resolveSafe(articleDir, name) {
  const sanitized = sanitizeExistingName(name);
  if (!sanitized) return null;
  const full = path.resolve(articleDir, sanitized);
  const relativePath = path.relative(articleDir, full);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return full;
}

function resolveInFolder(baseDir, folder, name) {
  if (!folder) return resolveSafe(baseDir, name);
  if (!FOLDER_RE.test(folder)) return null;
  return resolveSafe(path.join(baseDir, folder), name);
}

/**
 * 画像の前処理。アップロード時は静止画をすべて PNG に変換する
 * (新規ファイルなので拡張子が変わっても記事参照に影響しない):
 *  - HEIC/HEIF → heic-convert で PNG にして再圧縮
 *  - SVG       → ベクタなのでそのまま (ラスタ化しない)
 *  - その他    → scripts/lib/compress-image.mjs の compressUpload に委譲
 *      - 静止画 (JPEG/PNG/WebP/AVIF/BMP/TIFF/静止 GIF) は PNG に変換
 *      - アニメ (GIF/APNG/animated WebP) だけは元形式を保持
 */
async function processImage(buffer, originalExt) {
  const lowerExt = originalExt.toLowerCase();
  if (HEIC_EXTS.includes(lowerExt) || isHeic(buffer)) {
    const heicConvert = (await import("heic-convert")).default;
    const png = Buffer.from(await heicConvert({ buffer, format: "PNG" }));
    const compressed = await recompress(png, ".png");
    return { buffer: compressed ?? png, ext: ".png" };
  }
  if (lowerExt === ".svg") {
    return { buffer, ext: ".svg" };
  }
  try {
    return await compressUpload(buffer, lowerExt);
  } catch (err) {
    throw new Error(`画像として処理できません: ${err.message}`);
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return { files: [], folders: [] };
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const sub = path.join(dir, e.name);
      let fileCount = 0;
      try {
        fileCount = fs
          .readdirSync(sub)
          .filter((f) => fs.statSync(path.join(sub, f)).isFile()).length;
      } catch {
        /* ignore */
      }
      return { name: e.name, kind: "folder", fileCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(dir, e.name);
      const stat = fs.statSync(full);
      return {
        name: e.name,
        size: stat.size,
        mtime: stat.mtimeMs,
        ext: path.extname(e.name).toLowerCase(),
        mime: mimeOf(e.name),
        kind: kindOf(e.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return { files, folders };
}

function uniqueName(articleDir, desired) {
  const ext = path.extname(desired);
  const base = path.basename(desired, ext);
  let candidate = desired;
  let i = 1;
  while (fs.existsSync(path.join(articleDir, candidate))) {
    candidate = `${base}-${i}${ext}`;
    i++;
  }
  return candidate;
}

function readBody(req, maxBytes = 500 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (c) => {
      length += c.length;
      if (length > maxBytes) {
        reject(new Error(`リクエストが大きすぎます (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
  });
  res.end(data);
}

function sendFile(res, filePath, mime) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(filePath).pipe(res);
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("不正な dataURL です");
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        shell: false,
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* user can open manually */
  }
}

const cropperCssPath = path.join(
  rootDir,
  "node_modules",
  "cropperjs",
  "dist",
  "cropper.min.css",
);
const cropperJsPath = path.join(
  rootDir,
  "node_modules",
  "cropperjs",
  "dist",
  "cropper.min.js",
);
const dayjsPath = path.join(rootDir, "node_modules", "dayjs", "dayjs.min.js");
const dayjsUtcPath = path.join(
  rootDir,
  "node_modules",
  "dayjs",
  "plugin",
  "utc.js",
);
const dayjsTzPath = path.join(
  rootDir,
  "node_modules",
  "dayjs",
  "plugin",
  "timezone.js",
);

const JS_MIME = "application/javascript; charset=utf-8";
const STATIC_ROUTES = {
  "/uploader.css": [
    path.join(assetsDir, "uploader.css"),
    "text/css; charset=utf-8",
  ],
  "/uploader.js": [path.join(assetsDir, "uploader.js"), JS_MIME],
  "/cropper.css": [cropperCssPath, "text/css; charset=utf-8"],
  "/cropper.js": [cropperJsPath, JS_MIME],
  "/dayjs.js": [dayjsPath, JS_MIME],
  "/dayjs-utc.js": [dayjsUtcPath, JS_MIME],
  "/dayjs-timezone.js": [dayjsTzPath, JS_MIME],
};

async function handleUpload(articleDir, payload) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const results = [];
  for (const f of files) {
    const originalName = String(f.name ?? "untitled");
    const originalExt = path.extname(originalName).toLowerCase();
    try {
      const { buffer } = dataUrlToBuffer(f.dataUrl);
      const kind = kindOf(originalName);

      let outBuffer = buffer;
      let outExt = originalExt;

      if (kind === "image") {
        const processed = await processImage(buffer, originalExt);
        outBuffer = processed.buffer;
        outExt = processed.ext;
      } else if (kind === "video" || kind === "audio" || kind === "pdf") {
        // そのまま保存。拡張子だけ正規化 (.JPG → .jpg 等)
        outExt = originalExt;
      } else {
        results.push({
          ok: false,
          originalName,
          error: `対応していない形式です (${originalExt || "拡張子なし"})`,
        });
        continue;
      }

      const sanitized = await sanitizeUploadName(originalName, outExt);
      const desired =
        sanitized || `${kind}-${Date.now().toString(36)}${outExt}`;
      const finalName = uniqueName(articleDir, desired);
      fs.writeFileSync(path.join(articleDir, finalName), outBuffer);
      console.log(
        `[upload:${kind}] ${finalName} (${outBuffer.length} bytes, from ${originalName})`,
      );
      results.push({ ok: true, name: finalName, kind, originalName });
    } catch (err) {
      console.error(`[upload error]`, originalName, err);
      results.push({
        ok: false,
        originalName,
        error: String(err?.message ?? err),
      });
    }
  }
  return results;
}

async function main() {
  const id = resolveArticleId(process.argv);

  const mdxPath = path.join(blogDir, `${id}.mdx`);
  const mdPath = path.join(blogDir, `${id}.md`);
  if (!fs.existsSync(mdxPath) && !fs.existsSync(mdPath)) {
    console.error(`エラー: 記事が見つかりません: ${mdxPath}`);
    process.exit(1);
  }

  const articleDir = path.join(publicFilesDir, id);
  fs.mkdirSync(articleDir, { recursive: true });

  console.log(`[記事ID] ${id}`);
  console.log(
    `[管理先] ${path.relative(rootDir, articleDir).replace(/\\/g, "/")}/`,
  );

  // kuromoji 辞書を先読み (初回 ~1s)。失敗してもサーバは起動し、
  // 日本語が来たときだけリトライ・エラーになるようにする。
  loadKuromoji()
    .then(() => console.log("[kuromoji] 辞書ロード完了 (日本語ファイル名対応)"))
    .catch((err) =>
      console.error("[kuromoji] 辞書ロード失敗:", err?.message ?? err),
    );

  let sseClients = 0;
  let shutdownTimer = null;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") {
        const configJson = JSON.stringify({
          articleId: id,
          urlPrefix: `/files/${id}`,
          nameRule: NAME_FULL_RE.source,
        }).replace(/</g, "\\u003c");
        const html = compileLayout({ articleId: id, configJson });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && STATIC_ROUTES[url.pathname]) {
        const [filePath, mime] = STATIC_ROUTES[url.pathname];
        sendFile(res, filePath, mime);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/files") {
        const qid = url.searchParams.get("id");
        const subfolder = url.searchParams.get("subfolder");
        let targetDir = articleDir;
        if (qid !== null) {
          if (!/^[a-zA-Z0-9_-]+$/.test(qid)) {
            sendJson(res, 400, { error: "不正な記事IDです" });
            return;
          }
          targetDir = path.join(publicFilesDir, qid);
        }
        if (subfolder !== null) {
          if (!FOLDER_RE.test(subfolder)) {
            sendJson(res, 400, { error: "不正なフォルダ名です" });
            return;
          }
          const { files } = listFiles(path.join(targetDir, subfolder));
          sendJson(res, 200, { files, folders: [] });
          return;
        }
        sendJson(res, 200, listFiles(targetDir));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/articles") {
        const entries = fs.existsSync(publicFilesDir)
          ? fs
              .readdirSync(publicFilesDir, { withFileTypes: true })
              .filter((e) => e.isDirectory() && e.name !== id)
              .map((e) => {
                const dir = path.join(publicFilesDir, e.name);
                const count = fs
                  .readdirSync(dir)
                  .filter((f) =>
                    fs.statSync(path.join(dir, f)).isFile(),
                  ).length;
                return { id: e.name, fileCount: count };
              })
              .sort((a, b) => a.id.localeCompare(b.id))
          : [];
        sendJson(res, 200, { articles: entries });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/file") {
        const qid = url.searchParams.get("id");
        const name = url.searchParams.get("name");
        const qfolder = url.searchParams.get("folder") || "";
        let targetDir = articleDir;
        if (qid !== null) {
          if (!/^[a-zA-Z0-9_-]+$/.test(qid)) {
            sendJson(res, 400, { error: "不正な記事IDです" });
            return;
          }
          targetDir = path.join(publicFilesDir, qid);
        }
        const full = resolveInFolder(targetDir, qfolder, name);
        if (!full || !fs.existsSync(full)) {
          sendJson(res, 404, { error: "ファイルが見つかりません" });
          return;
        }
        sendFile(res, full, mimeOf(full));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/upload") {
        const body = await readBody(req);
        const payload = JSON.parse(body.toString("utf-8"));
        const results = await handleUpload(articleDir, payload);
        sendJson(res, 200, { results });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rename") {
        const body = await readBody(req);
        const {
          from,
          to,
          folder: reqFolder = "",
        } = JSON.parse(body.toString("utf-8"));
        const workDir = reqFolder
          ? FOLDER_RE.test(reqFolder)
            ? path.join(articleDir, reqFolder)
            : null
          : articleDir;
        if (!workDir) {
          sendJson(res, 400, { error: "不正なフォルダ名です" });
          return;
        }
        const src = resolveSafe(workDir, from);
        if (!src) {
          sendJson(res, 400, { error: "不正な元ファイル名です" });
          return;
        }
        if (!fs.existsSync(src)) {
          sendJson(res, 404, { error: "リネーム元が存在しません" });
          return;
        }
        const norm = await normalizeRenameName(to);
        if (!norm) {
          sendJson(res, 400, {
            error:
              "ファイル名から有効な英数字を抽出できませんでした (拡張子も必要です)",
          });
          return;
        }
        const dst = path.join(workDir, norm.name);
        if (fs.existsSync(dst) && dst !== src) {
          sendJson(res, 409, { error: `'${norm.name}' は既に存在します` });
          return;
        }
        fs.renameSync(src, dst);
        console.log(
          `[rename] ${reqFolder ? reqFolder + "/" : ""}${path.basename(src)} -> ${norm.name}${norm.changed ? " (normalized)" : ""}`,
        );
        sendJson(res, 200, {
          ok: true,
          name: norm.name,
          folder: reqFolder,
          changed: norm.changed,
          requested: to,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/save-edit") {
        const body = await readBody(req);
        const {
          name,
          dataUrl,
          folder: reqFolder = "",
        } = JSON.parse(body.toString("utf-8"));
        const workDir = reqFolder
          ? FOLDER_RE.test(reqFolder)
            ? path.join(articleDir, reqFolder)
            : null
          : articleDir;
        if (!workDir) {
          sendJson(res, 400, { error: "不正なフォルダ名です" });
          return;
        }
        const src = resolveSafe(workDir, name);
        if (!src) {
          sendJson(res, 400, { error: "不正なファイル名です" });
          return;
        }
        if (!fs.existsSync(src)) {
          sendJson(res, 404, { error: "ファイルが見つかりません" });
          return;
        }
        const { buffer } = dataUrlToBuffer(dataUrl);
        // 編集結果 (canvas 由来の非圧縮寄り PNG) をパレット量子化で軽量化する
        const png = await compressPng(buffer);
        const base = path.basename(src, path.extname(src));
        const outPath = path.join(workDir, `${base}.png`);
        fs.writeFileSync(outPath, png);
        if (outPath !== src) fs.unlinkSync(src);
        const outName = path.basename(outPath);
        console.log(
          `[edit-save] ${reqFolder ? reqFolder + "/" : ""}${path.basename(src)} -> ${outName} (${png.length} bytes)`,
        );
        sendJson(res, 200, { ok: true, name: outName, folder: reqFolder });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/to-png") {
        const body = await readBody(req);
        const { name, folder: reqFolder = "" } = JSON.parse(
          body.toString("utf-8"),
        );
        const workDir = reqFolder
          ? FOLDER_RE.test(reqFolder)
            ? path.join(articleDir, reqFolder)
            : null
          : articleDir;
        if (!workDir) {
          sendJson(res, 400, { error: "不正なフォルダ名です" });
          return;
        }
        const src = resolveSafe(workDir, name);
        if (!src) {
          sendJson(res, 400, { error: "不正なファイル名です" });
          return;
        }
        if (!fs.existsSync(src)) {
          sendJson(res, 404, { error: "ファイルが見つかりません" });
          return;
        }
        const srcExt = path.extname(src).toLowerCase();
        if (srcExt === ".png") {
          sendJson(res, 400, { error: "すでに PNG です" });
          return;
        }
        if (!IMAGE_EXTS.includes(srcExt)) {
          sendJson(res, 400, { error: "画像ファイルではありません" });
          return;
        }
        const srcBuffer = fs.readFileSync(src);
        let png;
        try {
          if (HEIC_EXTS.includes(srcExt) || isHeic(srcBuffer)) {
            const heicConvert = (await import("heic-convert")).default;
            png = Buffer.from(
              await heicConvert({ buffer: srcBuffer, format: "PNG" }),
            );
          } else {
            const meta = await sharp(srcBuffer, { animated: true })
              .metadata()
              .catch(() => null);
            const animated = meta ? (meta.pages ?? 1) > 1 : false;
            // アニメは APNG として変換し、アニメーションを保持する。
            // 静止画はパレット量子化で軽量な PNG にする。
            png = animated
              ? await sharp(srcBuffer, { animated: true })
                  .png({ compressionLevel: 9, adaptiveFiltering: true })
                  .toBuffer()
              : await compressPng(srcBuffer);
          }
        } catch (err) {
          sendJson(res, 500, {
            error: "PNG 変換に失敗しました: " + String(err?.message ?? err),
          });
          return;
        }
        const base = path.basename(src, path.extname(src));
        const outName = uniqueName(workDir, `${base}.png`);
        const outPath = path.join(workDir, outName);
        fs.writeFileSync(outPath, png);
        if (outPath !== src) fs.unlinkSync(src);
        console.log(
          `[to-png] ${reqFolder ? reqFolder + "/" : ""}${path.basename(src)} -> ${outName} (${png.length} bytes)`,
        );
        sendJson(res, 200, { ok: true, name: outName, folder: reqFolder });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/delete") {
        const body = await readBody(req);
        const { name, folder: reqFolder = "" } = JSON.parse(
          body.toString("utf-8"),
        );
        const workDir = reqFolder
          ? FOLDER_RE.test(reqFolder)
            ? path.join(articleDir, reqFolder)
            : null
          : articleDir;
        if (!workDir) {
          sendJson(res, 400, { error: "不正なフォルダ名です" });
          return;
        }
        const full = resolveSafe(workDir, name);
        if (!full) {
          sendJson(res, 400, { error: "不正なファイル名です" });
          return;
        }
        if (!fs.existsSync(full)) {
          sendJson(res, 404, { error: "ファイルが見つかりません" });
          return;
        }
        fs.unlinkSync(full);
        console.log(
          `[delete] ${reqFolder ? reqFolder + "/" : ""}${path.basename(full)}`,
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/mkdir") {
        const body = await readBody(req);
        const { name } = JSON.parse(body.toString("utf-8"));
        if (!FOLDER_RE.test(name)) {
          sendJson(res, 400, {
            error:
              "フォルダ名は半角英小文字・数字・ハイフン・アンダースコア (最大32文字) のみ使用できます",
          });
          return;
        }
        const newDir = path.join(articleDir, name);
        if (fs.existsSync(newDir)) {
          sendJson(res, 409, { error: `'${name}' は既に存在します` });
          return;
        }
        fs.mkdirSync(newDir);
        console.log(`[mkdir] ${name}`);
        sendJson(res, 200, { ok: true, name });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/move") {
        const body = await readBody(req);
        const {
          name,
          folder: srcFolder = "",
          targetFolder = "",
        } = JSON.parse(body.toString("utf-8"));
        if (srcFolder && !FOLDER_RE.test(srcFolder)) {
          sendJson(res, 400, { error: "不正な移動元フォルダ名です" });
          return;
        }
        if (targetFolder && !FOLDER_RE.test(targetFolder)) {
          sendJson(res, 400, { error: "不正な移動先フォルダ名です" });
          return;
        }
        const srcDir = srcFolder
          ? path.join(articleDir, srcFolder)
          : articleDir;
        const dstDir = targetFolder
          ? path.join(articleDir, targetFolder)
          : articleDir;
        const srcFull = resolveSafe(srcDir, name);
        if (!srcFull || !fs.existsSync(srcFull)) {
          sendJson(res, 404, { error: "移動元ファイルが見つかりません" });
          return;
        }
        if (targetFolder && !fs.existsSync(dstDir)) {
          sendJson(res, 404, {
            error: `移動先フォルダ '${targetFolder}' が見つかりません`,
          });
          return;
        }
        const fname = path.basename(srcFull);
        const dstFull = path.join(dstDir, fname);
        if (fs.existsSync(dstFull)) {
          sendJson(res, 409, {
            error: `移動先に同名ファイル '${fname}' が既に存在します`,
          });
          return;
        }
        fs.renameSync(srcFull, dstFull);
        console.log(
          `[move] ${srcFolder ? srcFolder + "/" : ""}${fname} -> ${targetFolder ? targetFolder + "/" : ""}${fname}`,
        );
        sendJson(res, 200, { ok: true, name: fname, folder: targetFolder });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        sseClients++;
        if (shutdownTimer) {
          clearTimeout(shutdownTimer);
          shutdownTimer = null;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        req.on("close", () => {
          sseClients--;
          if (sseClients === 0) {
            shutdownTimer = setTimeout(() => {
              if (sseClients === 0) {
                console.log(
                  "\nタブが閉じられました。ファイル管理画面を終了します。",
                );
                server.close(() => process.exit(0));
                setTimeout(() => process.exit(0), 500).unref();
              }
            }, 2000);
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err) {
      console.error("リクエストエラー:", err);
      sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nエラー: ポート ${SERVER_PORT} は既に使用されています。\n` +
          `  ・別の \`pnpm file\` プロセスが起動中の可能性があります。\n` +
          `  ・他のアプリで同じポートを使用している場合は、解放してから再実行してください。`,
      );
    } else {
      console.error("サーバエラー:", err);
    }
    process.exit(1);
  });

  server.listen(SERVER_PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${SERVER_PORT}/`;
    console.log("");
    console.log(`ファイル管理画面を起動しました: ${url}`);
    console.log("ブラウザが開かない場合は上記URLを開いてください。");
    console.log("Ctrl+C で終了します。");
    console.log("");
    openBrowser(url);
  });

  const shutdown = () => {
    console.log("\nファイル管理画面を終了します");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("エラー:", err?.message ?? err);
  process.exit(1);
});
