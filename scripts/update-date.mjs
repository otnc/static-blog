#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatJstNow } from "./lib/jst.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const blogDir = path.join(rootDir, "src", "content", "blog");

const VALID_FIELDS = new Set(["pubDate", "updatedDate"]);

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

function resolveArticleId(explicit, field) {
  if (explicit) return explicit;
  const branchId = getCurrentBranchArticleId();
  if (!branchId) {
    throw new Error(
      `記事IDが指定されておらず、現在のブランチも 'article/<id>' 形式ではありません。\n` +
        `  使い方: pnpm date:${field === "pubDate" ? "pub" : "updated"} <id>` +
        `  または article/<id> ブランチに切り替えてください。`,
    );
  }
  return branchId;
}

function updateFrontmatterField(text, field, value) {
  // 改行コード（LF / CRLF）に依存せずフロントマターを検出
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    throw new Error("フロントマターが見つかりません。");
  }
  const fm = fmMatch[1];
  // ファイルの既存の改行コードを維持する
  const eol = fm.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.split(/\r?\n/);
  const newLine = `${field}: "${value}"`;

  const idx = lines.findIndex((l) => new RegExp(`^${field}:`).test(l));
  if (idx !== -1) {
    lines[idx] = newLine;
  } else if (field === "updatedDate") {
    // pubDate の直後に updatedDate を入れるのが慣例。なければ末尾追加。
    const pubIdx = lines.findIndex((l) => /^pubDate:/.test(l));
    if (pubIdx !== -1) lines.splice(pubIdx + 1, 0, newLine);
    else lines.push(newLine);
  } else {
    lines.push(newLine);
  }

  const newFm = lines.join(eol);
  // 置換文字列の $ 特殊解釈を避けるため関数置換を使用
  return text.replace(fmMatch[0], () => `---${eol}${newFm}${eol}---`);
}

function main() {
  const field = process.argv[2];
  const explicitId = process.argv[3];

  if (!field || !VALID_FIELDS.has(field)) {
    console.error(
      `エラー: 内部引数 field が不正です (受け取り: ${field})。pubDate または updatedDate を指定してください。`,
    );
    process.exit(1);
  }

  const id = resolveArticleId(explicitId, field);
  const filePath = path.join(blogDir, `${id}.mdx`);

  if (!fs.existsSync(filePath)) {
    console.error(`エラー: 記事ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  const original = fs.readFileSync(filePath, "utf-8");
  const now = formatJstNow();
  const updated = updateFrontmatterField(original, field, now);

  if (updated === original) {
    console.log(`変更なし (${field} は既に同じ値です): ${now}`);
    return;
  }

  fs.writeFileSync(filePath, updated, "utf-8");
  console.log(`✅ ${path.relative(rootDir, filePath).replace(/\\/g, "/")}`);
  console.log(`   ${field}: "${now}"`);
}

try {
  main();
} catch (err) {
  console.error("エラー:", err?.message ?? err);
  process.exit(1);
}
