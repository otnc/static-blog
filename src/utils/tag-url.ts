/** 記事一覧のタグ絞り込みへのリンク。タグの区切りはカンマ (?tags=A,B)。 */
export function tagFilterUrl(tags: string[]): string {
  return `/?tags=${tags.map(encodeURIComponent).join(",")}`;
}
