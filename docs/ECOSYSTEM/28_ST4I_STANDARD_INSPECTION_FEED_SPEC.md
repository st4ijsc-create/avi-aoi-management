# ST4I Standard Inspection Feed — Specification v1

**Doc 28 · 2026-07-04 · spec_version 1 · Status: PUBLISHED (normative)**
**Audience:** machine builders / integrators (esp. custom AOI/AVI/SPI vendors) who want their machines to feed the ST4I AVI/AOI Management platform without a custom adapter.
**Origin:** doc 27 gap C2/C6, decision #3 — custom (e.g. Chinese) inspection machines conform to this published spec; the platform ships a normative, strictly-validated `st4i-standard` adapter for it.

---

## 1. Overview

One file (or one message) = **one inspection result for one board/panel side**: a `header` (who/what/when/verdict) plus a `measurements` array (per-point results), plus an optional `attachments` block describing co-dropped image files.

Three encodings of the SAME logical document are defined:

| Encoding | Status | File extension | Notes |
|---|---|---|---|
| **JSON** | **Primary (recommended)** | `.st4i.json` | Canonical field names; richest (supports `extra` objects) |
| CSV | Alternate | `.st4i.csv` | Fixed column order; for PLC/legacy exporters that can only write flat text |
| XML | Alternate | `.st4i.xml` | Element names identical to JSON field names |

Delivery options (either works, same document):

1. **Hot-folder drop** — write the file into the machine's configured watch folder (see §6 for naming + atomic-write rules). The platform's hot-folder service parses the file and hands it to the `st4i-standard` adapter.
2. **HTTP push** — POST the JSON document to the platform ingest endpoint (`visionAdapter.ingest` with `vendorKey: "st4i-standard"`, or the machine API with an API key).

**Hard rules that make the feed trustworthy (violations are rejected):**

- `serial_number` is REQUIRED and non-empty — it drives traceability and First-Pass-Yield (FPY is computed per first inspection of a serial; a feed without serials destroys FPY).
- Every timestamp MUST be RFC 3339 **with an explicit UTC offset** (`Z` or `±hh:mm`). Offset-less local times are rejected. (Lesson learned in production: offset-less exports caused +7-hour report corruption — doc 27 finding A2.)
- Every result token is exactly one of **`OK` | `NG` | `NTF`** (uppercase). `NTF` = machine flagged, re-test/verification judged it not a true defect.
- A document whose `header.result` is `OK` MUST NOT contain any measurement with `result: "NG"`.
- Versioning is **additive-only** (§7): field meanings never change within a major `spec_version`; consumers ignore unknown fields.

---

## 2. Header — field table

JSON path `header.*` (CSV: `H,<field>,<value>` rows; XML: children of `<header>`).

| Field | Type | Req | Description |
|---|---|:---:|---|
| `machine_code` | string ≤50 | **yes** | Machine identity as registered in the platform (e.g. `AOI-01`). The ingest context (API key / configured hot-folder) may override it. |
| `serial_number` | string ≤100 | **yes** | Board/panel serial or barcode. Drives traceability + FPY. Must be non-empty after trim. |
| `program_name` | string ≤100 | **yes** | Inspection program / recipe / job name (maps to platform product model). |
| `program_version` | string ≤50 | no | Program/recipe version (e.g. `1.4.0` or a firmware-side revision id). |
| `lot_code` | string ≤50 | no | Production lot / batch. |
| `panel_id` | string ≤100 | no | Panel barcode when `serial_number` is a single board in a multi-up panel. |
| `board_index` | integer ≥1 | no | 1-based board position within the panel (multi-up). |
| `operator_id` | string ≤50 | no | Operator badge/id logged in at the machine. |
| `started_at` | timestamp | **yes** | Inspection start. RFC 3339 **with mandatory offset** (e.g. `2026-07-04T08:30:00+07:00`). |
| `finished_at` | timestamp | **yes** | Inspection end. Same format. Must be ≥ `started_at`. This is the platform's inspection time. |
| `cycle_time_sec` | number ≥0 | no | Cycle time in seconds. If absent the platform derives `finished_at − started_at`. |
| `result` | `OK`\|`NG`\|`NTF` | **yes** | Board-level verdict. |

