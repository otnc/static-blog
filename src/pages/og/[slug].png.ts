import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import satori from "satori";
import sharp from "sharp";
import { SITE_TITLE } from "../../consts";
import { findCustomThumbnailPath } from "../../utils/thumbnail";
import fs from "node:fs";
import path from "node:path";

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 630;

let fontData: ArrayBuffer | null = null;
const thumbnailCache = new Map<string, string>();
let defaultThumbnailDataUri: string | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  const fontPath = path.resolve("src/assets/NotoSansJP-Bold.woff2");
  fontData = fs.readFileSync(fontPath).buffer as ArrayBuffer;
  return fontData;
}

function loadDefaultThumbnail(): string {
  if (defaultThumbnailDataUri) return defaultThumbnailDataUri;
  const thumbPath = path.resolve("public/thumbnail.png");
  const buf = fs.readFileSync(thumbPath);
  defaultThumbnailDataUri = `data:image/png;base64,${buf.toString("base64")}`;
  return defaultThumbnailDataUri;
}

async function loadThumbnail(slug: string): Promise<string> {
  const cached = thumbnailCache.get(slug);
  if (cached) return cached;

  const customPath = findCustomThumbnailPath(slug);
  if (!customPath) {
    const uri = loadDefaultThumbnail();
    thumbnailCache.set(slug, uri);
    return uri;
  }

  const ext = path.extname(customPath).toLowerCase();
  let sharpInput: Buffer | string = customPath;
  if (ext === ".heic" || ext === ".heif") {
    const raw = fs.readFileSync(customPath);
    const heicConvert = (await import("heic-convert")).default;
    const converted = await heicConvert({ buffer: raw as any, format: "PNG" });
    sharpInput = Buffer.from(converted as any);
  }

  const meta = await sharp(sharpInput).metadata();
  if (meta.width !== TARGET_WIDTH || meta.height !== TARGET_HEIGHT) {
    const rel = path.relative(process.cwd(), customPath).replace(/\\/g, "/");
    throw new Error(
      `[og:${slug}] カスタムサムネイルのサイズが不正です: ${rel}\n` +
        `  実際: ${meta.width}×${meta.height} px / 期待: ${TARGET_WIDTH}×${TARGET_HEIGHT} px\n` +
        `  → \`pnpm thumbnail ${slug}\` で編集して保存し直してください。`,
    );
  }

  const png = await sharp(sharpInput).png().toBuffer();
  const uri = `data:image/png;base64,${png.toString("base64")}`;
  thumbnailCache.set(slug, uri);
  return uri;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection("blog");
  return posts
    .filter((post) => !post.data.hidden)
    .map((post) => ({
      params: { slug: post.id },
      props: { title: post.data.title, slug: post.id },
    }));
};

export const GET: APIRoute = async ({ props }) => {
  const { title, slug } = props as { title: string; slug: string };
  const font = await loadFont();
  const bgImage = await loadThumbnail(slug);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: '"Noto Sans JP"',
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Background image
          {
            type: "img",
            props: {
              src: bgImage,
              style: {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                objectFit: "cover",
              },
            },
          },
          // Dark overlay for text readability
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                background: "rgba(0, 0, 0, 0.55)",
              },
            },
          },
          // Article title
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexGrow: "1",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px 60px",
                textAlign: "center",
              },
              children: {
                type: "div",
                props: {
                  style: {
                    fontSize: title.length > 30 ? "42px" : "52px",
                    fontWeight: "700",
                    color: "#ffffff",
                    lineHeight: "1.4",
                    textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                  },
                  children: title,
                },
              },
            },
          },
          // Site name at bottom
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                paddingBottom: "40px",
              },
              children: {
                type: "div",
                props: {
                  style: {
                    fontSize: "28px",
                    fontWeight: "700",
                    color: "#a78bfa",
                    textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                  },
                  children: SITE_TITLE,
                },
              },
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Noto Sans JP",
          data: font,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(png as any, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
