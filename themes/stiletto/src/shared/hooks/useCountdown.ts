"use client";

import { useEffect, useState } from "react";
import type { CountdownTime } from "../../types";

const ZERO_TIME: CountdownTime = { days: 0, hours: 0, minutes: 0, seconds: 0 };

function calculateTimeLeft(targetDate: string): CountdownTime {
  const difference = +new Date(targetDate) - +new Date();
  if (difference <= 0) return ZERO_TIME;

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
}

/**
 * Computes a live countdown to `targetDate`, ticking every second.
 * Returns `ZERO_TIME` until the component has mounted, to avoid SSR/hydration
 * mismatches.
 */
export function useCountdown(targetDate: string): CountdownTime {
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<CountdownTime>(ZERO_TIME);

  useEffect(() => {
    setMounted(true);
    setTimeLeft(calculateTimeLeft(targetDate));

    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetDate));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  return mounted ? timeLeft : ZERO_TIME;
}
