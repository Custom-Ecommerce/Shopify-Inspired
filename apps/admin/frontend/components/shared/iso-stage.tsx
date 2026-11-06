import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * IsoStage: perspective container + tilted 3D plane (decorative use only).
 * Tilt applies from md up; below md the plane is flat. Max rotation is 12deg.
 */
export type IsoPreset = "hero" | "device" | "stack" | "flat";

const TILT: Record<IsoPreset, string> = {
  hero: "md:[transform:rotateX(6deg)_rotateY(-8deg)]",
  device: "md:[transform:rotateY(-6deg)]",
  stack: "md:[transform:rotateX(5deg)_rotateY(-11deg)]",
  flat: "",
};

interface IsoStageProps {
  preset?: IsoPreset;
  /** Ground-shadow ellipse under the plane (md and up). */
  contactShadow?: boolean;
  className?: string;
  /** Extra classes for the tilted plane (e.g. sizing). */
  planeClassName?: string;
  children: ReactNode;
}

export function IsoStage({ preset = "hero", contactShadow = true, className, planeClassName, children }: IsoStageProps) {
  return (
    <div className={cn("relative isolate [perspective:1600px]", className)}>
      {contactShadow ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] -bottom-6 -z-10 hidden h-16 rounded-[100%] shadow-lg md:block" />
      ) : null}
      <div className={cn("relative [transform-style:preserve-3d]", TILT[preset], planeClassName)}>{children}</div>
    </div>
  );
}
