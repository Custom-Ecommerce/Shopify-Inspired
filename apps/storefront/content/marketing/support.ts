import { Headset, MessageCircle, Mail, Languages } from "lucide-react";

/** Support promises. Only what the owner has confirmed or the plans already state. */
export const SUPPORT_HIGHLIGHTS = [
  {
    id: "local",
    icon: Headset,
    title: "Support in Urdu and English",
    description:
      "Ask us about Cash on Delivery, couriers and local payments. You can write to us in Urdu or English.",
  },
  {
    id: "priority",
    icon: MessageCircle,
    title: "Priority WhatsApp support",
    description: "Growth plan stores get priority WhatsApp support. Free plan stores get community support.",
  },
] as const;

export const SUPPORT_CHANNELS = [
  { id: "form", icon: Mail, label: "Contact form" },
  { id: "language", icon: Languages, label: "Urdu and English" },
] as const;
