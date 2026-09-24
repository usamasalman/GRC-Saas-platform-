import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `ms`.
 *
 * A search box on a paged list asks the server (QA-021): searching only the rows
 * already on screen would say "no match" while matches sat on other pages.
 * Waiting for a pause in typing keeps that to one request per search rather
 * than one per keystroke.
 */
export default function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