Unknown extra header fields are **ignored** by v1 consumers (preserved verbatim by the reference adapter as `rawExtras`). Vendors SHOULD put custom data under `extra` (§3) rather than inventing top-level fields.

## 3. Measurement — field table

JSON path `measurements[]` (CSV: `M,...` rows, §4.2; XML: `<measurement>` elements).

| Field | Type | Req | Description |
|---|---|:---:|---|
| `point_name` | string ≤100 | **yes** | Inspection point / component designator (e.g. `R12`, `R12.1`, `U1.pin5`). Maps to the platform measurement-point code. |
| `type` | string token | no | Point kind. Recommended vocabulary: `component`, `solder_joint`, `paste`, `dimension`, `surface`, `text`, `other`. Lowercase `[a-z][a-z0-9_]*`. |
| `value` | number | no | Headline measured value (finite; no NaN/Inf). |
| `unit` | string ≤20 | no | Unit of `value` (e.g. `%`, `um`, `mm`, `deg`). |
| `lsl` | number | no | Lower spec limit for `value`. |
| `usl` | number | no | Upper spec limit for `value`. |
| `nominal` | number | no | Nominal / target for `value`. |
| `result` | `OK`\|`NG`\|`NTF` | **yes** | Point verdict. |
| `defect_code` | string ≤50 | no | Defect classification, **IPC-A-610-aligned** — use the platform defect catalog codes (§3.1). Required in practice when `result` is `NG`. |
| `severity` | enum | no | `critical` \| `major` \| `minor` \| `cosmetic`. |
| `bbox_px` | object | no | Defect location on the referenced image, **pixels from top-left**: `{ "x": int ≥0, "y": int ≥0, "w": int ≥1, "h": int ≥1 }`. |
| `image_ref` | string ≤255 | no | File name of the co-dropped image for this point (§6.2) or an absolute URL. |
| `values_3d` | object | no | 3D/SPI metrics (§3.2). |
| `remark` | string ≤500 | no | Free text. |
| `extra` | object | no | Vendor extension namespace — arbitrary JSON, preserved losslessly (JSON/XML encodings only; not representable in CSV). |

### 3.1 `defect_code` vocabulary (IPC-A-610 aligned)

Use codes from the platform defect catalog (`defect_catalog.code`, seeded per IPC-A-610 — see `drizzle/0089_p4a_ipc_a610_seed.sql`). Most-used codes:

`BRIDGING`, `INSUFFICIENT_SOLDER`, `EXCESS_SOLDER`, `SOLDER_BALL`, `SOLDER_SPLASH`, `COLD_JOINT`, `DEWETTING`, `NON_WETTING`, `VOID`, `PINHOLE`, `MISSING_COMPONENT`, `WRONG_COMPONENT`, `WRONG_PART_NUMBER`, `REVERSE_POLARITY`, `COMPONENT_MISALIGNMENT`, `SKEW`, `TOMBSTONING`, `BILLBOARDING`, `UPENDED`, `LIFTED_LEAD`, `BENT_LEAD`, `DAMAGED_COMPONENT`, `CRACKED_PACKAGE`, `SCRATCH`, `CONTAMINATION_PARTICLE`, `FOD`, `OCR_FAIL`, `POOR_MARKING`, plus SPI codes `VOLUME_OUT`, `HEIGHT_OUT`, `COPLANARITY_FAIL`, `WARPAGE_HIGH`, `TILT_HIGH`.

A code not in the catalog is accepted (soft reference) but will not classify into IPC Pareto reports until added to the catalog — coordinate new codes with the platform owner.

### 3.2 `values_3d` sub-object (all optional numbers)

