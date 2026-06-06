# Measurement Geometry & Fiducial Marks — P1 API Reference

> **Scope**: This document describes the P1 additive extensions to the Machine ↔ Server
> measurement-points sync API. All fields documented here are **backward compatible** —
> legacy clients that ignore them continue to work unchanged.

## 1. Coordinate modes

`productModels.coordinateMode` (new column, default `"pixel"`):

| Value | Meaning |
|-------|---------|
| `pixel` | All `positionX/Y`, `radius`, geometry vertices are integer pixel offsets in the product reference image. (Legacy behavior.) |
| `mm`    | All numeric coordinates are physical millimetres relative to the product origin. The server still also stores `normalizedX/Y` for cross-resolution clients. |

Returned in `deltaSyncPoints` as `coordinateMode`.

## 2. Measurement-point shapes (`shape` + `geometry`)

Two new optional columns on `measurement_point_defs`:

| Column     | Type            | Default    | Notes |
|------------|-----------------|------------|-------|
| `shape`    | varchar(20)     | `"circle"` | One of `circle | rectangle | polygon | line | ring | mask | array` |
| `geometry` | jsonb           | `null`     | Discriminated-union payload tagged by `shape` |

When `shape === "circle"` (the default), `geometry` may be omitted and the legacy
`positionX / positionY / radius` columns remain authoritative. For all other shapes,
the server derives a **legacy circle anchor** from the geometry on write so old clients
still receive a usable `positionX / positionY / radius`.

### 2.1 `circle`
```json
{ "shape": "circle", "cx": 320, "cy": 240, "r": 18 }
```

### 2.2 `rectangle`
```json
{ "shape": "rectangle", "x": 100, "y": 80, "w": 200, "h": 120, "rotation": 0 }
```
`rotation` is in degrees, clockwise, around the rectangle centre. Optional, default `0`.

### 2.3 `polygon`
```json
{ "shape": "polygon", "points": [[100,80],[260,80],[260,200],[180,260],[100,200]] }
```
Minimum 3 vertices. Self-intersecting polygons are accepted but renderers may use even-odd fill.

### 2.4 `line`
```json
{ "shape": "line", "x1": 50, "y1": 50, "x2": 400, "y2": 220, "thickness": 4 }
```
`thickness` is in pixels (or mm in mm-mode). Default `1`.

### 2.5 `ring`
```json
{ "shape": "ring", "cx": 320, "cy": 240, "rOuter": 40, "rInner": 25 }
```
`rInner < rOuter` is required.

### 2.6 `mask`
```json
{
  "shape": "mask",
  "bbox": { "x": 100, "y": 80, "w": 200, "h": 120 },
  "encoding": "rle",
  "data": "AB12CD34..."
}
```
- `encoding`: `"rle"` (run-length, recommended) or `"base64png"` (1-bit PNG payload).
- `data`: base64-encoded mask body. Decoder MUST use `bbox` for placement.

### 2.7 `array`
```json
{
  "shape": "array",
  "origin": { "x": 100, "y": 80 },
  "cellShape": "circle",
  "cellSize": { "w": 16, "h": 16 },
  "rows": 4,
  "cols": 6,
  "rowSpacing": 28,
  "colSpacing": 28,
  "rotation": 0
}
```
`cellShape` is one of `circle | rectangle`. The server **expands** array geometry on
read into a flat `cells` array (see §4.2) so machines that don't understand `array`
can still iterate cells.

## 3. Fiducial marks (`fiducial_marks` table)

Per-product alignment landmarks. Stored in their own table; surfaced to machines
as a top-level `fiducials` array on `deltaSyncPoints` responses.

Columns:

| Column            | Type              | Notes |
|-------------------|-------------------|-------|
| `id`              | serial PK         |       |
| `productModelId`  | int FK → product_models | required |
| `code`            | varchar(50)       | unique per product (where deletedAt IS NULL) |
| `name`            | varchar(255)      |       |
| `type`            | varchar(20)       | `cross | circle | square | custom` |
| `positionX`       | int               | required |
| `positionY`       | int               | required |
| `normalizedX`     | numeric(12,8)     | optional |
| `normalizedY`     | numeric(12,8)     | optional |
| `searchWindowW`   | int               | optional, default 64 |
| `searchWindowH`   | int               | optional, default 64 |
| `templateImageUrl`| text              | optional |
| `templateImageKey`| text              | optional |
| `orderIndex`      | int               | for stable ordering |
| `isActive`        | boolean           | default true |
| `deletedAt`       | timestamp         | soft delete |
| `createdAt`/`updatedAt` | timestamp   |       |

### 3.1 tRPC procedures (`fiducialMark.*`, admin-protected)

| Procedure                         | Input                                                                                  | Output |
|-----------------------------------|----------------------------------------------------------------------------------------|--------|
| `listByProductModel`              | `{ productModelId: number }`                                                           | `FiducialMark[]` |
| `getById`                         | `{ id: number }`                                                                       | `FiducialMark` |
| `create`                          | `{ productModelId, code, name, type, positionX, positionY, normalizedX?, normalizedY?, searchWindowW?, searchWindowH?, orderIndex? }` | `{ id: number }` |
| `update`                          | `{ id, ...partial }`                                                                   | `{ ok: true }` |
| `delete`                          | `{ id }`                                                                               | `{ ok: true }` (soft delete) |
| `uploadTemplateImage`             | `{ id, imageBase64, imageMimeType }`                                                   | `{ url, key }` |

All mutations are audit-logged (`entityType: "fiducial_mark"`, `action: "create | update | delete | upload_template"`).

## 4. Machine sync API additions

### 4.1 `syncMeasurementPoints` (push)
Each `points[i]` may now optionally include:
```json
{ "code": "P01", "name": "...", "positionX": 100, "positionY": 80,
  "shape": "rectangle",
  "geometry": { "shape": "rectangle", "x": 100, "y": 80, "w": 50, "h": 30 } }
```
If `shape`/`geometry` are present, they are persisted alongside `positionX/Y/radius`.
If absent, behavior is identical to the legacy contract.

### 4.2 `deltaSyncPoints` (pull)
Response is **additively extended** with three new top-level / per-point fields:

```jsonc
{
  "success": true,
  "hasChanges": true,
  "currentVersion": 17,
  "sinceVersion": 14,
  "serverImageWidth": 1920,
  "serverImageHeight": 1080,
  "coordinateMode": "pixel",          // NEW
  "fiducials": [                       // NEW — top-level
    {
      "id": 1, "code": "F1", "name": "Top-Left",
      "type": "cross", "positionX": 50, "positionY": 50,
      "normalizedX": 0.026, "normalizedY": 0.046,
      "searchWindowW": 64, "searchWindowH": 64,
      "templateImageUrl": null, "orderIndex": 0
    }
  ],
  "points": [
    {
      "id": 42, "code": "P03", "name": "Solder pad", "...": "...",
      "positionX": 320, "positionY": 240, "radius": 18,
      "shape": "array",                                              // NEW
      "geometry": { "shape": "array", "origin": {"x":300,"y":220},   // NEW
        "cellShape":"circle","cellSize":{"w":16,"h":16},
        "rows":2, "cols":3, "rowSpacing":24, "colSpacing":24 },
      "cells": [                                                     // NEW (only when shape=="array")
        { "row": 0, "col": 0, "x": 308, "y": 228 },
        { "row": 0, "col": 1, "x": 332, "y": 228 },
        { "row": 0, "col": 2, "x": 356, "y": 228 },
        { "row": 1, "col": 0, "x": 308, "y": 252 },
        { "row": 1, "col": 1, "x": 332, "y": 252 },
        { "row": 1, "col": 2, "x": 356, "y": 252 }
      ]
    }
  ]
}
```

**Backward-compatibility guarantees**

- Clients that only know `circle` may ignore `shape`, `geometry`, `cells`, `fiducials`,
  and `coordinateMode` and continue to use `positionX/Y/radius`.
- The server always populates legacy anchor fields, even for non-circle shapes.
- The `fiducials` array is empty (not omitted) when no fiducials are configured.
