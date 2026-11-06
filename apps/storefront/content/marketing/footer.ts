export interface FooterLink {
  label: string;
  href: string; // Strictly typed as required
}

export const footerColumns: Record<string, FooterLink[]> = {
  Product: [
    { label: 'Pricing', href: '/pricing' },
    { label: 'Themes', href: '/themes' },
    { label: 'How it works', href: '/#how-it-works' }
  ],
  Features: [
    { label: 'Features', href: '/features' },
    { label: 'Cash on Delivery', href: '/#features' },
    { label: 'Payments & Couriers', href: '/#features' }
  ],
  Company: [
    { label: 'About Us', href: '/about' }
  ],
  Resources: [
    { label: 'FAQ', href: '/#faq' },
    { label: 'Support', href: '/#support' }
  ],
  Support: [
    { label: 'Contact', href: '/contact' }
  ],
  Legal: [
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Terms of Service', href: '/legal/terms' },
    { label: 'Refunds', href: '/legal/refunds' },
    { label: 'Cookie Policy', href: '/legal/cookies' }
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
