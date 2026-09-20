/**
 * remark: __underline__ サポート

 * 5パスで処理:
 * 1. __ 由来の strong ノードを <u> に変換
 * 2. テキストノード内の未解析 __…__ を正規表現で変換
 * 3. paragraph 内のクロスノード __ ペアを解決
 * 3.5. CJK文字隣接時の ** / ~~ 誤ペアリングを修正
 * 4. テキストに残った ** / ~~ / * マーカーを変換
 * 5. 孤立した ~~ を解決

 * remarkGfm の後に配置すること。
 */
import { visit } from "unist-util-visit";

// Matches plain-text __…__ that the parser left as raw text (non-word-boundary).
const UNDERLINE_PLAIN_REGEX = /__([^_\n]+?)__/g;

export default function remarkUnderline() {
  return (tree, file) => {
    const source = String(file.value ?? file);

    // Pass 1: __ 由来の strong ノードを検出
    visit(tree, "strong", (node) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start !== "number" || typeof end !== "number") return;

      const startDelim = source.slice(start, start + 2);
      const endDelim = source.slice(end - 2, end);

      if (startDelim === "__" && endDelim === "__") {
        node.data = node.data ?? {};
        node.data.hName = "u";
        node.data.hProperties = node.data.hProperties ?? {};
      }
    });

    // Pass 2: 未解析の __text__ を変換
    visit(tree, "text", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;

      const text = node.value;
      UNDERLINE_PLAIN_REGEX.lastIndex = 0;
      if (!UNDERLINE_PLAIN_REGEX.test(text)) return;
      UNDERLINE_PLAIN_REGEX.lastIndex = 0;

      const children = [];
      let lastIndex = 0;
      let match;

      while ((match = UNDERLINE_PLAIN_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
          children.push({
            type: "text",
            value: text.slice(lastIndex, match.index),
          });
        }
        children.push({ type: "html", value: `<u>${match[1]}</u>` });
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        children.push({ type: "text", value: text.slice(lastIndex) });
      }

      if (children.length > 0) {
        parent.children.splice(index, 1, ...children);
        return index + children.length;
      }
    });

    // Pass 3: クロスノード __ ペア
    const BLOCK_TYPES = new Set([
      "paragraph",
      "listItem",
      "blockquote",
      "tableCell",
    ]);

    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !Array.isArray(node.children)) return;

      // Tokenize: each child → one or more tokens
      // token types: { kind: "marker" } | { kind: "text", value } | { kind: "node", node }
      const tokens = [];
      for (const child of node.children) {
        if (child.type === "text") {
          const parts = child.value.split("__");
          for (let p = 0; p < parts.length; p++) {
            if (p > 0) tokens.push({ kind: "marker" });
            if (parts[p] !== "") tokens.push({ kind: "text", value: parts[p] });
          }
        } else {
          tokens.push({ kind: "node", node: child });
        }
      }

      // Count markers
      const markerCount = tokens.filter((t) => t.kind === "marker").length;
      if (markerCount < 2) return;

      const out = [];
      let buffer = null;

      for (const tok of tokens) {
        if (tok.kind === "marker") {
          if (buffer === null) {
            buffer = [];
          } else {
            const inner = buffer
              .map((t) =>
                t.kind === "text"
                  ? serializeInline({ type: "text", value: t.value })
                  : serializeInline(t.node),
              )
              .join("");
            out.push({ type: "html", value: `<u>${inner}</u>` });
            buffer = null;
          }
          continue;
        }

        if (buffer !== null) {
          buffer.push(tok);
        } else {
          // Outside underline — emit as original node type
          if (tok.kind === "node") out.push(tok.node);
          else out.push({ type: "text", value: tok.value });
        }
      }

      // Unclosed marker: treat as literal text
      if (buffer !== null) {
        out.push({ type: "text", value: "__" });
        for (const t of buffer) {
          if (t.kind === "node") out.push(t.node);
          else out.push({ type: "text", value: t.value });
        }
      }

      // Only replace if changed
      const changed =
        out.length !== node.children.length ||
        out.some((o, i) => o !== node.children[i]);
      if (changed) node.children = out;
    });

    // Pass 3.5: CJK 隣接時の ** / ~~ 誤ペアリング修正
    const MISPAIR_PATTERNS = [
      {
        nodeType: "strong",
        openRe: /^([\s\S]*)\*\*([^*\n]+)$/,
        closeRe: /^([^*\n]+?)\*\*([\s\S]*)$/,
        tag: "strong",
        skip: (s) => s.data?.hName === "u",
      },
      {
        nodeType: "delete",
        openRe: /^([\s\S]*)~~([^~\n]+)$/,
        closeRe: /^([^~\n]+?)~~([\s\S]*)$/,
        tag: "del",
        skip: () => false,
      },
      {
        // Single * italic
        nodeType: "emphasis",
        openRe: /^([\s\S]*)(?<!\*)\*(?!\*)([^*\n]+)$/,
        closeRe: /^([^*\n]+?)(?<!\*)\*(?!\*)([\s\S]*)$/,
        tag: "em",
        skip: () => false,
      },
      {
        // Single _ italic
        nodeType: "emphasis",
        openRe: /^([\s\S]*)(?<!_)_(?!_)([^_\n]+)$/,
        closeRe: /^([^_\n]+?)(?<!_)_(?!_)([\s\S]*)$/,
        tag: "em",
        skip: () => false,
      },
    ];

    for (const { nodeType, openRe, closeRe, tag, skip } of MISPAIR_PATTERNS) {
      visit(tree, (node) => {
        if (!BLOCK_TYPES.has(node.type) || !Array.isArray(node.children))
          return;

        const kids = node.children;
        let i = 0;
        while (i + 2 < kids.length) {
          const t1 = kids[i];
          const s = kids[i + 1];
          const t2 = kids[i + 2];

          if (
            t1.type !== "text" ||
            s.type !== nodeType ||
            t2.type !== "text" ||
            skip(s)
          ) {
            i++;
            continue;
          }

          // t1 must end with <delim>content
          const openMatch = t1.value.match(openRe);
          // t2 must start with content<delim>
          const closeMatch = t2.value.match(closeRe);

          if (!openMatch || !closeMatch) {
            i++;
            continue;
          }

          const [, beforeOpen, openContent] = openMatch;
          const [, closeContent, afterClose] = closeMatch;

          // 誤マークされた span をプレーン HTML に
          const wrongHtml = (s.children ?? []).map(serializeInline).join("");

          const esc = (str) =>
            str
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");

          const replacement = [];
          if (beforeOpen) replacement.push({ type: "text", value: beforeOpen });
          replacement.push({
            type: "html",
            value: `<${tag}>${esc(openContent)}</${tag}>`,
          });
          if (wrongHtml) replacement.push({ type: "html", value: wrongHtml });
          replacement.push({
            type: "html",
            value: `<${tag}>${esc(closeContent)}</${tag}>`,
          });
          if (afterClose) replacement.push({ type: "text", value: afterClose });

          kids.splice(i, 3, ...replacement);
        }
      });
    }

    // Pass 4: テキストに残った ** / ~~ / * マーカーを変換
    const INLINE_MARKER_REGEX =
      /\*\*([^*\n]+?)\*\*|~~([^~\n]+?)~~|(?<!\*)\*([^*\n]+?)\*(?!\*)/g;

    visit(tree, "text", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;

      const text = node.value;
      INLINE_MARKER_REGEX.lastIndex = 0;
      if (!INLINE_MARKER_REGEX.test(text)) return;
      INLINE_MARKER_REGEX.lastIndex = 0;

      const children = [];
      let lastIndex = 0;
      let match;

      while ((match = INLINE_MARKER_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex)
          children.push({
            type: "text",
            value: text.slice(lastIndex, match.index),
          });

        // Determine which alternative matched
        const tag =
          match[1] !== undefined
            ? "strong"
            : match[2] !== undefined
              ? "del"
              : "em";
        const inner = (match[1] ?? match[2] ?? match[3])
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        children.push({ type: "html", value: `<${tag}>${inner}</${tag}>` });
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length)
        children.push({ type: "text", value: text.slice(lastIndex) });

      if (children.length > 0) {
        parent.children.splice(index, 1, ...children);
        return index + children.length;
      }
    });

    // Pass 5: 孤立した ~~ を解決
    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !Array.isArray(node.children)) return;

      const kids = node.children;
      let i = 0;
      while (i < kids.length) {
        const cur = kids[i];

        if (cur.type !== "text") {
          i++;
          continue;
        }

        const openMatch = cur.value.match(/^([\s\S]*?)(~~+)$/);
        if (!openMatch) {
          i++;
          continue;
        }

        const tildes = openMatch[2];
        const beforeTildes = openMatch[1];

        let j = i + 1;
        const inner = [];
        let closeNode = null;
        let afterTildes = "";

        while (j < kids.length) {
          const candidate = kids[j];
          if (candidate.type === "text") {
            if (candidate.value.startsWith(tildes)) {
              afterTildes = candidate.value.slice(tildes.length);
              closeNode = candidate;
            }
            break;
          }
          inner.push(candidate);
          j++;
        }

        if (!closeNode || inner.length === 0) {
          i++;
          continue;
        }

        const replacement = [];
        if (beforeTildes)
          replacement.push({ type: "text", value: beforeTildes });

        const innerHtml = inner.map(serializeInline).join("");
        replacement.push({ type: "html", value: `<del>${innerHtml}</del>` });

        if (afterTildes) replacement.push({ type: "text", value: afterTildes });

        kids.splice(i, j - i + 1, ...replacement);
        // Don't advance — replacement may need further scanning
      }
    });
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Serialise an mdast inline node to an HTML string.
 * Used when we need to wrap already-resolved nodes inside a new HTML shell.
 */
