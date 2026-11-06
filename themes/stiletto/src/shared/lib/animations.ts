import type { Variants, Transition } from "framer-motion";

export const easeOutExpo: Transition["ease"] = [0.22, 1, 0.36, 1];

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export const fadeInUpSmall: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export const fadeInSlideX: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
};

export const heroContentTransition: Transition = {
  duration: 0.8,
  ease: easeOutExpo,
};

export const heroSecondaryTransition: Transition = {
  duration: 0.8,
  delay: 0.4,
  ease: easeOutExpo,
};

export const announcementSwap: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -5 },
};

export const megaMenuVariants: Variants = {
  hidden: { opacity: 0, scaleY: 0 },
  visible: { opacity: 1, scaleY: 1 },
  exit: { opacity: 0, scaleY: 0 },
};

export const heroSlideVariants: Variants = {
  hidden: { opacity: 0, x: 10 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
};

export const testimonialSlideVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

export const productCardExitVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, scale: 0.95 },
};

export function staggerDelay(index: number, step = 0.1): Transition {
  return { delay: index * step };
}

export const marqueeLoop: Transition = {
  repeat: Infinity,
  ease: "linear",
  duration: 30,
};

export const videoMarqueeLoop: Transition = {
  repeat: Infinity,
  ease: "linear",
  duration: 25,
};
