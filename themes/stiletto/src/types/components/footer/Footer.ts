export interface FooterConfig {
  brand: { name: string };
  newsletter: {
    heading: string;
    buttonText: string;
  };
}

export interface FooterProps {
  config: FooterConfig;
}
