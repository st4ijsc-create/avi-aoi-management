/**
 * doc 40 (MTX-06) — IO-Link master profile service barrel.
 *
 * Data-only port→tag profiles for common IO-Link masters (ifm / Balluff / Turck),
 * reused by the EXISTING opcuaDriver (OPC-UA path) — no new driver, no new dependency.
 * See ioLinkProfile.ts for the wiring/honesty notes.
 */
export {
  IO_LINK_MAX_PORTS,
  listIoLinkMasterProfiles,
  getIoLinkMasterProfile,
  resolvePortAddress,
  toOtTagAddresses,
  buildIoLinkAdapterPlan,
} from "./ioLinkProfile";

export type {
  IoLinkProtocol,
  IoLinkValidation,
  IoLinkMasterProfile,
  IoLinkPortConfig,
  IoLinkAdapterPlan,
} from "./ioLinkProfile";
