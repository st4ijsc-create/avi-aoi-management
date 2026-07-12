/**
 * IPC-CFX (IPC-2591) telemetry client — public surface.
 *
 * INBOUND telemetry only (SMT-line monitoring: mounters / reflow / stencil
 * printers). MOUNTED into server boot (G1.2, doc 44 W0-D): server/_core/index.ts
 * calls startCfxClient()/stopCfxClient(), gated by CFX_ENABLED (default OFF ⇒
 * boot is a no-op). Engaging it in production needs: an AMQP 1.0 broker + CFX
 * endpoints (CFX_ENDPOINTS) + CFX_ENABLED=true + the machines declared so
 * Source/machineCode resolves to a platform machineId.
 */
export {
  CfxClient,
  parseEndpoints,
  isCfxEnabled,
  startCfxClient,
  stopCfxClient,
  getCfxStats,
  type CfxEndpoint,
  type CfxEndpointStats,
  type CfxClientDeps,
  type AmqpContainerLike,
  type AmqpConnectionLike,
  type AmqpEventContextLike,
} from "./cfxClient";

export {
  parseCfxEnvelope,
  mapCfxToSamples,
  parseAndMapCfx,
  shortMessageName,
  isMappedCfxMessage,
  parseTimespanSeconds,
  type CfxEnvelope,
  type CfxParseHints,
  type CfxMapContext,
} from "./cfxMessages";
