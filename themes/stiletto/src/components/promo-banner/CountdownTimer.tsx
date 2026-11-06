import React from "react";
import type { CountdownTime } from "../../types";

export interface CountdownTimerProps {
  time: CountdownTime;
}

function formatNumber(num: number): string {
  return num.toString().padStart(2, "0");
}

function TimeBlock({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <span className="font-heading text-[28px] md:text-[42px] leading-none">{formatNumber(value)}</span>
      <span className="font-sans text-[8px] md:text-[11px] uppercase tracking-widest">{label}</span>
    </div>
  );
}

function Divider() {
  return <span className="font-light text-[24px] md:text-[32px] opacity-30 pb-4">|</span>;
}

export function CountdownTimer({ time }: CountdownTimerProps) {
  return (
    <div className="flex items-center gap-2 md:gap-8 xl:w-[40%] justify-center">
      <TimeBlock value={time.days} label="Days" />
      <Divider />
      <TimeBlock value={time.hours} label="Hours" />
      <Divider />
      <TimeBlock value={time.minutes} label="Minutes" />
      <Divider />
      <TimeBlock value={time.seconds} label="Seconds" />
    </div>
  );
}
