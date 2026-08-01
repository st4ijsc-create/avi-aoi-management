/**
 * Factory Alert System - Services Index
 * Export tất cả services
 */

export { mqttService } from './mqttService';
export { notificationService } from './notificationService';
export { soundService } from './soundService';
export { keepAwakeService, useKeepAwake, useKeepAwakeConditional, KeepAwake } from './keepAwakeService';
// exportService removed (doc 32 R3, decision #5): it was dead code — no screen
// called it; it "exported" alerts only as shared TEXT (dropping the filename),
// not a real file. Mobile keeps view-in-place + web-report deep-link instead.
export { overlayAlertService } from './overlayAlertService';
export { floatingBubbleService } from './floatingBubbleService';
export { alertFilterService } from './alertFilterService';
export { updateService } from './updateService';
export { imageService } from './imageService';
export { authService } from './authService';
export { hierarchyService } from './hierarchyService';
export { stationService } from './stationService';
export { alertApiService } from './alertApiService';
export { bulletinApiService } from './bulletinApiService';
export { dashboardService } from './dashboardService';
export {
  getServerBaseUrl,
  requireServerBaseUrl,
  isServerConfigured,
  saveServerConfig,
  testServerConnection,
  normalizeServerUrl,
  deriveMqttHostFromUrl,
  getMqttBroker,
  getConfiguredApiKey,
} from './serverConfig';
export type {
  ProductImageItem,
  ProductCatalogItem,
  ApiMeasurementPoint,
  SyncPointInput,
  SyncMeasurementPointsResponse,
  SyncProductImageResponse,
  SyncPointImageResponse,
  SyncHistoryLog,
  PointImageData,
} from './stationService';
