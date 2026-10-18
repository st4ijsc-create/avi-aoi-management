import { test } from "node:test";
import assert from "node:assert/strict";
import { kiemCauHinh, laMayPlc } from "../src/cauHinh.ts";

test("cấu hình hợp lệ đầy đủ", () => {
  const vao = JSON.parse(`{
    "phienBan": 1, "tenNhaMay": "ST4I", "ghiNhat": true,
    "may": [
      { "loai": "aoi", "ten": "AOI-1", "cong": 8080, "doPhanGiai": 12.5 },
      { "loai": "plc", "ten": "PLC-1", "cong": 502, "diaChi": "10.0.0.2", "chuKyMs": 50 },
      { "loai": "camera", "ten": "CAM-1", "url": "rtsp://10.0.0.9/luong" }
    ]
  }`);
  assert.deepEqual(kiemCauHinh(vao), {
    ok: true,
    giaTri: {
      phienBan: 1, tenNhaMay: "ST4I", ghiNhat: true,
      may: [
        { loai: "aoi", ten: "AOI-1", cong: 8080, doPhanGiai: 12.5 },
        { loai: "plc", ten: "PLC-1", cong: 502, diaChi: "10.0.0.2", chuKyMs: 50 },
        { loai: "camera", ten: "CAM-1", url: "rtsp://10.0.0.9/luong" },
      ],
    },
  });
});

test("gom nhiều lỗi kèm đường dẫn", () => {
  const kq = kiemCauHinh({ phienBan: 1, may: [{ loai: "aoi", ten: "A", cong: 70000 }] });
  assert.deepEqual(kq, {
    ok: false,
    loi: [
      { duong: "tenNhaMay", thongDiep: "thiếu" },
      { duong: "may[0].cong", thongDiep: "phải là số nguyên 1..65535" },
    ],
  });
});

test("type guard laMayPlc", () => {
  assert.equal(laMayPlc({ loai: "plc", ten: "P", cong: 502, diaChi: "1.2.3.4", chuKyMs: 100 }), true);
  assert.equal(laMayPlc({ loai: "camera", ten: "C", url: "http://x/" }), false);
});
