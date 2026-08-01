import { useLanguage } from "@/i18n"
import { en } from "@/i18n/en"
import { vi, type Dictionary } from "@/i18n/vi"

/**
 * Same idiom `shell/Sidebar.tsx`'s `resolveLabel` already established for nav gloss: look a dot-path
 * key up against a SPECIFIC dictionary (not the active one) rather than the active-language `t()`.
 * Used throughout the HMI (`Sheet`'s `titleEn`, `Readout`'s `labelEn`) to render the bilingual gloss
 * per spec §3 — primary text in the active language, small uppercase gloss in the OTHER language.
 * Plain-string keys only (no interpolation vars), matching every call site this is used from.
 */
function resolveLabel(dict: Dictionary, key: string): string {
  const parts = key.split(".")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const part of parts) {
    if (node == null || typeof node !== "object") return key
    node = node[part]
  }
  return typeof node === "string" ? node : key
}

/** Resolves `key` against the INACTIVE language's dictionary — the gloss pairing every bilingual
 * primitive in this design system uses (spec §3). */
export function useGloss(): (key: string) => string {
  const { language } = useLanguage()
  const glossDict = language === "vi" ? en : vi
  return (key: string) => resolveLabel(glossDict, key)
}
