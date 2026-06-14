import fs from "node:fs";
import path from "node:path";

/** カスタムサムネイルとして許可する拡張子 */
export const THUMBNAIL_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".jpe",
  ".jfif",
  ".webp",
  ".avif",
  ".gif",
  ".apng",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
] as const;

/**
 * `public/files/<slug>/_thumbnail.<ext>` を探し、見つかればその絶対パスを返す。
 */
export function findCustomThumbnailPath(slug: string): string | null {
  const dir = path.resolve("public", "files", slug);
  for (const ext of THUMBNAIL_EXTS) {
    const p = path.join(dir, `_thumbnail${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * カスタムサムネイルが存在すれば、サイト上で参照できる URL を返す。
 * 例: `/files/<slug>/_thumbnail.png`
 */
export function findCustomThumbnailUrl(slug: string): string | null {
  const p = findCustomThumbnailPath(slug);
  if (!p) return null;
  const ext = path.extname(p);
  return `/files/${slug}/_thumbnail${ext}`;
}
