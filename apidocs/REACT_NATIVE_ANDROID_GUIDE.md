# Hướng dẫn tích hợp AVI-AOI API cho React Native Android

Hướng dẫn đầy đủ để sử dụng AVI-AOI External API từ ứng dụng React Native build Android.

---

## Mục lục

1. [Yêu cầu hệ thống](#1-yêu-cầu-hệ-thống)
2. [Cấu hình Android cho HTTP (quan trọng!)](#2-cấu-hình-android-cho-http-quan-trọng)
3. [Cài đặt API Service](#3-cài-đặt-api-service)
4. [Xác thực (Authentication)](#4-xác-thực-authentication)
5. [Sử dụng từng API](#5-sử-dụng-từng-api)
6. [Xử lý lỗi thường gặp](#6-xử-lý-lỗi-thường-gặp)
7. [Ví dụ đầy đủ - Màn hình danh sách Station](#7-ví-dụ-đầy-đủ---màn-hình-danh-sách-station)
8. [Build APK Release](#8-build-apk-release)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Yêu cầu hệ thống

| Mục | Yêu cầu |
|-----|---------|
| React Native | >= 0.70 |
| Android SDK | API 28+ (Android 9.0+) |
| Node.js | >= 18 |
| JDK | 17 |
| Server | AVI-AOI chạy trên cổng 3001 (hoặc cổng khác) |

```bash
# Tạo project mới
npx react-native@latest init MyAoiApp
cd MyAoiApp
```

Cài thư viện lưu trữ config:
```bash
npm install @react-native-async-storage/async-storage
```

---

## 2. Cấu hình Android cho HTTP (QUAN TRỌNG!)

> **⚠️ ĐÂY LÀ NGUYÊN NHÂN PHỔ BIẾN NHẤT KHIẾN API BỊ "TREO" (HANG)**
>
> Android 9+ (API 28) **chặn cleartext HTTP** mặc định. Nếu server dùng HTTP (không phải HTTPS),
> request sẽ bị block mà không báo lỗi → app bị treo vô hạn.

### Cách 1: Thêm `usesCleartextTraffic` (đơn giản — khuyên dùng cho dev)

Sửa file `android/app/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
      android:name=".MainApplication"
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:allowBackup="false"
      android:usesCleartextTraffic="true"
      android:theme="@style/AppTheme">
      <!-- ... activities ... -->
    </application>
</manifest>
```

### Cách 2: Network Security Config (production — chỉ cho phép IP/domain cụ thể)

Tạo file `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Cho phép cleartext HTTP chỉ với server cụ thể -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">10.0.2.2</domain>        <!-- Android Emulator → localhost -->
        <domain includeSubdomains="true">192.168.1.100</domain>   <!-- Server LAN thực tế -->
        <domain includeSubdomains="true">your-server.com</domain> <!-- Domain production -->
    </domain-config>
</network-security-config>
```

Trong `AndroidManifest.xml`:
```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

---

## 3. Cài đặt API Service

Tạo file `src/services/apiService.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================
// Config
// ============================================================
const CONFIG_KEY = '@api_config';
const DEFAULT_TIMEOUT_MS = 15000; // 15 giây

export interface ApiConfig {
  baseUrl: string;
  masterKey: string;
}

// Mặc định: Android Emulator → localhost qua 10.0.2.2
const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: 'http://10.0.2.2:3001',
  masterKey: '',
};

export async function getApiConfig(): Promise<ApiConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_CONFIG;
}

export async function saveApiConfig(cfg: Partial<ApiConfig>) {
  const current = await getApiConfig();
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...cfg }));
}

// ============================================================
// Fetch helper với timeout + error handling
// ============================================================
async function apiFetch<T = any>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  config?: ApiConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ success: boolean; data?: T; error?: string; status: number }> {
  const cfg = config ?? (await getApiConfig());
  const url = new URL(path, cfg.baseUrl);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'x-master-key': cfg.masterKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    const json = await res.json();
    return { status: res.status, ...json };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: `Request timeout after ${timeoutMs}ms`, status: 0 };
    }
    return { success: false, error: err.message ?? 'Network error', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
```

---

## 4. Xác thực (Authentication)

Tất cả API sử dụng **Master Key** qua header `x-master-key`.

```typescript
// Lưu config khi user nhập
await saveApiConfig({
  baseUrl: 'http://192.168.1.100:3001',  // IP server thực tế
  masterKey: 'master_avi_aoi_2026_xxxxx',
});
```

> **Lưu ý**: Khi chạy trên Android Emulator, dùng `http://10.0.2.2:3001` để truy cập localhost. 
> Khi chạy trên thiết bị Android thật, dùng IP LAN của server (ví dụ: `http://192.168.1.100:3001`).

---

## 5. Sử dụng từng API

### A. Station APIs

#### A1. Danh sách Stations
```typescript
// GET /api/external/stations
export async function getStations(config?: ApiConfig) {
  return apiFetch('/api/external/stations', {}, config);
}

// Sử dụng
const result = await getStations();
if (result.success) {
  console.log('Stations:', result.data); // Array of stations
}
```

#### A2. Chi tiết Station
```typescript
// GET /api/external/stations/:id
export async function getStationDetail(stationId: number, config?: ApiConfig) {
  return apiFetch(`/api/external/stations/${stationId}`, {}, config);
}

// Sử dụng
const station = await getStationDetail(1);
```

#### A3. Inspection Points (Điểm kiểm tra)
```typescript
// GET /api/external/stations/:id/inspection-points
export async function getStationInspectionPoints(
  stationId: number,
  params?: { productModelId?: number },
  config?: ApiConfig,
) {
  return apiFetch(`/api/external/stations/${stationId}/inspection-points`, params as any, config);
}

// Lấy tất cả điểm kiểm tra của station 1
const points = await getStationInspectionPoints(1);

// Lọc theo product model
const pointsFiltered = await getStationInspectionPoints(1, { productModelId: 5 });
```

#### A4. Ảnh tham chiếu Station
```typescript
// GET /api/external/stations/:id/reference-image
export async function getStationReferenceImage(stationId: number, config?: ApiConfig) {
  return apiFetch(`/api/external/stations/${stationId}/reference-image`, {}, config);
}
```

#### A5. Resolve MQTT Topic
```typescript
// GET /api/external/stations/resolve-topic?topic=...
export async function resolveStationTopic(topic: string, config?: ApiConfig) {
  return apiFetch('/api/external/stations/resolve-topic', { topic } as any, config);
}

// Giải mã MQTT topic → station info
const result = await resolveStationTopic('avi/1/workshop/2/station/3/errors');
// result.data = { station, line, workshop, factory, mqttTopic, messageType }
```

#### A6. Sản phẩm theo Station ⭐
```typescript
// GET /api/external/stations/:id/products
export async function getStationProducts(stationId: number, config?: ApiConfig) {
  return apiFetch(`/api/external/stations/${stationId}/products`, {}, config);
}

// Lấy danh sách sản phẩm của station 3
const products = await getStationProducts(3);
if (products.success) {
  console.log('Station:', products.data.station);
  console.log('Products:', products.data.products);
  console.log('Total:', products.data.total);
  
  // Mỗi product chứa danh sách machines
  products.data.products.forEach((p: any) => {
    console.log(`${p.code} - ${p.name} (${p.machines.length} machines)`);
  });
}
```

#### A7. Thống kê Station
```typescript
// GET /api/external/stations/:id/statistics
export async function getStationStatistics(
  stationId: number,
  params: { startDate: string; endDate: string; productModelId?: number },
  config?: ApiConfig,
) {
  return apiFetch(`/api/external/stations/${stationId}/statistics`, params as any, config);
}

// Thống kê 7 ngày gần nhất
const stats = await getStationStatistics(1, {
  startDate: '2025-01-01',
  endDate: '2025-01-07',
});
```

#### A8. Thống kê điểm đo
```typescript
// GET /api/external/stations/:id/measurement-stats
export async function getMeasurementStats(
  stationId: number,
  params: { startDate: string; endDate: string; groupBy?: string },
  config?: ApiConfig,
) {
  return apiFetch(`/api/external/stations/${stationId}/measurement-stats`, params as any, config);
}
```

#### A9. Lịch sử lỗi NG
```typescript
// GET /api/external/stations/:id/fail-history
export async function getFailHistory(
  stationId: number,
  params: { startDate: string; endDate: string; productModelId?: number; limit?: number; offset?: number },
  config?: ApiConfig,
) {
  return apiFetch(`/api/external/stations/${stationId}/fail-history`, params as any, config);
}
```

#### A10. Chi tiết điểm đo
```typescript
// GET /api/external/stations/:id/point-detail
export async function getPointDetail(
  stationId: number,
  params: { startDate: string; endDate: string; pointDefId?: number },
  config?: ApiConfig,
) {
  return apiFetch(`/api/external/stations/${stationId}/point-detail`, params as any, config);
}
```

#### A11. Workstations
```typescript
// GET /api/external/workstations
export async function getWorkstations(
  params?: { factoryId?: number; workshopId?: number; lineId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/workstations', params as any, config);
}

// GET /api/external/workstations/:id
export async function getWorkstationDetail(workstationId: number, config?: ApiConfig) {
  return apiFetch(`/api/external/workstations/${workstationId}`, {}, config);
}
```

---

### B. Inspection APIs

#### C1. Inspection Summary
```typescript
export async function getInspectionSummary(
  params: { startDate: string; endDate: string; stationId?: number; productModelId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/summary', params as any, config);
}
```

#### C2. Inspection Trend
```typescript
export async function getInspectionTrend(
  params: { startDate: string; endDate: string; stationId?: number; groupBy?: string; pointDefId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/trend', params as any, config);
}

// groupBy: 'hour' | 'day' | 'week'
const trend = await getInspectionTrend({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
  groupBy: 'day',
});
```

#### C3. Defect Pareto
```typescript
export async function getDefectPareto(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/defect-pareto', params as any, config);
}
```

#### C4. Inspection Images
```typescript
export async function getInspectionImages(
  params: {
    startDate: string; endDate: string;
    stationId?: number; pointDefId?: number;
    result?: string; limit?: number; offset?: number;
  },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/images', params as any, config);
}
```

#### C5. Inspection Events
```typescript
export async function getInspectionEvents(
  params: { startDate: string; endDate: string; stationId?: number; limit?: number; offset?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/events', params as any, config);
}
```

#### C6. Measurements (giá trị đo chi tiết)
```typescript
export async function getMeasurements(
  params: { pointDefId: number; startDate: string; endDate: string; limit?: number; offset?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/measurements', params as any, config);
}
```

#### C7. Products List
```typescript
export async function getProducts(
  params?: { search?: string; limit?: number; offset?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/products', params as any, config);
}
```

#### C8. Product Detail
```typescript
export async function getProductDetail(productId: number, config?: ApiConfig) {
  return apiFetch(`/api/external/products/${productId}`, {}, config);
}
```

---

### C. Advanced Inspection APIs (D1-D10)

#### D1. Control Chart (SPC)
```typescript
export async function getControlChart(
  params: { pointDefId: number; startDate: string; endDate: string },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/control-chart', params as any, config);
}
```

#### D2. Histogram
```typescript
export async function getHistogram(
  params: { startDate: string; endDate: string; stationId?: number; bins?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/histogram', params as any, config);
}
```

#### D3. Stratification
```typescript
export async function getStratification(
  params: { startDate: string; endDate: string; stationId?: number; groupBy?: string },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/stratification', params as any, config);
}
```

#### D4. Fail History (chi tiết)
```typescript
export async function getDetailedFailHistory(
  params: { startDate: string; endDate: string; stationId?: number; limit?: number; offset?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/fail-history', params as any, config);
}
```

#### D5. AI Diagnostics
```typescript
export async function getDiagnostics(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/diagnostics', params as any, config);
}
```

#### D6. Scatter (Correlation)
```typescript
export async function getScatter(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/scatter', params as any, config);
}
```

#### D7. Check Sheet
```typescript
export async function getCheckSheet(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/check-sheet', params as any, config);
}
```

#### D8. Cause-Effect (Ishikawa 6M)
```typescript
export async function getCauseEffect(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/cause-effect', params as any, config);
}
```

#### D9. AI Analysis
```typescript
export async function getAiAnalysis(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/ai-analysis', params as any, config);
}
```

#### D10. Yield Comparison
```typescript
export async function getYieldComparison(
  params: { startDate: string; endDate: string; stationId?: number },
  config?: ApiConfig,
) {
  return apiFetch('/api/external/inspections/yield-comparison', params as any, config);
}
```

---

## 6. Xử lý lỗi thường gặp

### 6.1 Request bị "treo" (hang) — Nguyên nhân #1

**Triệu chứng**: Gọi API không trả về gì, app bị đơ.

**Nguyên nhân**: Android 9+ chặn HTTP cleartext traffic.

**Cách sửa**: Thêm `android:usesCleartextTraffic="true"` vào `AndroidManifest.xml` (xem [Mục 2](#2-cấu-hình-android-cho-http-quan-trọng)).

### 6.2 Request timeout

```typescript
// apiFetch đã tích hợp timeout 15s, nhưng bạn có thể tùy chỉnh:
const result = await apiFetch('/api/external/stations', {}, undefined, 30000); // 30s

if (!result.success && result.error?.includes('timeout')) {
  Alert.alert('Lỗi kết nối', 'Server không phản hồi. Kiểm tra IP và cổng.');
}
```

### 6.3 Lỗi xác thực (401)

```typescript
if (result.status === 401) {
  Alert.alert('Lỗi xác thực', 'Master Key không đúng. Vui lòng kiểm tra lại.');
}
```

### 6.4 Network error (không kết nối được)

```typescript
if (result.status === 0 && result.error) {
  // Kiểm tra:
  // 1. Server có chạy không?
  // 2. IP/port có đúng không?
  // 3. Thiết bị/emulator có cùng mạng với server không?
  // 4. Firewall có chặn port không?
  Alert.alert('Lỗi mạng', result.error);
}
```

### 6.5 Bảng mã lỗi HTTP

| Status | Ý nghĩa | Cách xử lý |
|--------|---------|-------------|
| 0 | Network error / timeout | Kiểm tra kết nối, IP, port |
| 200 | Thành công | Xử lý `result.data` |
| 400 | Tham số không hợp lệ | Kiểm tra params gửi đi |
| 401 | Master Key sai | Kiểm tra config |
| 404 | Không tìm thấy (station/product) | Kiểm tra ID |
| 500 | Lỗi server | Liên hệ admin |

---

## 7. Ví dụ đầy đủ - Màn hình danh sách Station

```tsx
// screens/StationListScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, StyleSheet, RefreshControl,
} from 'react-native';
import { getStations, getStationProducts } from '../services/apiService';

interface Station {
  id: number;
  code: string;
  name: string;
}

export default function StationListScreen({ navigation }: any) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    const result = await getStations();
    if (result.success) {
      setStations(result.data);
    } else {
      Alert.alert('Lỗi', result.error || 'Không thể tải danh sách station');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleStationPress = async (station: Station) => {
    // Lấy sản phẩm của station (A6 API)
    const products = await getStationProducts(station.id);
    if (products.success) {
      navigation.navigate('StationProducts', {
        station: products.data.station,
        products: products.data.products,
      });
    } else {
      Alert.alert('Lỗi', products.error || 'Không thể tải sản phẩm');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Đang tải...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={stations}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => handleStationPress(item)}>
          <Text style={styles.code}>{item.code}</Text>
          <Text style={styles.name}>{item.name}</Text>
        </TouchableOpacity>
      )}
      ListEmptyComponent={<Text style={styles.empty}>Không có station nào</Text>}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  card: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  code: { fontSize: 14, color: '#007AFF', fontWeight: '600' },
  name: { fontSize: 18, color: '#333', marginTop: 4 },
  empty: { textAlign: 'center', padding: 32, color: '#999' },
});
```

### Màn hình sản phẩm A6:

```tsx
// screens/StationProductsScreen.tsx
import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

export default function StationProductsScreen({ route }: any) {
  const { station, products } = route.params;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.stationCode}>{station.code}</Text>
        <Text style={styles.stationName}>{station.name}</Text>
        <Text style={styles.count}>{products.length} sản phẩm</Text>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item: any) => String(item.id)}
        renderItem={({ item }: any) => (
          <View style={styles.productCard}>
            <View style={styles.productHeader}>
              <Text style={styles.productCode}>{item.code}</Text>
              <Text style={[styles.status, 
                { color: item.lifecycleStatus === 'active' ? '#4CAF50' : '#FF9800' }
              ]}>
                {item.lifecycleStatus}
              </Text>
            </View>
            <Text style={styles.productName}>{item.name}</Text>
            {item.description && (
              <Text style={styles.description}>{item.description}</Text>
            )}
            <View style={styles.info}>
              <Text style={styles.infoLabel}>Category: {item.category || '-'}</Text>
              <Text style={styles.infoLabel}>Machines: {item.machines?.length || 0}</Text>
              <Text style={styles.infoLabel}>
                Target Yield: {item.targetYieldRate != null ? `${item.targetYieldRate}%` : '-'}
              </Text>
            </View>
            {item.machines?.map((m: any) => (
              <View key={m.id} style={styles.machineTag}>
                <Text style={styles.machineText}>{m.code} - {m.name}</Text>
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Station này chưa có sản phẩm nào được gán</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  stationCode: { fontSize: 14, color: '#007AFF', fontWeight: '600' },
  stationName: { fontSize: 20, fontWeight: 'bold', color: '#333', marginTop: 4 },
  count: { fontSize: 14, color: '#999', marginTop: 4 },
  productCard: { margin: 8, padding: 16, backgroundColor: '#fff', borderRadius: 8, elevation: 2 },
  productHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productCode: { fontSize: 16, fontWeight: '600', color: '#333' },
  status: { fontSize: 12, fontWeight: '600' },
  productName: { fontSize: 14, color: '#666', marginTop: 4 },
  description: { fontSize: 12, color: '#999', marginTop: 4 },
  info: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  infoLabel: { fontSize: 12, color: '#666' },
  machineTag: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginTop: 4, alignSelf: 'flex-start' },
  machineText: { fontSize: 12, color: '#1565C0' },
  empty: { textAlign: 'center', padding: 32, color: '#999' },
});
```

---

## 8. Build APK Release

### 8.1 Tạo signing key

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

### 8.2 Cấu hình `android/gradle.properties`

```properties
MYAPP_UPLOAD_STORE_FILE=my-upload-key.keystore
MYAPP_UPLOAD_KEY_ALIAS=my-key-alias
MYAPP_UPLOAD_STORE_PASSWORD=***
MYAPP_UPLOAD_KEY_PASSWORD=***
```

### 8.3 Cấu hình `android/app/build.gradle`

```groovy
android {
    ...
    signingConfigs {
        release {
            storeFile file(MYAPP_UPLOAD_STORE_FILE)
            storePassword MYAPP_UPLOAD_STORE_PASSWORD
            keyAlias MYAPP_UPLOAD_KEY_ALIAS
            keyPassword MYAPP_UPLOAD_KEY_PASSWORD
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 8.4 Build APK

```bash
cd android
./gradlew assembleRelease
```

APK nằm tại: `android/app/build/outputs/apk/release/app-release.apk`

### 8.5 Build AAB (cho Google Play)

```bash
cd android
./gradlew bundleRelease
```

---

## 9. Troubleshooting

### 9.1 API bị treo (HANG) — Checklist

```
□ AndroidManifest.xml có android:usesCleartextTraffic="true" ?
□ Server có đang chạy và lắng nghe đúng port?
□ Thiết bị/emulator có kết nối cùng mạng với server?
□ IP server có đúng? (Emulator: 10.0.2.2, Thiết bị thật: IP LAN)
□ Firewall có chặn port server?
□ Master Key có đúng?
□ apiFetch có timeout? (mặc định 15s)
```

### 9.2 Emulator vs Thiết bị thật

| Môi trường | baseUrl | Ghi chú |
|-----------|---------|---------|
| Android Emulator | `http://10.0.2.2:3001` | `10.0.2.2` = localhost của máy host |
| Thiết bị thật (cùng WiFi) | `http://192.168.x.x:3001` | IP LAN của máy chạy server |
| Thiết bị thật (USB debug) | `http://localhost:3001` | Dùng `adb reverse tcp:3001 tcp:3001` |

**Cách dùng `adb reverse` (phổ biến nhất cho debug qua USB)**:

```bash
adb reverse tcp:3001 tcp:3001
```

→ Sau lệnh này, app Android có thể dùng `http://localhost:3001` trực tiếp.

### 9.3 Kiểm tra kết nối nhanh

Thêm nút kiểm tra trong app:

```typescript
async function testConnection(): Promise<string> {
  try {
    const result = await getStations();
    if (result.success) return `OK! Tìm thấy ${result.data.length} stations`;
    if (result.status === 401) return 'Lỗi: Master Key không đúng';
    return `Lỗi: ${result.error || 'Unknown'}`;
  } catch (e: any) {
    return `Network error: ${e.message}`;
  }
}
```

### 9.4 Danh sách tất cả 30 Endpoints

| # | Method | URL | Mô tả |
|---|--------|-----|-------|
| A1 | GET | `/api/external/stations` | Danh sách stations |
| A2 | GET | `/api/external/stations/:id` | Chi tiết station |
| A3 | GET | `/api/external/stations/:id/inspection-points` | Điểm kiểm tra |
| A4 | GET | `/api/external/stations/:id/reference-image` | Ảnh tham chiếu |
| A5 | GET | `/api/external/stations/resolve-topic` | Resolve MQTT topic |
| A6 | GET | `/api/external/stations/:id/products` | Sản phẩm theo station |
| A7 | GET | `/api/external/stations/:id/statistics` | Thống kê KPI |
| A8 | GET | `/api/external/stations/:id/measurement-stats` | Thống kê điểm đo |
| A9 | GET | `/api/external/stations/:id/fail-history` | Lịch sử lỗi NG |
| A10 | GET | `/api/external/stations/:id/point-detail` | Chi tiết điểm đo |
| A11a | GET | `/api/external/workstations` | Danh sách workstations |
| A11b | GET | `/api/external/workstations/:id` | Chi tiết workstation |
| C1 | GET | `/api/external/inspections/summary` | Tổng hợp kiểm tra |
| C2 | GET | `/api/external/inspections/trend` | Xu hướng OK/NG |
| C3 | GET | `/api/external/inspections/defect-pareto` | Pareto lỗi |
| C4 | GET | `/api/external/inspections/images` | Ảnh kiểm tra |
| C5 | GET | `/api/external/inspections/events` | Sự kiện |
| C6 | GET | `/api/external/inspections/measurements` | Giá trị đo chi tiết |
| C7 | GET | `/api/external/products` | Danh sách sản phẩm |
| C8 | GET | `/api/external/products/:id` | Chi tiết sản phẩm |
| D1 | GET | `/api/external/inspections/control-chart` | SPC Control Chart |
| D2 | GET | `/api/external/inspections/histogram` | Histogram |
| D3 | GET | `/api/external/inspections/stratification` | Phân tầng |
| D4 | GET | `/api/external/inspections/fail-history` | Lịch sử NG chi tiết |
| D5 | GET | `/api/external/inspections/diagnostics` | Chẩn đoán AI |
| D6 | GET | `/api/external/inspections/scatter` | Scatter/Correlation |
| D7 | GET | `/api/external/inspections/check-sheet` | Check Sheet |
| D8 | GET | `/api/external/inspections/cause-effect` | Cause-Effect 6M |
| D9 | GET | `/api/external/inspections/ai-analysis` | AI Analysis |
| D10 | GET | `/api/external/inspections/yield-comparison` | Yield Comparison |

---

## Tài liệu chi tiết

Tham khảo [EXTERNAL_INSPECTION_API.md](./EXTERNAL_INSPECTION_API.md) để xem response format, tham số chi tiết và ví dụ curl cho từng endpoint.
