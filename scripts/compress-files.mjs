#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recompress } from "./lib/compress-image.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const publicFilesDir = path.join(rootDir, "public", "files");

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

function resolveArticleId(args) {
  const explicit = args.find((a) => !a.startsWith("-"));
  if (explicit) return explicit;
  const branchId = getCurrentBranchArticleId();
  if (!branchId) {
    throw new Error(
      "記事IDが指定されておらず、現在のブランチも 'article/<id>' 形式ではありません。\n" +
        "  使い方: pnpm comp <id>  または  article/<id> ブランチに切り替えてください。\n" +
        "          すべての記事を一括圧縮するには pnpm comp:all を実行してください。\n" +
        "          より強い圧縮には pnpm force-comp / pnpm force-comp:all を使えます。",
    );
  }
  return branchId;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

async function compressFile(filePath, mode) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const originalSize = buf.length;

  // 拡張子を保持したまま再圧縮する (PNG / JPEG / 静止 WebP)。
  // force ほど画質を落とし、大きい画像はより小さく縮小する。
  // 対象外の形式 / 縮まない場合は null (スキップ)。
  const outBuf = await recompress(buf, ext, mode);
  if (!outBuf) return null;

  fs.writeFileSync(filePath, outBuf);
  return {
    originalSize,
    newSize: outBuf.length,
    saved: originalSize - outBuf.length,
  };
}

async function compressDir(targetDir, baseDir, mode) {
  const allFiles = walkFiles(targetDir);
  let totalOriginal = 0;
  let totalNew = 0;
  let compressedCount = 0;
  let skippedCount = 0;

  for (const filePath of allFiles) {
    const relPath = path.relative(baseDir, filePath).replace(/\\/g, "/");
    const result = await compressFile(filePath, mode);
    if (result) {
      const pct = ((result.saved / result.originalSize) * 100).toFixed(1);
      console.log(
        `  ✓ ${relPath}  ${formatSize(result.originalSize)} → ${formatSize(result.newSize)} (-${pct}%)`,
      );
      totalOriginal += result.originalSize;
      totalNew += result.newSize;
      compressedCount++;
    } else {
      const size = fs.statSync(filePath).size;
      totalOriginal += size;
      totalNew += size;
      skippedCount++;
    }
  }

  return { totalOriginal, totalNew, compressedCount, skippedCount };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all") || args.includes("-a");
  const force = args.includes("--force") || args.includes("-f");
  const mode = force ? "force" : "normal";

  let targetDir;
  if (all) {
    targetDir = publicFilesDir;
    console.log(`[対象]   すべての記事 (public/files/)`);
  } else {
    const id = resolveArticleId(args);
    targetDir = path.join(publicFilesDir, id);
    console.log(`[記事ID] ${id}`);
    console.log(
      `[対象]   ${path.relative(rootDir, targetDir).replace(/\\/g, "/")}/`,
    );
  }
  console.log(
    force
      ? `[モード] 強圧縮 (force) — 画質を大きく落とし長辺 1440px まで縮小します`
      : `[モード] 標準 — 画質を落としつつ長辺 2048px まで縮小します`,
  );

  if (!fs.existsSync(targetDir)) {
    console.error(`エラー: ディレクトリが見つかりません: ${targetDir}`);
    process.exit(1);
  }
  console.log("");

  const { totalOriginal, totalNew, compressedCount, skippedCount } =
    await compressDir(targetDir, all ? publicFilesDir : targetDir, mode);

  console.log("");
  console.log(`完了: ${compressedCount} 件圧縮, ${skippedCount} 件スキップ`);
  if (compressedCount > 0) {
    const totalSaved = totalOriginal - totalNew;
    const pct = ((totalSaved / totalOriginal) * 100).toFixed(1);
    console.log(`合計削減: ${formatSize(totalSaved)} (-${pct}%)`);
  }
  // 圧縮後の総量 (スキップ分も含むディレクトリ全体のサイズ)。
  console.log(
    `圧縮後の総量: ${formatSize(totalNew)} (圧縮前 ${formatSize(totalOriginal)})`,
  );
}

main().catch((err) => {
  console.error("エラー:", err?.message ?? err);
  process.exit(1);
});
