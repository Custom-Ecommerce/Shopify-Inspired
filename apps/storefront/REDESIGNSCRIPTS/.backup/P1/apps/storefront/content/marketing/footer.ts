export interface FooterLink {
  label: string;
  href: string; // Strictly typed as required
}

export const footerColumns: Record<string, FooterLink[]> = {
  Product: [
    { label: 'Features', href: '/features' },
    { label: 'Themes', href: '/themes' },
    { label: 'Pricing', href: '/pricing' }
  ],
  Company: [
    { label: 'About Us', href: '/about' },
    { label: 'Contact', href: '/contact' }
  ],
  Legal: [
    { label: 'Terms of Service', href: '/legal/terms' },
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Cookie Policy', href: '/legal/cookies' },
    { label: 'Refunds', href: '/legal/refunds' }
  ]
};

/**
 * Support contact for the footer. The real values are not in the repo yet.
 * TODO(assets): set the WhatsApp number (digits only, with country code, for
 * example 92300XXXXXXX) and the support email. Empty values render nothing.
 */
export const SUPPORT_CONTACT = {
  whatsapp: "",
  email: "",
};
