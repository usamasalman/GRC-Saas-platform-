import apiClient from './apiClient';

/**
 * Every row of a paged list, for a screen that must offer all of them — a
 * picker, a lookup, a mapping grid.
 *
 * List endpoints answer a page at a time (QA-021). A screen that reads only the
 * first page and treats it as the whole list reintroduces the defect paging
 * fixed: whatever sorts after the first page cannot be chosen. This follows
 * `paging.hasMore` to the end instead.
 *
 * It refuses rather than truncates: past MAX_PAGES it throws, so a list larger
 * than any screen should hold fails loudly instead of quietly losing its tail.
 */
const MAX_PAGES = 50;

export default async function fetchAllPages<T>(
  url: string,
  key: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiClient.get(url, { params: { ...params, page } });
    rows.push(...((res.data?.[key] as T[] | undefined) || []));
    if (!res.data?.paging?.hasMore) return rows;
  }
  throw new Error(`${url} has more than ${MAX_PAGES} pages; narrow it before loading it whole.`);
}
