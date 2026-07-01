/**
 * Doc 20 §3/§5 (I3a-1) — URSim harness public surface.
 *
 * URSim is a FREE Universal Robots controller simulator (docker
 * `universalrobots/ursim_e-series`) — see doc 20 §7 runbook. This module exposes:
 *   • UrsimClient          — net.Socket client for the UR primary/dashboard interfaces.
 *   • validateUrscriptOnUrsim — end-to-end IR→URScript→controller validation harness.
 *   • deployUrscriptToUrsim   — gated deploy target (reuses DPC_DEPLOY_ENABLED + HITL).
 * All flag-gated (URSIM_ENABLED, default OFF) and HONEST (unreachable → clear error).
 */
export { UrsimClient, UR_PORTS, type UrsimEndpoint, type DashboardReply } from "./ursimClient";
export {
  validateUrscriptOnUrsim,
  ursimEnabled,
  ursimEndpointFromEnv,
  type UrsimValidationResult,
  type UrsimValidationOptions,
} from "./ursimHarness";
export {
  deployUrscriptToUrsim,
  ursimRealDeployAllowed,
  type UrsimDeployRequest,
  type UrsimDeployResult,
} from "./ursimDeployService";
