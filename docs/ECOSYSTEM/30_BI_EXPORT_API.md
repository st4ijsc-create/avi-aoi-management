# 30 — Raw Export & BI Dataset API (doc 27 §6 A10 · W5-D · 2026-07-04)

Two additive HTTP surfaces for getting inspection data OUT of the system:

| Surface | Purpose | Auth |
|---|---|---|
| `/api/export/*` | Raw row-level export, **streaming** CSV/JSON | Browser session **or** API key with scope `export:read` |
| `/api/bi/*` | Stable **aggregate** dataset feed for Power BI / Tableau, paged JSON + `nextToken` | API key with scope `bi:read` |

API keys are managed on the admin API-keys page (`api_keys` table, SHA-256-hashed).
Pass the key as `Authorization: Bearer <key>` or `X-API-Key: <key>`.
The `MASTER_API_KEY` super-key implicitly holds both scopes.

---

## 1. Raw export — `/api/export`

### Endpoints

```
GET /api/export/inspections.csv     GET /api/export/inspections.json
GET /api/export/measurements.csv    GET /api/export/measurements.json
```

### Parameters

| Param | Required | Notes |
|---|---|---|
| `from`, `to` | **YES** | ISO-8601 date/datetime. Span capped at **92 days** (`EXPORT_MAX_WINDOW_DAYS`) → 400 otherwise. |
| `machineId` | no | integer |
| `result` | no | `OK` \| `NG` \| `NTF` |
| `product` | no | substring match on `productModel` |
| `factoryCode`, `corporateCode` | no | exact match |

### Behaviour

- **Streaming**: rows are cursor/keyset-paged out of the DB (500/1000-row pages)
  and written per page — the server never buffers the full set. Multi-million-row
  windows download fine; client disconnect stops the DB loop.
- **Columns (inspections)** = the audited list projection (doc 27 B9):
  `id, serialNumber, overallResult, originalResult, aiDecision, inspectionTime,
  cycleTime, machineId, productModelId, productModel, batchNumber, corporateCode,
  factoryCode, workshopCode, lineCode, stageCode, acknowledgedBy, acknowledgedAt, createdAt`.
- **Columns (measurements)**: `id, inspectionId, serialNumber, inspectionTime,
  machineId, pointDefId, pointCode, pointName, measuredValue, measuredValueText,
  result, defectCatalogId, defectCode, defectName, defectSeverity, aiConfidence`.
  Measurement rollups deliberately live on this separate endpoint (volume), not on
  an `?include=` of the inspections export.
- **Tenant scoping**: session callers see only rows their corporate/factory
  assignments allow (same access filter as the History list). API-key callers with
  `export:read` see all rows (keys are admin-issued).
- **JSON shape**: `{"dataset":"...","from":"...","to":"...","rows":[...],"count":N}`
  (rows streamed; the document is a single valid JSON object).
- **CSV**: RFC-4180 (quoted/escaped, CRLF), header row first, dates as ISO-8601 UTC.
- **Rate limit**: 10 exports / 5 min / principal (`EXPORT_RATE_LIMIT_PER_5MIN`) on
  top of the global API limiter.
- **Audit**: every call writes an `audit_logs` row (action `export`) with who,
  window, filters, row count and completion status.
- **Mid-stream failure**: the connection is destroyed (truncated download) rather
  than silently ending a partial file as if complete.

### Examples

```bash
# CSV, one June week of NG boards on machine 12
curl -H "X-API-Key: $KEY" -o ng.csv \
  "https://host/api/export/inspections.csv?from=2026-06-01&to=2026-06-08&machineId=12&result=NG"

# JSON measurements for the same window
curl -H "Authorization: Bearer $KEY" \
  "https://host/api/export/measurements.json?from=2026-06-01&to=2026-06-08&machineId=12"
```

---

## 2. BI dataset feed — `/api/bi`

### Endpoints

```
GET /api/bi/datasets            → catalog (names, params, columns)
GET /api/bi/datasets/:name      → one page of rows + nextToken
```

### Datasets

| Name | Grain | Columns |
|---|---|---|
| `inspections_daily` | machine × factory-TZ day | `day, machine_id, total, ok, ng, ntf, yield_rate` — **canonical final yield** ((ok+ntf)/total, doc 27 decision #4). Served from the `hourly_yield_cache` MV when fresh (same rule as the dashboard, gap A7), live query otherwise. |
| `defect_pareto` | defect class (defect_catalog) | `defect_code, defect_name, defect_name_vi, count, pct` — NG measurements in the window; unclassified NG → `UNCLASSIFIED`. |
| `machine_oee` | machine × day | `day, machine_id, machine_code, availability, performance, quality, oee, total_count, good_count, reject_count` (percent values, from `oee_metrics`). |

### Parameters (all datasets)

| Param | Default | Notes |
|---|---|---|
| `from` / `to` | last 30 days | ISO-8601; span capped at 366 days (`BI_MAX_WINDOW_DAYS`) |
| `machineId` | — | optional filter |
| `pageSize` | 1000 | max 5000 |
| `nextToken` | — | continuation token from the previous page, passed back **verbatim** |

### Paging contract (`@odata.nextLink`-style, plain JSON)

```json
{ "dataset": "inspections_daily", "from": "...", "to": "...",
  "count": 1000, "rows": [ ... ], "nextToken": "eyJvIjoxMDAwfQ" }
```

Loop until `nextToken` is `null`. **OData `$filter` / `$select` / `$orderby` are
NOT supported** — use the `from`/`to`/`machineId` parameters instead.

### Power BI recipe (Web.Contents + pagination)

Power Query (M) — paste into a blank query; set `BaseUrl` and `ApiKey`
(store the key as a parameter, use *Anonymous* auth on the connector since the
key rides in a header):

```m
let
    BaseUrl = "https://host",
    ApiKey  = "YOUR_BI_READ_KEY",
    Dataset = "inspections_daily",
    From    = "2026-06-01",
    To      = "2026-07-01",
    GetPage = (token as nullable text) =>
        let
            Query = [from = From, to = To] &
                    (if token <> null then [nextToken = token] else []),
            Raw = Web.Contents(BaseUrl, [
                RelativePath = "api/bi/datasets/" & Dataset,
                Query = Query,
                Headers = [#"X-API-Key" = ApiKey]
            ]),
            Json = Json.Document(Raw)
        in
            Json,
    Pages = List.Generate(
        () => GetPage(null),
        each _ <> null,
        each if [nextToken] <> null then GetPage([nextToken]) else null,
        each [rows]
    ),
    AllRows = List.Combine(Pages),
    Result = Table.FromRecords(AllRows)
in
    Result
```

Tableau: use the Web Data Connector / a scheduled CSV pull from
`/api/export/inspections.csv` with an `export:read` key.

---

## 3. Ops notes

- Scopes `export:read` and `bi:read` are declared in `server/api/v1/scopes.ts`
  and grantable per key on the API-keys admin page (`*` and namespace wildcards work).
- Routers live in `server/api/export/exportRouter.ts` / `biRouter.ts`, mounted in
  `server/_core/index.ts` next to `/api/v1`.
- Env knobs: `EXPORT_MAX_WINDOW_DAYS` (92), `EXPORT_RATE_LIMIT_PER_5MIN` (10),
  `EXPORT_INSPECTION_PAGE_SIZE` (500), `EXPORT_MEASUREMENT_PAGE_SIZE` (1000),
  `BI_DATASET_PAGE_SIZE` (1000), `BI_DATASET_MAX_PAGE_SIZE` (5000),
  `BI_MAX_WINDOW_DAYS` (366).
