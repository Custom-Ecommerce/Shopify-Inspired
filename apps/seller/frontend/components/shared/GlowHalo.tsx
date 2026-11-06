import { cn } from "@/lib/utils";

/**
 * GlowHalo: a glow that is always shaped like the surface it sits behind.
 *
 * Rules (blueprint §2.2):
 *  - Parent MUST be `relative isolate`, otherwise -z-10 slides behind the page.
 *  - Max two blurred halos per viewport (they are expensive to paint).
 *  - Decorative only: aria-hidden, pointer-events-none.
 */
type GlowShape = "rect" | "ellipse";
type GlowRadius = "xl" | "2xl" | "3xl" | "4xl";
type GlowInset = "tight" | "normal" | "wide";
type GlowIntensity = "soft" | "strong";

const RADIUS: Record<GlowRadius, string> = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  "4xl": "rounded-4xl",
};

const INSET: Record<GlowInset, string> = {
  tight: "-inset-2",
  normal: "-inset-3",
  wide: "-inset-6",
};

const INTENSITY: Record<GlowIntensity, string> = {
  soft: "opacity-70",
  strong: "opacity-100 shadow-[0_0_20px_0] shadow-primary/20",
};

interface GlowHaloProps {
  /** rect follows a card's corner radius; ellipse is for free-floating glow. */
  shape?: GlowShape;
  /** Match the parent's radius token when shape="rect". */
  radius?: GlowRadius;
  inset?: GlowInset;
  intensity?: GlowIntensity;
  className?: string;
}

export function GlowHalo({
  shape = "rect",
  radius = "3xl",
  inset = "normal",
  intensity = "soft",
  className,
}: GlowHaloProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -z-10 bg-primary/15 blur-2xl dark:bg-primary/25",
        shape === "ellipse" ? "rounded-[100%]" : RADIUS[radius],
        INSET[inset],
        INTENSITY[intensity],
        className,
      )}
    />
  );
}
