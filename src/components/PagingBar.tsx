import React from 'react';

/** What a paged list endpoint returns alongside its rows (grc_wisdom_api/src/utils/paging.ts). */
export interface PageInfo {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasMore: boolean;
}

interface Props {
  paging?: PageInfo | null;
  onPage: (page: number) => void;
  /** What the rows are, for the sentence: "risks", "tickets". */
  noun?: string;
  disabled?: boolean;
}

/**
 * "Showing 501–1,000 of 5,000", with the way to the other pages.
 *
 * Lists used to stop at a fixed number of rows and say nothing, so a register
 * larger than that silently lost records (QA-021). This says how many there are
 * and which ones are on screen. It renders nothing while everything fits on one
 * page, so a short list looks exactly as it did.
 */
export default function PagingBar({ paging, onPage, noun = 'records', disabled }: Props) {
  if (!paging || paging.pageCount <= 1) return null;
  const first = (paging.page - 1) * paging.pageSize + 1;
  const last = Math.min(paging.page * paging.pageSize, paging.total);
  const n = (v: number) => v.toLocaleString();
  const button: React.CSSProperties = {
    padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)',
    background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
  };
  const off: React.CSSProperties = { ...button, opacity: 0.45, cursor: 'default' };
  const canBack = paging.page > 1 && !disabled;
  const canNext = paging.hasMore && !disabled;
  return (
    <nav
      aria-label={`Pages of ${noun}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 2px', fontSize: 12, color: 'var(--ink-muted)' }}
    >
      <span>
        Showing {n(first)}–{n(last)} of {n(paging.total)} {noun}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" style={canBack ? button : off} disabled={!canBack} onClick={() => onPage(paging.page - 1)}>
          ← Previous
        </button>
        <span>Page {n(paging.page)} of {n(paging.pageCount)}</span>
        <button type="button" style={canNext ? button : off} disabled={!canNext} onClick={() => onPage(paging.page + 1)}>
          Next →
        </button>
      </span>
    </nav>
  );
}
