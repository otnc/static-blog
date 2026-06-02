#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
        "  使い方: pnpm size <id>  または  article/<id> ブランチに切り替えてください。\n" +
        "          すべての記事の合計を見るには pnpm size:all を実行してください。",
    );
  }
  return branchId;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ディレクトリ内のファイルを再帰的にたどり、合計サイズとファイル数を返す。
function measureDir(dir) {
  let totalSize = 0;
  let fileCount = 0;
  if (!fs.existsSync(dir)) return { totalSize, fileCount };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = measureDir(full);
      totalSize += sub.totalSize;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      totalSize += fs.statSync(full).size;
      fileCount++;
    }
  }
  return { totalSize, fileCount };
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all") || args.includes("-a");

  if (all) {
    if (!fs.existsSync(publicFilesDir)) {
      console.error(`エラー: ディレクトリが見つかりません: ${publicFilesDir}`);
      process.exit(1);
    }
    const articles = fs
      .readdirSync(publicFilesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        id: e.name,
        ...measureDir(path.join(publicFilesDir, e.name)),
      }))
      .sort((a, b) => b.totalSize - a.totalSize);

    console.log(`[対象]   すべての記事 (public/files/)`);
    console.log("");

    let grandTotal = 0;
    let grandCount = 0;
    for (const a of articles) {
      console.log(`  ${a.id}  ${formatSize(a.totalSize)} (${a.fileCount} 件)`);
      grandTotal += a.totalSize;
      grandCount += a.fileCount;
    }

    console.log("");
    console.log(
      `合計: ${formatSize(grandTotal)} (${grandCount} 件, ${articles.length} 記事)`,
    );
    return;
  }

  const id = resolveArticleId(args);
  const targetDir = path.join(publicFilesDir, id);
  if (!fs.existsSync(targetDir)) {
    console.error(`エラー: ディレクトリが見つかりません: ${targetDir}`);
    process.exit(1);
  }

  const { totalSize, fileCount } = measureDir(targetDir);
  console.log(`[記事ID] ${id}`);
  console.log(
    `[対象]   ${path.relative(rootDir, targetDir).replace(/\\/g, "/")}/`,
  );
  console.log("");
  console.log(`合計サイズ: ${formatSize(totalSize)} (${fileCount} 件)`);
}

try {
  main();
} catch (err) {
  console.error("エラー:", err?.message ?? err);
  process.exit(1);
}