| Field | Unit | Canonical column |
|---|---|---|
| `height_um` | µm | valueHeight |
| `area_pct` | % of nominal | valueArea |
| `volume_pct` | % of nominal | valueVolume |
| `void_pct` | % | valueVoidPct |
| `coplanarity_um` | µm | valueCoplanarity |
| `warpage_um` | µm | valueWarpage |
| `offset_x_um` | µm | valueOffsetX |
| `offset_y_um` | µm | valueOffsetY |
| `tilt_deg` | deg | valueTilt |
| `thickness_um` | µm | valueThickness |
| `z_um` | µm | valueZ |

### 3.3 `attachments` block (optional, JSON/XML only)

| Field | Type | Description |
|---|---|---|
| `image_dir` | string | Directory of co-dropped images relative to the result file (default `"."`). |
| `images` | string[] | File names of all images dropped for this inspection (lets the platform detect missing files). |

---

## 4. Encodings

### 4.1 JSON (primary)

- UTF-8, single top-level object. Field names exactly as in §2/§3 (lower `snake_case`).
- Numbers are JSON numbers (parsers MAY additionally coerce numeric strings, but do not rely on it).
- `spec_version` is REQUIRED at top level and is the integer `1`.

Top-level shape:

```json
{
  "spec_version": 1,
  "header":       { ... §2 ... },
  "measurements": [ { ... §3 ... } ],
  "attachments":  { ... §3.3, optional ... }
}
```

### 4.2 CSV (alternate)

- UTF-8 (BOM tolerated), LF or CRLF, RFC-4180 quoting (`"` around cells containing `,` `"` or newlines; `""` escapes a quote).
- **Line 1 (magic, required):** `#ST4I-INSPECTION,1` — identifies the format and carries `spec_version`.
- **Header rows:** `H,<field>,<value>` — one row per §2 field (order free).
- **Measurement rows:** `M,` followed by exactly this fixed column order (trailing empty columns may be omitted; empty cell = field absent):

```
M,point_name,type,value,unit,lsl,usl,nominal,result,defect_code,severity,
  bbox_x,bbox_y,bbox_w,bbox_h,image_ref,remark,
  height_um,area_pct,volume_pct,void_pct,coplanarity_um,warpage_um,
  offset_x_um,offset_y_um,tilt_deg,thickness_um,z_um
```

(27 data columns after the `M` record tag; columns 17-27 are the `values_3d` fields.)
`extra` and `attachments` are NOT representable in CSV — use JSON if you need them.

### 4.3 XML (alternate)

- UTF-8, no DTD (documents with DOCTYPE are rejected — XXE hardening), no namespaces, **no attributes** — data is in child elements whose names are exactly the JSON field names.
- Root element `<st4i_inspection>`; `<spec_version>1</spec_version>` required.
- `bbox_px` → `<bbox_px><x/><y/><w/><h/></bbox_px>`; `values_3d` → `<values_3d><height_um/>…</values_3d>`; each measurement is one `<measurement>` under `<measurements>`; `extra` children are preserved as strings.

---

## 5. Complete examples

### 5.1 JSON — NG board with 2D + 3D points

```json
{
  "spec_version": 1,
  "header": {
    "machine_code": "AOI-01",
    "serial_number": "SN-2026-000123",
    "program_name": "MB-X1-TOP",
    "program_version": "1.4.0",
    "lot_code": "LOT-77",
    "panel_id": "PNL-88",
    "board_index": 2,
    "operator_id": "OP-0009",
    "started_at": "2026-07-04T08:30:00+07:00",
    "finished_at": "2026-07-04T08:30:12.480+07:00",
    "cycle_time_sec": 12.48,
    "result": "NG"
  },
  "measurements": [
    {
      "point_name": "R12.1",
      "type": "solder_joint",
      "value": 61.2,
      "unit": "%",
      "lsl": 70,
      "usl": 130,
      "nominal": 100,
      "result": "NG",
      "defect_code": "INSUFFICIENT_SOLDER",
      "severity": "major",
      "bbox_px": { "x": 120, "y": 340, "w": 48, "h": 32 },
      "image_ref": "SN-2026-000123__R12.1.jpg",
      "values_3d": {
        "height_um": 95.0, "area_pct": 88.0, "volume_pct": 61.2,
        "void_pct": 2.1, "coplanarity_um": 3.0, "warpage_um": 1.2,
        "offset_x_um": -3.5, "offset_y_um": 1.1, "tilt_deg": 0.4,
        "thickness_um": 40, "z_um": 130
      },
      "remark": "insufficient fillet on pad 1"
    },
    {
      "point_name": "C3",
      "type": "component",
      "value": 99.1,
      "unit": "%",
      "result": "OK"
    },
    {
      "point_name": "U1.pin5",
      "type": "solder_joint",
      "result": "NTF",
      "defect_code": "BRIDGING",
      "severity": "minor",
      "bbox_px": { "x": 610, "y": 900, "w": 22, "h": 18 },
      "image_ref": "SN-2026-000123__U1.pin5.jpg"
    }
  ]
}
```