function serializeInline(node) {
  if (!node) return "";
  switch (node.type) {
    case "text":
      return node.value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    case "html":
      return node.value;
    case "inlineCode":
      return `<code>${node.value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</code>`;
    case "strong": {
      const tag = node.data?.hName ?? "strong";
      return `<${tag}>${(node.children ?? []).map(serializeInline).join("")}</${tag}>`;
    }
    case "emphasis":
      return `<em>${(node.children ?? []).map(serializeInline).join("")}</em>`;
    case "delete":
      return `<del>${(node.children ?? []).map(serializeInline).join("")}</del>`;
    case "link": {
      const href = (node.url ?? "").replace(/"/g, "&quot;");
      const title = node.title
        ? ` title="${node.title.replace(/"/g, "&quot;")}"`
        : "";
      return `<a href="${href}"${title}>${(node.children ?? [])
        .map(serializeInline)
        .join("")}</a>`;
    }
    case "image": {
      const src = (node.url ?? "").replace(/"/g, "&quot;");
      const alt = (node.alt ?? "").replace(/"/g, "&quot;");
      const title = node.title
        ? ` title="${node.title.replace(/"/g, "&quot;")}"`
        : "";
      return `<img src="${src}" alt="${alt}"${title} />`;
    }
    case "break":
      return "<br>";
    default:
      if (Array.isArray(node.children))
        return node.children.map(serializeInline).join("");
      return node.value ?? "";
  }
}
