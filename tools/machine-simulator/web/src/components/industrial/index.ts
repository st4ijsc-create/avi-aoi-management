/**
 * Blueprint primitive barrel (spec §5) — H2/H3 screens should build from these rather than
 * hand-rolling panels/readouts/controls. See docs/HMI_DESIGN_SPEC.md for the visual contract each
 * one implements.
 *
 * M-2 (branch-review) — `<MicroLabel vi en>` (spec §5's table) was removed here: it was exported but
 * never imported at any call site, and its `vi`/`en` API (raw copy in BOTH languages, resolving which
 * is "primary" vs "gloss" internally from the active language) doesn't match how every OTHER bilingual
 * primitive in this file actually works — `Sheet`'s `title`/`titleEn` and `Readout`'s `label`/`labelEn`
 * both take already-resolved strings (`t(key)`/`gloss(key)`, computed once at the call site), not raw
 * per-language pairs re-resolved inside the component. That mismatch is the most likely reason nothing
 * ever adopted it. The bilingual gloss idiom itself is alive and well throughout the app via the
 * `t()`/`gloss()` + `hmi-micro aria-hidden` pattern `Sheet`/`Readout`/`FormField` all already use.
 */
export { Sheet, type SheetProps } from "./Sheet"
export { Readout, type ReadoutProps, type ReadoutTone } from "./Readout"
export { StatusLamp, type StatusLampProps, type StatusLampState } from "./StatusLamp"
export { LogTag, type LogTagProps, type LogLevel } from "./LogTag"
export { ControlButton, CONTROL_BUTTON_SIZE_CLASS, type ControlButtonProps, type ControlButtonVariant } from "./ControlButton"
