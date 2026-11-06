"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box whose text is committed (to the URL) after a short pause. The latest commit function is used, so a
 * filter changed during the pause is not overwritten with an old one.
 */
export function useDebouncedSearch(committed: string, commit: (q: string) => void, delayMs = 300): [string, (value: string) => void] {
  const [text, setText] = useState(committed);
  const latest = useRef(commit);
  latest.current = commit;

  useEffect(() => {
    if (text.trim() === committed) return;
    const timer = setTimeout(() => latest.current(text.trim()), delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return [text, setText];
}
