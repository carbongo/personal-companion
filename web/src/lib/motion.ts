/**
 * Shared motion language. One easing, a few reusable variants. Motion's own
 * reduced-motion handling shortens these automatically; the CSS layer also
 * neutralizes animation for users who ask for less.
 */
import type { Transition, Variants } from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 320, damping: 30, mass: 0.7 };
export const glide: Transition = { duration: 0.5, ease: EASE };

/** A view entering/leaving the main stage (chat ⇄ settings). */
export const viewVariants: Variants = {
  initial: { opacity: 0, y: 14, filter: "blur(6px)" },
  enter: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.28, ease: EASE } },
};

/** A settings panel swapping in behind the rail. */
export const panelVariants: Variants = {
  initial: { opacity: 0, x: 18 },
  enter: { opacity: 1, x: 0, transition: { duration: 0.42, ease: EASE } },
  exit: { opacity: 0, x: -14, transition: { duration: 0.22, ease: EASE } },
};

/** Stagger container + child for lists that reveal on mount. */
export const stagger: Variants = {
  enter: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
export const riseItem: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};