### 5.2 CSV — the same board

```csv
#ST4I-INSPECTION,1
H,machine_code,AOI-01
H,serial_number,SN-2026-000123
H,program_name,MB-X1-TOP
H,program_version,1.4.0
H,lot_code,LOT-77
H,panel_id,PNL-88
H,board_index,2
H,operator_id,OP-0009
H,started_at,2026-07-04T08:30:00+07:00
H,finished_at,2026-07-04T08:30:12.480+07:00
H,cycle_time_sec,12.48
H,result,NG
M,R12.1,solder_joint,61.2,%,70,130,100,NG,INSUFFICIENT_SOLDER,major,120,340,48,32,SN-2026-000123__R12.1.jpg,insufficient fillet on pad 1,95.0,88.0,61.2,2.1,3.0,1.2,-3.5,1.1,0.4,40,130
M,C3,component,99.1,%,,,,OK
M,U1.pin5,solder_joint,,,,,,NTF,BRIDGING,minor,610,900,22,18,SN-2026-000123__U1.pin5.jpg
```

### 5.3 XML — the same board (abbreviated to 2 points)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<st4i_inspection>
  <spec_version>1</spec_version>
  <header>
    <machine_code>AOI-01</machine_code>
    <serial_number>SN-2026-000123</serial_number>
    <program_name>MB-X1-TOP</program_name>
    <program_version>1.4.0</program_version>
    <lot_code>LOT-77</lot_code>
    <panel_id>PNL-88</panel_id>
    <board_index>2</board_index>
    <operator_id>OP-0009</operator_id>
    <started_at>2026-07-04T08:30:00+07:00</started_at>
    <finished_at>2026-07-04T08:30:12.480+07:00</finished_at>
    <cycle_time_sec>12.48</cycle_time_sec>
    <result>NG</result>
  </header>
  <measurements>
    <measurement>
      <point_name>R12.1</point_name>
      <type>solder_joint</type>
      <value>61.2</value>
      <unit>%</unit>
      <lsl>70</lsl><usl>130</usl><nominal>100</nominal>
      <result>NG</result>
      <defect_code>INSUFFICIENT_SOLDER</defect_code>
      <severity>major</severity>
      <bbox_px><x>120</x><y>340</y><w>48</w><h>32</h></bbox_px>
      <image_ref>SN-2026-000123__R12.1.jpg</image_ref>
      <values_3d>
        <height_um>95.0</height_um><area_pct>88.0</area_pct><volume_pct>61.2</volume_pct>
        <void_pct>2.1</void_pct><coplanarity_um>3.0</coplanarity_um><warpage_um>1.2</warpage_um>
        <offset_x_um>-3.5</offset_x_um><offset_y_um>1.1</offset_y_um><tilt_deg>0.4</tilt_deg>
        <thickness_um>40</thickness_um><z_um>130</z_um>
      </values_3d>
      <remark>insufficient fillet on pad 1</remark>
    </measurement>
    <measurement>
      <point_name>C3</point_name>
      <type>component</type>
      <value>99.1</value>
      <unit>%</unit>
      <result>OK</result>
    </measurement>
  </measurements>
