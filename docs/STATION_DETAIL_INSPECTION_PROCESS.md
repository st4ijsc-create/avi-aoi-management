# StationDetailInspection Process (FactoryAlertSystem)

This document describes the end-to-end flow used by StationDetailScreen and identifies root causes for empty data in LeftPanel and FloatingPanel.

## 1) End-to-End Flow (Actual Runtime Order)

### 1.1 Station identity and API stationId
1. Screen gets active station from store.
2. `selectApiStationId` resolves station ID used for APIs:
   - Prefer `station.config.apiStationId` (numeric station ID resolved from topic/hierarchy)
   - Fallback to `activeStationId`
3. If fallback is non-numeric (e.g. `AVI-01`), external APIs expecting numeric `:id` can fail with 400.

### 1.1.1 Startup and store merge order
1. MQTT topics initialize station keys (can be station code/name style).
2. `resolve-topic` API later maps to numeric station IDs.
3. Alerts/bulletins may arrive before mapping is fully stabilized.
4. Store migrates keys and merges data (`oldKey -> numericKey`).

This means API calls can happen on a transient station identity if mapping is incomplete.

### 1.2 Product context loading
1. Load products by station:
   - A6: `GET /api/external/stations/:id/products`
   - Fallback C7: `GET /api/external/products`
2. Select product (`selectedProduct`) and load full product data:
   - Product detail and measurement points (product model scope)
   - Product/point reference images
3. `productMeasurementPoints` becomes the main point list for table/canvas.

### 1.3 LeftPanel KPI + point table data
1. Main screen station range is currently fixed to `today` in UI (time dropdown removed from KPI header).
2. KPI call:
   - A7: `GET /api/external/stations/:id/statistics?startDate&endDate&productModelId&productCode`
   - Source table: `product_inspections`
3. Point table call:
   - A10: `GET /api/external/stations/:id/point-detail?startDate&endDate&productModelId&productCode`
   - Source tables: `measurement_results` + `product_inspections` + `measurement_point_defs`
4. Client maps A10 response into `pointDataMap[stationId][productCode::pointId]` via `applyA10PointData`.

### 1.3.1 Important overwrite/reset behavior
1. `applyA10PointData` resets A10 fields for the product prefix before overlaying new rows.
2. If a call succeeds but returns empty points, the map is actively reset to zero for that product prefix.
3. Polling and refresh use the same reset/apply path.

So one "empty" successful call can overwrite previously visible values.

### 1.4 FloatingPanel data (on point press)
For selected pointDefId (`point.id`):
1. C2 Trend/Statistics:
   - `GET /api/external/inspections/trend?pointDefId&stationId&productModelId&startDate&endDate`
2. C3 Defect Pareto:
   - `GET /api/external/inspections/defect-pareto?stationId&productModelId&startDate&endDate`
3. C4 Images:
   - `GET /api/external/inspections/images?stationId&pointDefId&result&startDate&endDate`
   - Fallback to A10 `errorImages` for NG only when C4 fails
4. C5 Measurements:
   - `GET /api/external/inspections/measurements?pointDefId&stationId&productModelId&startDate&endDate`
5. C6 Events (station-level):
   - `GET /api/external/inspections/events?stationId&startDate&endDate`

### 1.4.1 Guard conditions that skip panel fetch
1. If `apiStationId` is null/invalid, panel calls are skipped.
2. Product filters (`productCode`, `productModelId`) are optional in requests but when present can narrow results to empty.
3. If selected point changes quickly, stale responses are dropped by point guard ref.

### 1.5 Why canvas can show NG while panel/table are empty
- Canvas status can come from realtime MQTT alerts.
- LeftPanel/FloatingPanel statistics rely on DB records (`product_inspections`, `measurement_results`).
- Therefore MQTT can show NG while DB-backed API sections are empty.

## 2) APIs Re-checked

## Client API calls used by StationDetailScreen
- A6 products: `stationService.getStationProducts`
- A7 KPI: `stationService.getStationStatistics`
- A10 point detail: `stationService.getStationPointDetail`
- C2 trend: `stationService.getMeasurementPointStatistics`
- C3 pareto: `stationService.getDefectPareto`
- C4 images: `stationService.getInspectionImages`
- C5 measurements: `stationService.getInspectionMeasurements`
- C6 events: `stationService.getInspectionEvents`
- Fallback product list: `stationService.getProductList`
- Product detail: `stationService.getProductFullData`

## Server endpoints confirmed
- A7 `/api/external/stations/:id/statistics`
- A10 `/api/external/stations/:id/point-detail`
- C2 `/api/external/inspections/trend`
- C3 `/api/external/inspections/defect-pareto`
- C4 `/api/external/inspections/images`
- C5 `/api/external/inspections/measurements`
- C6 `/api/external/inspections/events`

