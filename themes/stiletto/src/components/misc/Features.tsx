import React from "react";
import { Truck, Globe, Flower2, ScrollText } from "lucide-react";
import type { FeatureIconName, FeaturesProps } from "../../types";

const iconMap: Record<FeatureIconName, React.ReactNode> = {
  Truck: <Truck strokeWidth={1.5} size={28} />,
  Globe: <Globe strokeWidth={1.5} size={28} />,
  Flower2: <Flower2 strokeWidth={1.5} size={28} />,
  ScrollText: <ScrollText strokeWidth={1.5} size={28} />,
};

export function Features({ data }: FeaturesProps) {
  return (
    <section data-source="static" data-source-note="Feature highlights are theme content." data-section="features" className="bg-[var(--features-bg)] py-16 px-6">
      <div className="max-w-container-max mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 md:gap-6 text-center">
          {data.map((item) => (
            <div key={item.id} className="flex flex-col items-center">
              <div className="mb-4 text-[var(--text-primary)]">{iconMap[item.icon] ?? iconMap.Truck}</div>
              <h3 className="font-heading text-[22px] md:text-[26px] uppercase text-[var(--text-primary)] mb-3">
                {item.title}
              </h3>
              <p className="font-sans text-[15px] text-[var(--features-text)] leading-relaxed max-w-[280px]">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