</st4i_inspection>
```

---

## 6. Hot-folder delivery: file + image naming, atomic writes

### 6.1 Result file naming

```
<machine_code>__<serial_number>__<finished_at compact>.st4i.<json|csv|xml>
```

- `finished_at compact` = `yyyyMMddTHHmmss±hhmm` with `:` removed (Windows-safe), e.g. `20260704T083012+0700`.
- Example: `AOI-01__SN-2026-000123__20260704T083012+0700.st4i.json`
- Double underscore `__` is the field separator; `machine_code`/`serial_number` therefore MUST NOT contain `__`.
- The file name is a delivery convenience only — the parsed content is authoritative.

### 6.2 Image co-drop naming

Images referenced by `image_ref` are dropped in the SAME folder (or `attachments.image_dir`) **before** the result file:

```
<serial_number>__<point_name sanitized>.<jpg|png>     — per-point defect image
<serial_number>__board.<jpg|png>                      — optional whole-board overview
```

- `point_name sanitized` = characters outside `[A-Za-z0-9._-]` replaced with `-`.
- `image_ref` carries the exact file name (or an absolute `http(s)://` URL if the vendor hosts images).

### 6.3 Atomic write protocol (mandatory for hot-folder)

1. Write the complete file as `<final-name>.tmp` (same folder/volume).
2. Flush + close, then **rename** to the final name. Rename is atomic on the same volume.
3. Drop images FIRST, the result file LAST — the result file arriving signals "inspection complete".
4. The watcher ignores `*.tmp`. Files that fail to parse are moved to the configured `error/` folder untouched (never deleted), successes to `archive/`.

---

## 7. Versioning rules

- `spec_version` is a REQUIRED integer. This document defines `spec_version: 1`.
- Within a major version, changes are **additive-only**: new OPTIONAL fields may be added; existing fields never change name, type, unit, or meaning; required fields never become "more required".
- Consumers MUST ignore unknown fields (the reference adapter preserves them as `rawExtras` — nothing is lost, nothing breaks).
- A breaking change increments `spec_version`; the platform adapter validates the version and rejects documents with an unsupported version with a clear error (it never guesses).
- Vendor-custom data belongs in `extra` (per measurement) — it is passed through losslessly and will never collide with future spec fields.

## 8. Validation rules (enforced by the `st4i-standard` adapter)

1. `spec_version` present and `== 1` (string `"1"` tolerated in CSV/XML; unsupported versions rejected).
2. Required header fields present (§2); `serial_number`, `machine_code`, `program_name` non-empty after trim.
3. `started_at`, `finished_at` match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$` (explicit offset REQUIRED) and `finished_at ≥ started_at`.
4. All result tokens exactly `OK` | `NG` | `NTF` (uppercase).
5. If `header.result` is `OK`, no measurement may be `NG`.
6. Numbers finite (no NaN/Infinity); `cycle_time_sec ≥ 0`; `board_index ≥ 1` integer.
7. `bbox_px`: all four of `x,y,w,h` present together; integers; `x,y ≥ 0`; `w,h ≥ 1`.
8. `severity` ∈ `critical|major|minor|cosmetic`; `type` matches `^[a-z][a-z0-9_]*$`.
9. Unknown fields do NOT fail validation (additive-only forward compatibility) — they are preserved as `rawExtras`.
10. CSV: line 1 magic `#ST4I-INSPECTION,<version>` required; `M` rows must not have more than 27 data columns.
11. XML: root `<st4i_inspection>` required; documents containing a DOCTYPE are rejected.

Malformed documents are rejected as a whole (no partial ingest) with an error naming the offending field — the file goes to the hot-folder `error/` directory for inspection.

## 9. Canonical mapping (reference — what the platform stores)

