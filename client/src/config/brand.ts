/**
 * F1 (doc 23 §4 Table B) — SYNAPSE brand token.
 *
 * Single source of truth for the product identity consumed by the public entry
 * surfaces (Home / Login / Setup / footers). Retires the legacy
 * "AVI/AOI Management" / "Factory Quality System" framing: SYNAPSE is the
 * automation & manufacturing operations PLATFORM front door, not an AOI brochure.
 *
 * Keep this the ONLY place the product name/tagline literal lives. The tagline
 * has an i18n key too (`brand.tagline`) for localized copy; this constant is the
 * fallback + the canonical English string.
 */
import { Infinity as InfinityIcon, type LucideIcon } from "lucide-react";

export interface Brand {
  /** Full product name. */
  name: string;
  /** One-line positioning statement (English default; localize via `brand.tagline`). */
  tagline: string;
  /** Compact name for tight spaces (nav mark, footer). */
  short: string;
  /** The brand mark (lucide icon component). */
  logoIcon: LucideIcon;
  /** i18n key for the tagline (localized copy). */
  taglineKey: string;
}

export const BRAND: Brand = {
  name: "SYNAPSE",
  tagline: "Automation & Manufacturing Operations Platform",
  short: "SYNAPSE",
  logoIcon: InfinityIcon,
  taglineKey: "brand.tagline",
} as const;

export default BRAND;
