/**
 * DS F1b — <Heading> / <Text> (doc 16 §12.1 typography scale).
 *
 * Opt-in typographic primitives that bind the CSS type-scale utilities
 * (.ds-h1 … .ds-caption in index.css) to a semantic element + emphasis ramp.
 * Replaces ad-hoc `text-2xl font-bold` etc. on NEW pages. Existing pages are
 * untouched.
 *
 *   <Heading level={1}>Page title</Heading>     → <h1 class="ds-h1 text-foreground">
 *   <Text variant="caption" tone="muted">…       → <p  class="ds-caption text-muted-foreground">
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const LEVEL_CLASS: Record<HeadingLevel, string> = {
  1: "ds-h1",
  2: "ds-h2",
  3: "ds-h3",
  4: "ds-h4",
  5: "ds-h5",
  6: "ds-h6",
};

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  /** Render as `display` size while keeping the chosen heading element. */
  display?: boolean;
  /** Visually render at one level while keeping semantic element of `as`. */
  as?: `h${HeadingLevel}`;
}

export function Heading({
  level = 2,
  display = false,
  as,
  className,
  ...props
}: HeadingProps) {
  const tag = (as ?? `h${level}`) as keyof React.JSX.IntrinsicElements;
  return React.createElement(tag, {
    className: cn(display ? "ds-display" : LEVEL_CLASS[level], "text-foreground", className),
    ...props,
  });
}

type TextVariant = "body" | "body-sm" | "caption";
type TextTone = "default" | "muted" | "subtle";
const VARIANT_CLASS: Record<TextVariant, string> = {
  body: "ds-body",
  "body-sm": "ds-body-sm",
  caption: "ds-caption",
};
const TONE_CLASS: Record<TextTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  subtle: "text-text-3",
};

export interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  variant?: TextVariant;
  tone?: TextTone;
  as?: "p" | "span" | "div";
}

export function Text({
  variant = "body",
  tone = "default",
  as: Tag = "p",
  className,
  ...props
}: TextProps) {
  return (
    <Tag className={cn(VARIANT_CLASS[variant], TONE_CLASS[tone], className)} {...props} />
  );
}

export default Heading;
