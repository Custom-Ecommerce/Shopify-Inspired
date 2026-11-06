/**
 * Centralized static copy used inside UI components (not supplied via props).
 * Consuming apps configure real content through component props; this file
 * only holds structural/UI-chrome text (button labels, a11y strings, etc.).
 */

export const headerDictionary = {
  mobileMenuTitle: "Mobile Menu",
  searchTitle: "Search",
  searchPlaceholder: "What are you looking for?",
  popularCollectionsLabel: "Popular collections",
  cartSrTitle: "Cart",
  cartHeading: "Your Cart",
  cartEmptyHeading: "Your Cart Is Empty",
  cartEmptyHelperLine1: "Not sure where to start?",
  cartEmptyHelperLine2: "Try these collections:",
} as const;

export const productCardDictionary = {
  chooseOptions: "VIEW DETAILS",
} as const;

export const footerDictionary = {
  navLinks: ["Shop", "Collections", "About", "Contact"] as const,
  firstNamePlaceholder: "First name",
  lastNamePlaceholder: "Last name",
  emailPlaceholder: "Your email",
  socialLinks: [
    { platform: "facebook", href: "#" },
    { platform: "instagram", href: "#" },
    { platform: "twitter", href: "#" },
    { platform: "site", href: "#" },
  ] as const,
} as const;
