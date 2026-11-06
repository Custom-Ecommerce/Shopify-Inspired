import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * IsoStage: perspective container + tilted 3D plane.
 * Ported from storefront shared/iso-stage.tsx — seller-local copy.
 *
 *   <div perspective:1600px>            <- this component's root
 *     <div preserve-3d + tilt>          <- the "plane" (children live here)
 *       ...children (give them a translateZ at md+ for depth)
 *     </div>
 *   </div>
 *
 * Tilt applies from `md` up only. Below md the plane is flat, so mobile gets
 * no perspective distortion. Max rotation anywhere is 12deg.
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
  children: React.ReactNode;
}

export function IsoStage({
  preset = "hero",
  contactShadow = true,
  className,
  planeClassName,
  children,
}: IsoStageProps) {
  return (
    <div className={cn("relative isolate [perspective:1600px]", className)}>
      {contactShadow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[10%] -bottom-6 -z-10 hidden h-16 rounded-[100%] shadow-lg md:block"
        />
      )}
      <div className={cn("relative [transform-style:preserve-3d]", TILT[preset], planeClassName)}>
        {children}
      </div>
    </div>
  );
}
