/**
 * Paging for list endpoints.
 *
 * Lists used to stop at a fixed number of rows (`take: 500`) with no way past
 * it, so a register with more records than that silently lost the rest: the
 * risk register, sorted by residual score, dropped the lowest-rated risks
 * without a word (QA-021).
 *
 * A list now reads `?page=` (1-based) and `?pageSize=` (never above the list's
 * own cap), and answers with `paging` alongside its rows so a screen can say
 * "Showing 501–1,000 of 5,000" and offer the next page. With no parameters it
 * returns the same first page it always did, so nothing that reads page one
 * changes.
 */

export interface Page {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PageInfo {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasMore: boolean;
}

const wholeNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= min ? Math.min(n, max) : fallback;
};

/** The page a request asks for, bounded by the list's own cap. */
export function readPage(query: Record<string, unknown> | undefined, cap: number): Page {
  const pageSize = wholeNumber(query?.pageSize, 1, cap, cap);
  const page = wholeNumber(query?.page, 1, 1_000_000, 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** What a screen needs to describe the page it is showing. */
export function pageInfo(total: number, p: Page): PageInfo {
  return {
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
    hasMore: p.skip + p.take < total,
  };
}
