import type { LucideIcon } from "lucide-react";
import { Truck, Wallet, MessageCircle, Box, MapPin, Zap } from "lucide-react";

export interface IntegrationItem {
  name: string;
  icon: LucideIcon;
  /**
   * Optional public path for an official logo, for example "/logos/jazzcash.svg".
   * TODO(assets): set this when the SVG exists in public/logos/. Until then the icon and name show.
   */
  logoPath?: string;
}

/** Only payment methods and couriers the product already names. No ad or analytics tools are listed. */
export const INTEGRATIONS: IntegrationItem[] = [
  { name: "JazzCash", icon: Wallet },
  { name: "EasyPaisa", icon: Wallet },
  { name: "TCS", icon: Truck },
  { name: "Leopards", icon: Box },
  { name: "Trax", icon: MapPin },
  { name: "CallCourier", icon: Zap },
  { name: "WhatsApp", icon: MessageCircle },
];
