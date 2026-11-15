export interface FooterConfig {
  brand: { name: string; description?: string };
  /** The store's own contact details and social links (live stores). Missing: the theme's demo footer. */
  contact?: { phone: string | null; whatsapp: string | null; email: string | null; address: string | null; city: string | null };
  social?: { facebook: string | null; instagram: string | null; tiktok: string | null; whatsapp: string | null } | null;
  newsletter: {
    heading: string;
    buttonText: string;
  };
}

export interface FooterProps {
  config: FooterConfig;
}