## 3) Root-Cause Matrix for Empty Data

### Case A (HIGH) - Missing DB data for the selected time range
Symptoms:
- LeftPanel KPI = 0
- Point table TTs/NG%/NTF% mostly 0
- FloatingPanel statistics/images/measurements empty

Reason:
- A7 uses `product_inspections`
- A10/C2/C3/C4/C5 use `measurement_results` joined with `product_inspections`
- If records are absent for selected station/product/date, APIs correctly return empty/zero.

### Case A1 (HIGH) - Query mismatch between app and Postman (same endpoint, different filters)
Symptoms:
- Postman returns full data.
- App shows empty/zero intermittently.

Reason:
- App sends additional filters (`stationId`, `productCode`, `productModelId`, `pointDefId`, `result`, date range).
- Postman testing often omits one or more filters or uses different values.
- A narrowed filter set can legitimately return empty while broad Postman query still has data.

### Case B (HIGH) - Station ID mismatch (`apiStationId` unresolved or non-numeric)
Symptoms:
- Product list or panel fetches fail or return empty
- Diagnostic text can show null/invalid station mapping

Reason:
- External API station routes require numeric `:id`
- If app uses fallback station key like `AVI-01` instead of numeric ID, request can fail.

### Case B1 (HIGH) - Station key migration timing (MQTT key vs numeric key)
Symptoms:
- Data appears in logs but does not bind to active station view consistently.

Reason:
- Store can temporarily hold data under one station key then migrate to another.
- UI selector may read map from active key while fresh data is still under pre-migration key.

### Case C (HIGH, already fixed) - A10 omitted product-level points when machine-scoped points existed
Symptoms:
- LeftPanel table had data for only a small subset of points; others always 0.

Reason:
- Previous A10 logic only fetched productModel points as fallback when machine/workstation query returned zero rows.
- Product-level points (`machineId` null) were excluded when any machine point existed.

Status:
- Fixed by always merging productModel points in A10.

### Case D (MEDIUM) - `selectedProduct` is null (product load failed)
Symptoms:
- FloatingPanel sections remain empty despite point click.

Reason:
- C2/C3/C4/C5 logic depends on `selectedProduct.code`; if null, data fetch is skipped.

### Case D1 (MEDIUM) - Wrong selected product causes false-empty
Symptoms:
- API has data for station in Postman.
- LeftPanel/FloatingPanel in app shows empty for many points.

Reason:
- App auto-selects product from station product list.
- If selected product does not match actual running product, app adds wrong `productCode/productModelId` filters and gets empty results.

### Case E (MEDIUM) - C4 result filter behavior for NTF
Symptoms:
- Images section empty only for NTF filter.

Reason:
- C4 server supports `OK|NG|ALL`; client maps NTF to ALL then filters client-side.
- If no non-OK/non-NG rows exist, NTF list is empty by design.

### Case E1 (MEDIUM) - Workstation filter hides A10 rows
Symptoms:
- A10 has data in Postman.
- LeftPanel still mostly zero in app.

Reason:
- Client applies local `workstationId` filter to A10 rows before mapping into `pointDataMap`.
- If app setting `workstationId` differs from server data, rows are filtered out client-side.

### Case F (LOW) - Date boundary/timezone misunderstanding
Symptoms:
- "Today" appears empty near day boundaries.

Reason:
- Client builds local-day range; server normalizes local date string.
- If machine writes timestamps in unexpected timezone/window, data may fall outside queried range.

### Case G (MEDIUM) - Successful empty response overwrites non-empty UI state
Symptoms:
- UI briefly shows data, then returns to zero/empty.

Reason:
- `applyA10PointData` reset path runs on every successful response (including empty array).
- A subsequent poll/refresh response with no rows clears previous mapped values.

## 4) Practical Validation Order (fast triage)

1. Confirm `apiStationId` is numeric in UI diagnostics/logs.
2. Compare app request query params vs Postman params for the same endpoint.
3. Confirm `selectedProduct` exists and matches active board.
4. Check app `workstationId` setting and whether it filters A10 rows.
5. Check A7 response totals for today.
6. Check A10 `points.length` and whether key points are returned after client-side filters.
7. For one pointDefId, check C2 and C5 response counts with exact same station/product/date params as app.
8. If canvas shows NG but C2/C5 are empty, verify DB ingestion pipeline to `measurement_results`.

## 5) Conclusion

Most empty-data incidents in this screen are data-pipeline or identity-mapping issues, not rendering bugs:
- Realtime MQTT drives marker colors.
- DB-backed APIs drive KPI/table/panel metrics.
- If DB records are missing (or station/product filters do not resolve), LeftPanel and FloatingPanel will appear empty even when canvas shows alerts.
