import { paths } from "../adapters/paths";
export const footerConfig = {
  brand: {
    name: "STILETTO",
    href: paths.home,
    logo: "/theme-assets/stiletto/logo/logo-light.jpeg",
    description: "All product content for the theme demo was kindly provided by BOSKEMPER.",
  },
  links: [
    {
      title: "THE COMPANY",
      items: [
        { label: "About us", href: "#" },
        { label: "Journal", href: "#" },
        { label: "Stockists", href: "#" },
        { label: "Fit Guide", href: "#" },
        { label: "FAQ", href: "#" },
        { label: "Theme", href: "#" },
      ],
    },
    {
      title: "SHOP COLLECTIONS",
      items: [
        { label: "The City Edit", href: "#" },
        { label: "Spring 2024", href: "#" },
        { label: "The Resort Collection", href: "#" },
        { label: "All Clothing", href: "#" },
      ],
    },
  ],
  newsletter: {
    heading: "SIGN UP AND SAVE ON YOUR FIRST ORDER",
    buttonText: "SUBSCRIBE",
  },
  bottom: {
    country: "Canada (CAD $)",
    copyright: "Copyright © 2026, STO Stiletto. All rights reserved. See our terms of use and privacy notice.",
    poweredBy: "Powered by Markazify",
  },
};