| Spec field | Platform canonical field |
|---|---|
| `header.machine_code` | `machineCode` (ingest context may override) |
| `header.serial_number` | `serialNumber` |
| `header.program_name` | `productModel` |
| `header.lot_code` | `batchNumber` |
| `header.operator_id` | `operatorId` |
| `header.finished_at` | `inspectionTime` |
| `header.cycle_time_sec` (or derived) | `cycleTime` |
| `header.result` | `overallResult` |
| `measurements[].point_name` | `pointCode` |
| `measurements[].value` | `measuredValue` |
| `measurements[].result` | `result` |
| `measurements[].defect_code` | `defectCatalogCode` |
| `measurements[].severity` | `defectSeverity` |
| `measurements[].bbox_px.{x,y,w,h}` | `defectBboxX/Y/W/H` |
| `measurements[].image_ref` | `imageBase64` (reference passthrough) |
| `measurements[].values_3d.*` | `valueHeight/Area/Volume/VoidPct/Coplanarity/Warpage/OffsetX/OffsetY/Tilt/Thickness/Z` |
| `unit`, `lsl`, `usl`, `nominal`, `type` | folded into `remark` (`spec[lsl..usl] nominal=… unit=…`) + preserved in `rawExtras` |
| `program_version`, `panel_id`, `board_index`, `attachments`, `extra`, unknown fields | `rawExtras` (lossless) |

---

## 10. Tóm tắt tiếng Việt (Vietnamese summary)

**Mục đích:** Chuẩn dữ liệu công bố cho máy AOI/AVI/SPI tự chế (đặc biệt máy Trung Quốc custom) xuất kết quả kiểm tra vào hệ thống ST4I mà không cần viết adapter riêng (doc 27, quyết định #3).

**Nội dung chính:**
- **1 file = 1 lần kiểm tra 1 board/panel**, gồm `header` (máy, serial, chương trình, thời gian, kết quả tổng) + mảng `measurements` (từng điểm đo) + `attachments` (ảnh kèm theo).
- **3 định dạng tương đương:** JSON (khuyến nghị, `.st4i.json`), CSV (`.st4i.csv`, dòng 1 phải là `#ST4I-INSPECTION,1`, dòng `H,` cho header, dòng `M,` cho điểm đo theo thứ tự cột cố định §4.2), XML (`.st4i.xml`, phần tử trùng tên trường JSON).
- **Bắt buộc:** `serial_number` (truy vết + FPY), `machine_code`, `program_name`, `started_at`/`finished_at` **có múi giờ tường minh** (`+07:00` — tuyệt đối không gửi giờ local không offset, đã từng gây sự cố lệch +7h), `result` chỉ nhận `OK`/`NG`/`NTF` (viết hoa).
- **Mã lỗi (`defect_code`)** dùng danh mục IPC-A-610 của hệ thống (`BRIDGING`, `MISSING_COMPONENT`, `INSUFFICIENT_SOLDER`, `TOMBSTONING`, `REVERSE_POLARITY`…) — xem §3.1.
- **Vị trí lỗi:** `bbox_px` = khung pixel `{x,y,w,h}` tính từ góc trên-trái ảnh; ảnh kèm đặt tên `<serial>__<tên điểm>.jpg` thả vào cùng thư mục hot-folder TRƯỚC, file kết quả thả SAU CÙNG, ghi file tạm `.tmp` rồi rename (ghi nguyên tử, §6.3).
- **Phiên bản:** trường `spec_version` bắt buộc; trong cùng phiên bản chỉ được THÊM trường tùy chọn, không đổi nghĩa/tên/kiểu trường cũ; trường lạ bị bỏ qua (không gây lỗi); dữ liệu riêng của vendor đặt trong `extra`.
- **Kiểm định:** adapter `st4i-standard` của hệ thống validate chặt (§8) — file sai bị từ chối toàn bộ, chuyển vào thư mục `error/`, báo rõ trường lỗi.

**Liên hệ:** đội ST4I cấp `machine_code`, API key/thư mục hot-folder, và bổ sung mã lỗi mới vào danh mục nếu cần.

---

*Doc 28 · ST4I Standard Inspection Feed v1 · normative reference implementation: `server/services/vision/adapters/st4iStandard.ts` + conformance fixtures `server/services/vision/adapters/__fixtures__/st4i-standard/` · published 2026-07-04.*
