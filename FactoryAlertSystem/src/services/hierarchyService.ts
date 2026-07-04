/**
 * Factory Alert System - Hierarchy Service
 * Service lấy cây phân cấp Factory → Workshop → Line → Station → Machine từ API
 * Dùng để tạo MQTT subscription topics
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';

// ============================================
// HIERARCHY TYPES
// ============================================

export interface HierarchyMachine {
  id: number;
  code: string;
  name: string;
  machineType: string;
  operationStatus: string;
}

export interface HierarchyStation {
  id: number;
  code: string;
  name: string;
  orderIndex: number;
  machines: HierarchyMachine[];
}

export interface HierarchyLine {
  id: number;
  code: string;
  name: string;
  stations: HierarchyStation[];
}

export interface HierarchyWorkshop {
  id: number;
  code: string;
  name: string;
  lines: HierarchyLine[];
}

export interface HierarchyFactory {
  id: number;
  code: string;
  name: string;
  workshops: HierarchyWorkshop[];
}

/** A node the user can select in the tree */
export interface HierarchyNode {
  /** Unique key for checkbox state, e.g. "FAC-001" or "FAC-001/WS-SMT/LINE-A" */
  key: string;
  code: string;
  name: string;
  level: 'factory' | 'workshop' | 'line' | 'station' | 'machine';
  children: HierarchyNode[];
}

/** Subscription item derived from a selected hierarchy node */
export interface SubscriptionItem {
  /** Display label */
  label: string;
  /** MQTT topic pattern */
  topic: string;
  /** Hierarchy node key for identification */
  nodeKey: string;
}

// ============================================
// CACHE CONFIG
// ============================================

const CACHE_KEY = STORAGE_KEYS.SETTINGS + '_hierarchy_cache';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedData {
  timestamp: number;
  data: HierarchyFactory[];
}

// ============================================
// SERVICE
// ============================================

class HierarchyService {
  private static instance: HierarchyService;
  private cachedTree: HierarchyFactory[] | null = null;
  private cacheTimestamp: number = 0;
  private fetchPromise: Promise<HierarchyFactory[]> | null = null;

  private constructor() {}

  public static getInstance(): HierarchyService {
    if (!HierarchyService.instance) {
      HierarchyService.instance = new HierarchyService();
    }
    return HierarchyService.instance;
  }

  /**
   * Fetch hierarchy tree from API server
   */
  public async fetchTree(apiBaseUrl: string, apiKey?: string): Promise<HierarchyFactory[]> {
    // Return in-memory cache if still fresh
    if (this.cachedTree && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cachedTree;
    }

    // Deduplicate concurrent calls
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this._doFetch(apiBaseUrl, apiKey);
    try {
      const result = await this.fetchPromise;
      return result;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async _doFetch(apiBaseUrl: string, apiKey?: string): Promise<HierarchyFactory[]> {
    // Try disk cache first
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedData = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          this.cachedTree = parsed.data;
          this.cacheTimestamp = parsed.timestamp;
          return parsed.data;
        }
      }
    } catch {
      // ignore cache read errors
    }

