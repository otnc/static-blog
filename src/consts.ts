export const SITE_TITLE = "まろんのブログ｡";
export const SITE_DESCRIPTION =
  "個人ブログです。技術、イベント、LT、趣味などについて書いています。";
export const SITE_URL = "https://blog.montblank.fun";
export const TWITTER_HANDLE = "@rin_montblank";
export const GITHUB_URL = "https://github.com/otnc";
export const MISSKEY_URL = "https://misskey.otnc.dev/@m";
export const PORTFOLIO_URL = "https://montblank.fun";
export const AUTHOR_NAME = "まろん｡";
export const AUTHOR_BIO = "技術とドメインの話が好きな変な人";

/** ピン止め記事を先頭に、pubDate 降順でソート（元配列は変更しない） */
export function sortPosts<
  T extends { data: { pinned?: boolean; pubDate: Date } },
>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    const ap = a.data.pinned ?? false;
    const bp = b.data.pinned ?? false;

    // One is pinned and the other is not — pinned wins
    if (ap !== bp) return ap ? -1 : 1;

    // Both share the same pinned state — sort by pubDate descending
    return b.data.pubDate.getTime() - a.data.pubDate.getTime();
  });
}
