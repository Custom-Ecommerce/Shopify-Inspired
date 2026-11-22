export interface HeroProps {
  videoSrc: string;
  posterImage?: string;
  title: string;
  /** Sprint 7 (S7-B7): a seller's own title, rendered as a plain text node. When set it replaces `title`, which is the theme's own markup. */
  titleText?: string;
  /** Sprint 7 (S7-B7): the seller's hero picture (a URL of their own media). When set it replaces the background video. */
  imageSrc?: string;
  subHeading: string;
  buttonText: string;
  buttonLink: string;
  secondaryButtonText?: string;
  secondaryButtonLink?: string;
}
