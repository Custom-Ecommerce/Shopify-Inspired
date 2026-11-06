import { Surface } from "@/components/shared/surface";
import { cn } from "@/lib/utils";

/**
 * ThemeDeviceStack: flat placeholder device mockup for a theme card.
 * A laptop frame with a phone frame overlapping its lower-right corner.
 * Used only when the theme has no real screenshot (see content/marketing/themes.ts).
 */

type ThemeId = string;

// Opaque tones (never alpha: the phone overlaps the laptop and must not show it through).
const BEZEL = "bg-[color-mix(in_oklab,var(--muted-foreground)_16%,var(--card))]";

/* ---------- Desktop screen layouts (one per theme) ---------- */

function DesktopScreen({ id }: { id: ThemeId }) {
  const nav = (
    <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
      <div className="h-1.5 w-10 rounded-full bg-foreground/30" />
      <div className="flex gap-1.5">
        <div className="h-1 w-5 rounded-full bg-muted-foreground/30" />
        <div className="h-1 w-5 rounded-full bg-muted-foreground/30" />
        <div className="h-1 w-5 rounded-full bg-muted-foreground/30" />
      </div>
    </div>
  );

  if (id === "perfecto") {
    return (
      <div className="flex h-full flex-col bg-background">
        {nav}
        <div className="flex gap-1 px-2.5 pt-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={cn("h-1.5 flex-1 rounded-full", i === 0 ? "bg-primary/60" : "bg-muted-foreground/15")} />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-4 gap-1.5 p-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex-1 rounded-sm bg-muted-foreground/15" />
              <div className="h-1 w-full rounded-full bg-foreground/15" />
              <div className="h-1 w-1/2 rounded-full bg-primary/50" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "bazaar") {
    return (
      <div className="flex h-full flex-col bg-background">
        {nav}
        <div className="m-2.5 mb-1.5 flex h-[34%] items-center rounded-md bg-primary/15 p-2.5">
          <div className="flex w-1/2 flex-col gap-1">
            <div className="h-1.5 w-full rounded-full bg-primary/60" />
            <div className="h-1 w-2/3 rounded-full bg-foreground/20" />
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-1.5 px-2.5 pb-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-sm bg-muted-foreground/15" />
          ))}
        </div>
      </div>
    );
  }

  // aura
  return (
    <div className="flex h-full flex-col bg-background">
        {nav}
      <div className="flex flex-1 items-end justify-center gap-3 px-3 pt-3">
        <div className="flex w-1/4 flex-col gap-1 self-center">
          <div className="h-1.5 w-full rounded-full bg-foreground/25" />
          <div className="h-1 w-2/3 rounded-full bg-muted-foreground/30" />
          <div className="mt-1 h-3 w-1/2 rounded-full bg-primary/50" />
        </div>
        <div className="h-[88%] w-2/5 rounded-t-full bg-muted-foreground/15" />
      </div>
    </div>
  );
}

/* ---------- Mobile screen layouts ---------- */

function MobileScreen({ id }: { id: ThemeId }) {
  const bar = (
    <div className="flex items-center justify-between px-2 pb-1.5 pt-4">
      <div className="h-1 w-5 rounded-full bg-foreground/30" />
      <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
    </div>
  );

  if (id === "perfecto") {
    return (
      <div className="flex h-full flex-col bg-background">
        {bar}
        <div className="grid flex-1 grid-cols-2 gap-1 p-1.5 pt-0.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex-1 rounded-sm bg-muted-foreground/15" />
              <div className="h-0.5 w-full rounded-full bg-foreground/15" />
              <div className="h-0.5 w-1/2 rounded-full bg-primary/50" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "bazaar") {
    return (
      <div className="flex h-full flex-col bg-background">
        {bar}
        <div className="mx-1.5 h-[26%] rounded-sm bg-primary/15" />
        <div className="grid flex-1 grid-cols-2 gap-1 p-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-sm bg-muted-foreground/15" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {bar}
      <div className="flex flex-1 flex-col items-center gap-1.5 px-2 pt-2">
        <div className="h-1 w-8 rounded-full bg-foreground/25" />
        <div className="w-full flex-1 rounded-t-full bg-muted-foreground/15" />
      </div>
    </div>
  );
}

/* ---------- Devices ---------- */

function Laptop({ id }: { id: ThemeId }) {
  return (
    <div className="relative mx-auto w-[88%]">
      {/* Lid */}
      <Surface
        level={1}
        radius="xl"
        className={cn(BEZEL, "p-1.5 transition-colors duration-(--dur-base) group-hover/theme:border-primary/30")}
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-md border border-border bg-background">
          <DesktopScreen id={id} />
        </div>
      </Surface>
      {/* Hinge / base: wider than the lid, so the laptop sits on the floor */}
      <div
        className="relative -mx-[6%] h-2.5 rounded-b-2xl border border-t-0 border-border bg-[color-mix(in_oklab,var(--muted-foreground)_24%,var(--card))]"
        aria-hidden="true"
      >
        <div className="mx-auto h-1 w-1/5 rounded-b-md bg-muted-foreground/30" />
      </div>
    </div>
  );
}

function Phone({ id }: { id: ThemeId }) {
  return (
    <div className="w-full">
      <Surface
        level={2}
        radius="3xl"
        className={cn(BEZEL, "relative aspect-[9/19] w-full p-1 transition-colors duration-(--dur-base) group-hover/theme:border-primary/30")}
      >
        <div className="absolute left-1/2 top-1.5 z-10 h-1 w-1/4 -translate-x-1/2 rounded-full bg-border" />
        <div className="h-full overflow-hidden rounded-[1.4rem] border border-border bg-background">
          <MobileScreen id={id} />
        </div>
      </Surface>
    </div>
  );
}

export function ThemeDeviceStack({ id, className }: { id: ThemeId; className?: string }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-sm", className)}>
      <Laptop id={id} />

      {/* Phone overlaps the laptop's lower-right corner */}
      <div className="absolute -bottom-3 right-[2%] z-10 w-[24%]">
        <Phone id={id} />
      </div>
    </div>
  );
}
