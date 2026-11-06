"use client";

import { useEffect, useState } from "react";

interface UseAutoRotateReturn {
  index: number;
  next: () => void;
  prev: () => void;
}

/**
 * Rotates an index through `length` items on a fixed interval, while still
 * allowing manual next/prev control (used by the announcement bar and the
 * testimonials carousel).
 */
export function useAutoRotate(
  length: number,
  intervalMs = 5000
): UseAutoRotateReturn {
  const [index, setIndex] = useState(0);

  const next = () => setIndex((prev) => (length === 0 ? 0 : (prev + 1) % length));
  const prev = () =>
    setIndex((prevIndex) =>
      length === 0 ? 0 : (prevIndex - 1 + length) % length
    );

  useEffect(() => {
    if (length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [length, intervalMs]);

  return { index, next, prev };
}