    // Fetch from API
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/api/external/hierarchy/tree`;
    console.log('[Hierarchy] Fetching tree from:', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (apiKey) {
        headers['x-master-key'] = apiKey;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      // Parse response — support multiple formats:
      // 1. Direct array: [...]
      // 2. Wrapped: { data: [...] }
      // 3. tRPC v10 wrapper: { result: { data: { json: [...] } } }
      let data: HierarchyFactory[];
      if (Array.isArray(json)) {
        data = json;
      } else if (Array.isArray(json?.data)) {
        data = json.data;
      } else if (Array.isArray(json?.result?.data?.json)) {
        data = json.result.data.json;
      } else if (Array.isArray(json?.result?.data)) {
        data = json.result.data;
      } else {
        console.warn('[Hierarchy] Unexpected response format:', JSON.stringify(json).substring(0, 300));
        throw new Error('Unexpected response format');
      }

      // Persist to cache
      this.cachedTree = data;
      this.cacheTimestamp = Date.now();
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ timestamp: this.cacheTimestamp, data } as CachedData),
      ).catch(() => {});

      console.log('[Hierarchy] Fetched tree:', data.length, 'factories');
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[Hierarchy] Fetch error:', error);
      // Return stale cache if available
      if (this.cachedTree) {
        console.log('[Hierarchy] Returning stale cache');
        return this.cachedTree;
      }
      throw error;
    }
  }

  /**
   * Convert raw API data to a flat tree of HierarchyNode for the selector
   */
  public buildNodeTree(factories: HierarchyFactory[]): HierarchyNode[] {
    return factories.map((factory) => ({
      key: String(factory.id),
      code: factory.code,
      name: factory.name,
      level: 'factory' as const,
      children: (factory.workshops ?? []).map((ws) => ({
        key: `${factory.id}/${ws.id}`,
        code: ws.code,
        name: ws.name,
        level: 'workshop' as const,
        children: (ws.lines ?? []).map((line) => ({
          key: `${factory.id}/${ws.id}/${line.id}`,
          code: line.code,
          name: line.name,
          level: 'line' as const,
          children: (line.stations ?? []).map((station) => ({
            key: `${factory.id}/${ws.id}/${line.id}/${station.id}`,
            code: station.code,
            name: station.name,
            level: 'station' as const,
            children: (station.machines ?? []).map((machine) => ({
              key: `${factory.id}/${ws.id}/${line.id}/${station.id}/${machine.id}`,
              code: machine.code,
              name: machine.name,
              level: 'machine' as const,
              children: [],
            })),
          })),
        })),
      })),
    }));
  }

  /**
   * Generate MQTT topic patterns from selected hierarchy node keys
   *
   * Server topic format: avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}
   * Example: avi/factory/1/workshop/1/station/2/bulletin/periodic
   *
   * Node keys use numeric IDs: "factoryId/workshopId/lineId/stationId/machineId"
   *
   * Selection rules:
   * - Factory selected → avi/factory/{factoryId}/workshop/+/station/+/#
   * - Workshop selected → avi/factory/{factoryId}/workshop/{workshopId}/station/+/#
   * - Line selected → avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/#  (per station)
   * - Station selected → avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/#
   * - Machine selected → avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/#  (same as station)
   */
  public generateTopicsFromSelection(
    selectedKeys: string[],
    factories: HierarchyFactory[],
  ): SubscriptionItem[] {
    const items: SubscriptionItem[] = [];
    const addedTopics = new Set<string>();

    for (const key of selectedKeys) {
      const parts = key.split('/');

      let topic: string;
      let label: string;

      switch (parts.length) {
        case 1: {
          // Factory level — key = "{factoryId}"
          const factoryId = parts[0];
          topic = `avi/factory/${factoryId}/workshop/+/station/+/#`;
          label = this.findFactoryNameById(factories, factoryId) || factoryId;
          break;
        }
        case 2: {
          // Workshop level — key = "{factoryId}/{workshopId}"
          const [fId, wsId] = parts;
          topic = `avi/factory/${fId}/workshop/${wsId}/station/+/#`;
          label = this.findWorkshopNameById(factories, fId, wsId) || `${fId}/${wsId}`;
          break;
        }
        case 3: {
          // Line level — key = "{factoryId}/{workshopId}/{lineId}"
          // Subscribe all stations of this line
          const [fId2, wsId2, lineId] = parts;
          const line = this.findLineById(factories, fId2, wsId2, lineId);
          if (line && line.stations.length > 0) {
            // Find the parent workshop ID (already in key)
            for (const st of line.stations) {
              const stTopic = `avi/factory/${fId2}/workshop/${wsId2}/station/${st.id}/#`;
              if (!addedTopics.has(stTopic)) {
                addedTopics.add(stTopic);
                items.push({
                  label: `${line.name} → ${st.name}`,
                  topic: stTopic,
                  nodeKey: `${fId2}/${wsId2}/${lineId}/${st.id}`,
                });
              }
            }
            continue; // already added topics
          }
          topic = `avi/factory/${fId2}/workshop/${wsId2}/station/+/#`;
          label = String(lineId);
          break;
        }
        case 4: {
          // Station level — key = "{factoryId}/{workshopId}/{lineId}/{stationId}"
          const [fId3, wsId3, , stId] = parts;
          topic = `avi/factory/${fId3}/workshop/${wsId3}/station/${stId}/#`;
          label = this.findStationNameById(factories, fId3, wsId3, stId) || String(stId);
          break;
        }
        case 5: {
          // Machine level — same topic as its parent station
          // key = "{factoryId}/{workshopId}/{lineId}/{stationId}/{machineId}"
          const [fId4, wsId4, , stId2] = parts;
          topic = `avi/factory/${fId4}/workshop/${wsId4}/station/${stId2}/#`;
          label = this.findMachineNameById(factories, parts) || String(parts[4]);
          break;
        }
        default:
          continue;
      }

      if (!addedTopics.has(topic)) {
        addedTopics.add(topic);
        items.push({ label, topic, nodeKey: key });
      }
    }

    return items;
  }

  /** Get just the topic strings from subscription items */
  public getTopicsFromSelection(
    selectedKeys: string[],
    factories: HierarchyFactory[],
  ): string[] {
    return this.generateTopicsFromSelection(selectedKeys, factories).map((item) => item.topic);
  }

  /** Get the cached tree (already fetched), or empty array if not yet fetched */
  public getCachedTree(): HierarchyFactory[] {
    return this.cachedTree ?? [];
  }

  /** Generate topics using the in-memory cached tree */
  public getTopicsFromSelectionCached(selectedKeys: string[]): string[] {
    return this.getTopicsFromSelection(selectedKeys, this.getCachedTree());
  }

  // ── Lookup helpers (by numeric ID) ──

  private findFactoryNameById(factories: HierarchyFactory[], id: string): string | undefined {
    return factories.find((f) => String(f.id) === id)?.name;
  }

  private findWorkshopNameById(
    factories: HierarchyFactory[],
    factoryId: string,
    wsId: string,
  ): string | undefined {
    const factory = factories.find((f) => String(f.id) === factoryId);
    return factory?.workshops.find((ws) => String(ws.id) === wsId)?.name;
  }

  private findLineById(
    factories: HierarchyFactory[],
    factoryId: string,
    wsId: string,
    lineId: string,
  ): HierarchyLine | undefined {
    const factory = factories.find((f) => String(f.id) === factoryId);
    const workshop = factory?.workshops.find((ws) => String(ws.id) === wsId);
    return workshop?.lines.find((l) => String(l.id) === lineId);
  }

  private findStationNameById(
    factories: HierarchyFactory[],
    factoryId: string,
    wsId: string,
    stId: string,
  ): string | undefined {
    const factory = factories.find((f) => String(f.id) === factoryId);
    if (!factory) return undefined;
    for (const ws of factory.workshops) {
      if (String(ws.id) !== wsId) continue;
      for (const line of ws.lines) {
        const st = line.stations.find((s) => String(s.id) === stId);
        if (st) return st.name;
      }
    }
    return undefined;
  }

  private findMachineNameById(
    factories: HierarchyFactory[],
    keyParts: string[],
  ): string | undefined {
    const [factoryId, wsId, lineId, stId, machineId] = keyParts;
    const factory = factories.find((f) => String(f.id) === factoryId);
    if (!factory) return undefined;
    const ws = factory.workshops.find((w) => String(w.id) === wsId);
    if (!ws) return undefined;
    const line = ws.lines.find((l) => String(l.id) === lineId);
    if (!line) return undefined;
    const station = line.stations.find((s) => String(s.id) === stId);
    if (!station) return undefined;
    return station.machines.find((m) => String(m.id) === machineId)?.name;
  }

  /**
   * Find the first machine code for a station by stationId or stationCode.
   * Searches the cached hierarchy tree.
   */
  public findMachineCodeForStation(stationIdOrCode: string): string | null {
    const tree = this.cachedTree;
    if (!tree) return null;
    for (const factory of tree) {
      for (const ws of factory.workshops) {
        for (const line of ws.lines) {
          for (const station of line.stations) {
            if (String(station.id) === stationIdOrCode || station.code === stationIdOrCode) {
              if (station.machines.length > 0) {
                return station.machines[0].code;
              }
            }
          }
        }
      }
    }
    return null;
  }

  /** Clear all caches */
  public clearCache(): void {
    this.cachedTree = null;
    this.cacheTimestamp = 0;
    AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  }
}

export const hierarchyService = HierarchyService.getInstance();
