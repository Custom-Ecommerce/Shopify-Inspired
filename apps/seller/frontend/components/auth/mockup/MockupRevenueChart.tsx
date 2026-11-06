import { cn } from "@/lib/utils";

/** Decorative revenue chart used inside the auth background mockup. */
export function MockupRevenueChart({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-md border border-border bg-background p-4 shadow-xs", className)}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Revenue</span>
          <span className="text-xl font-bold text-foreground tabular-nums">Rs. 48,290</span>
        </div>
        <div className="text-[10px] font-medium text-success bg-success/15 px-2 py-1 rounded-sm">
          +14.5% vs last week
        </div>
      </div>

      <div className="relative h-32 w-full mt-auto">
        <svg viewBox="0 0 300 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="auth-chart-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="color-mix(in oklab, var(--color-primary) 12%, transparent)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          {/* Grid lines */}
          <g stroke="var(--color-border)" strokeWidth="1" opacity="0.5">
            <line x1="0" y1="20" x2="300" y2="20" />
            <line x1="0" y1="60" x2="300" y2="60" />
            <line x1="0" y1="100" x2="300" y2="100" />
          </g>
          {/* X-axis labels */}
          <g className="text-[8px] fill-muted-foreground font-medium" transform="translate(0, 115)">
            <text x="0" textAnchor="start">Mon</text>
            <text x="75" textAnchor="middle">Tue</text>
            <text x="150" textAnchor="middle">Wed</text>
            <text x="225" textAnchor="middle">Thu</text>
            <text x="300" textAnchor="end">Fri</text>
          </g>
          <path
            d="M0 100 L0 80 Q 25 70, 50 85 T 100 60 T 150 40 T 200 65 T 250 30 T 300 10 L300 100 Z"
            fill="url(#auth-chart-gradient)"
            className="motion-safe:animate-[fadeInHero_1.5s_ease-out]"
          />
          <path
            d="M0 80 Q 25 70, 50 85 T 100 60 T 150 40 T 200 65 T 250 30 T 300 10"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="600"
            strokeDashoffset="0"
            className="motion-safe:animate-[drawChart_1.5s_ease-out_forwards]"
          />
          <circle cx="300" cy="10" r="3" fill="var(--color-background)" stroke="var(--color-primary)" strokeWidth="2" className="motion-safe:opacity-0 motion-safe:animate-[fadeInHero_0.5s_ease-out_1s_forwards]" />
        </svg>
      </div>
    </div>
  );
}
