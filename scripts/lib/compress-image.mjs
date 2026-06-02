import sharp from "sharp";

// 画像圧縮の共通ロジック。
// `pnpm file` のアップロード (compress-image → compressUpload) と
// `pnpm comp` / `pnpm comp:all` / `pnpm force-comp` (recompress) で共有する。
//
// 方針: サイズを削減する。圧縮の強さは 2 段階のプリセットで切り替える。
//  - normal : 画質をあまり落とさず削減する標準モード。アップロード保存時・
//             編集保存時・`pnpm comp` で使用する。
//  - force  : 画質を一段階落としてでも大幅にサイズを削減する強圧縮モード。
//             `pnpm force-comp` で使用する。大きい画像は長辺を縮小し、
//             静止 WebP も再エンコード対象に含める。
//
// 拡張子について:
//  - アップロード (compressUpload): 静止画はすべて PNG に変換する。新規
//    ファイルなので拡張子が変わっても記事参照に影響しない。アニメ
//    (GIF / APNG / animated WebP) だけは再エンコードせず元形式を保持する。
//  - 再圧縮 (recompress): 拡張子を変えると記事内の ![](...) 参照が壊れるため、
//    同じ拡張子で書き戻す (PNG / JPEG、force では静止 WebP も対象)。

export const JPEG_EXTS = [".jpg", ".jpeg", ".jpe", ".jfif"];

// sharp の format 名 → 拡張子 (アニメ画像の出力拡張子決定に使用)
export const SHARP_FORMAT_TO_EXT = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  gif: ".gif",
  avif: ".avif",
  tiff: ".tif",
  svg: ".svg",
  heif: ".heic",
};

// ---- 圧縮強度プリセット ----
// pngQuality / jpegQuality / webpQuality: エンコーダ品質 (低いほど高圧縮)。
// pngEffort  : libimagequant の探索コスト (高いほど高圧縮・低速)。
// maxDimension: 長辺の上限 px。これを超える画像は縮小する (null で無効)。
//
// normal は十分強い圧縮を標準とする (アップロード保存・編集保存・pnpm comp)。
// force はさらに画質を落としてサイズを最小化する (pnpm force-comp)。
const PRESETS = {
  normal: {
    pngQuality: 45,
    pngEffort: 10,
    jpegQuality: 58,
    webpQuality: 55,
    maxDimension: 2048,
  },
  force: {
    pngQuality: 25,
    pngEffort: 10,
    jpegQuality: 38,
    webpQuality: 35,
    maxDimension: 1440,
  },
};

function presetOf(mode) {
  return PRESETS[mode] ?? PRESETS.normal;
}

async function readMeta(buffer) {
  try {
    return await sharp(buffer, { animated: true }).metadata();
  } catch {
    return null;
  }
}

// ---- 形式別エンコーダ (プリセットで強度を切り替え) ----

// 入力バッファから sharp パイプラインを作る。
// プリセットに maxDimension が設定されていれば、長辺がそれを超える画像を
// アスペクト比を保ったまま縮小する (拡大はしない)。
function pipeline(buffer, p, { animated = false } = {}) {
  const img = sharp(buffer, animated ? { animated: true } : {});
  if (p.maxDimension) {
    img.resize({
      width: p.maxDimension,
      height: p.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  return img;
}

function encodePngQuantized(buffer, p) {
  // libimagequant でパレット量子化。screenshots / 図はほぼ劣化なくサイズ減。
  return pipeline(buffer, p)
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      quality: p.pngQuality,
      effort: p.pngEffort,
    })
    .toBuffer();
}

function encodePngLossless(buffer, p) {
  // アニメ PNG (APNG) を破壊しないようロスレスのみ。
  return pipeline(buffer, p, { animated: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function encodeJpeg(buffer, p) {
  return pipeline(buffer, p)
    .jpeg({ quality: p.jpegQuality, mozjpeg: true })
    .toBuffer();
}

function encodeWebp(buffer, p) {
  return pipeline(buffer, p)
    .webp({ quality: p.webpQuality, effort: 6 })
    .toBuffer();
}

/**
 * 既存ファイルの再圧縮 (拡張子は保持)。PNG / JPEG / 静止 WebP が対象で、
 * プリセットに応じて大きい画像は縮小する。force ほど画質を落とす。
 * 圧縮できない / サイズが縮まない場合は null。
 * @param {Buffer} buffer
 * @param {string} ext   拡張子 (例: ".png")
 * @param {"normal"|"force"} [mode="normal"]
 * @returns {Promise<Buffer|null>}
 */
export async function recompress(buffer, ext, mode = "normal") {
  const e = ext.toLowerCase();
  const p = presetOf(mode);
  let out = null;
  try {
    if (e === ".png" || e === ".apng") {
      const meta = await readMeta(buffer);
      out =
        meta && (meta.pages ?? 1) > 1
          ? await encodePngLossless(buffer, p)
          : await encodePngQuantized(buffer, p);
    } else if (JPEG_EXTS.includes(e)) {
      out = await encodeJpeg(buffer, p);
    } else if (e === ".webp") {
      const meta = await readMeta(buffer);
      // アニメ WebP は再エンコードで壊れやすいので保持 (スキップ)。
      if (meta && (meta.pages ?? 1) > 1) return null;
      out = await encodeWebp(buffer, p);
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!out || out.length >= buffer.length) return null;
  return out;
}

/**
 * アップロード時の圧縮。静止画はすべて PNG (パレット量子化) に変換する。
 * 新規ファイルなので拡張子が変わっても記事参照に影響しない。
 * アニメ (GIF / APNG / animated WebP) だけは再エンコードせず元形式を保持する。
 * SVG / HEIC は呼び出し側で処理。
 * @param {Buffer} buffer
 * @param {string} ext
 * @param {"normal"|"force"} [mode="normal"]
 * @returns {Promise<{buffer: Buffer, ext: string}>}
 */
export async function compressUpload(buffer, ext, mode = "normal") {
  const e = ext.toLowerCase();
  const p = presetOf(mode);
  const meta = await readMeta(buffer);
  const animated = meta ? (meta.pages ?? 1) > 1 : false;

  // アニメ (GIF / APNG / animated WebP) は再エンコードせず元バイト・形式を保持
  if (animated) {
    const outExt = SHARP_FORMAT_TO_EXT[meta.format] || e || ".gif";
    return { buffer, ext: outExt };
  }

  // 静止画はすべて PNG 量子化に変換する
  try {
    return { buffer: await encodePngQuantized(buffer, p), ext: ".png" };
  } catch {
    // 変換に失敗した場合は元のまま保存
    return { buffer, ext: e };
  }
}

/**
 * 編集後 / PNG 変換後の生 PNG を圧縮して書き戻す用。
 * canvas などから得た非圧縮寄りの PNG をパレット量子化で軽量化する。
 * 量子化に失敗した場合は最大圧縮のロスレス PNG にフォールバックする。
 * @param {Buffer} buffer
 * @param {"normal"|"force"} [mode="normal"]
 * @returns {Promise<Buffer>}
 */
export async function compressPng(buffer, mode = "normal") {
  const p = presetOf(mode);
  try {
    return await encodePngQuantized(buffer, p);
  } catch {
    return sharp(buffer)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  }
}
