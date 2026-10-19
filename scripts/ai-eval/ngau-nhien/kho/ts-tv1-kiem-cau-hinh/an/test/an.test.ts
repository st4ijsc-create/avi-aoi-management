import { test } from "node:test";
import assert from "node:assert/strict";
import { kiemCauHinh, laMayPlc, moTaMay } from "../src/cauHinh.ts";
import type { May } from "../src/cauHinh.ts";

const goc = (may: unknown[]) => ({ phienBan: 1, tenNhaMay: "NM", may });
const loiCua = (x: unknown) => {
  const kq = kiemCauHinh(x);
  return kq.ok ? [] : kq.loi;
};

test("tối thiểu: mặc định ghiNhat=false, may=[], tên được trim", () => {
  assert.deepEqual(kiemCauHinh({ phienBan: 1, tenNhaMay: "  Nhà máy A " }), {
    ok: true,
    giaTri: { phienBan: 1, tenNhaMay: "Nhà máy A", ghiNhat: false, may: [] },
  });
});

test("mặc định theo loại máy, bỏ khoá lạ, trim tên máy", () => {
  const kq = kiemCauHinh({
    phienBan: 1, tenNhaMay: "NM", ghiChu: "bỏ", ghiNhat: undefined,
    may: [
      { loai: "aoi", ten: " A1 ", cong: 1, mau: "xanh" },
      { loai: "plc", ten: "P1", diaChi: "0.0.0.0" },
      { loai: "camera", ten: "C1", url: "https://cam.local/x", cong: "lờ đi" },
    ],
  });
  assert.deepEqual(kq, {
    ok: true,
    giaTri: {
      phienBan: 1, tenNhaMay: "NM", ghiNhat: false,
      may: [
        { loai: "aoi", ten: "A1", cong: 1, doPhanGiai: 10 },
        { loai: "plc", ten: "P1", cong: 502, diaChi: "0.0.0.0", chuKyMs: 100 },
        { loai: "camera", ten: "C1", url: "https://cam.local/x" },
      ],
    },
  });
});

test("gốc không phải đối tượng ⇒ đúng một lỗi đường rỗng", () => {
  for (const x of [null, [], "cấu hình", 5, undefined, true]) {
    assert.deepEqual(kiemCauHinh(x), { ok: false, loi: [{ duong: "", thongDiep: "phải là đối tượng" }] }, String(x));
  }
});

test("gom TẤT CẢ lỗi theo đúng thứ tự", () => {
  const x = {
    phienBan: 2, tenNhaMay: "   ", ghiNhat: null,
    may: [
      { loai: "aoi", ten: "", cong: 0, doPhanGiai: -1 },
      7,
      { ten: "X" },
      { loai: "robot", ten: 5, cong: -1 },
      { loai: "plc", ten: "P", cong: 65536, diaChi: "1.2.3", chuKyMs: 9 },
      { loai: "camera" },
    ],
  };
  assert.deepEqual(loiCua(x), [
    { duong: "phienBan", thongDiep: "phải bằng 1" },
    { duong: "tenNhaMay", thongDiep: "phải là chuỗi khác rỗng" },
    { duong: "ghiNhat", thongDiep: "phải là boolean" },
    { duong: "may[0].ten", thongDiep: "phải là chuỗi khác rỗng" },
    { duong: "may[0].cong", thongDiep: "phải là số nguyên 1..65535" },
    { duong: "may[0].doPhanGiai", thongDiep: "phải là số dương" },
    { duong: "may[1]", thongDiep: "phải là đối tượng" },
    { duong: "may[2].loai", thongDiep: "thiếu" },
    { duong: "may[3].loai", thongDiep: "loại không hợp lệ" },
    { duong: "may[4].cong", thongDiep: "phải là số nguyên 1..65535" },
    { duong: "may[4].diaChi", thongDiep: "phải là IPv4" },
    { duong: "may[4].chuKyMs", thongDiep: "phải là số nguyên 10..60000" },
    { duong: "may[5].ten", thongDiep: "thiếu" },
    { duong: "may[5].url", thongDiep: "thiếu" },
  ]);
});

test("thiếu trường bắt buộc ở gốc và may không phải mảng", () => {
  assert.deepEqual(loiCua({ may: {} }), [
    { duong: "phienBan", thongDiep: "thiếu" },
    { duong: "tenNhaMay", thongDiep: "thiếu" },
    { duong: "may", thongDiep: "phải là mảng" },
  ]);
  assert.deepEqual(loiCua({ phienBan: "1", tenNhaMay: 3, may: null }), [
    { duong: "phienBan", thongDiep: "phải bằng 1" },
    { duong: "tenNhaMay", thongDiep: "phải là chuỗi khác rỗng" },
    { duong: "may", thongDiep: "phải là mảng" },
  ]);
});

test("biên cổng: 1 và 65535 hợp lệ; 0, 65536, số thực, chuỗi, NaN, null thì không", () => {
  assert.equal(kiemCauHinh(goc([{ loai: "aoi", ten: "a", cong: 65535 }])).ok, true);
  assert.equal(kiemCauHinh(goc([{ loai: "plc", ten: "p", cong: 1, diaChi: "1.1.1.1" }])).ok, true);
  for (const cong of [0, 65536, 80.5, "80", Number.NaN, null]) {
    assert.deepEqual(loiCua(goc([{ loai: "aoi", ten: "a", cong }])), [
      { duong: "may[0].cong", thongDiep: "phải là số nguyên 1..65535" },
    ], String(cong));
  }
});

test("IPv4 và chu kỳ PLC", () => {
  for (const diaChi of ["192.168.0.10", "255.255.255.255", "0.0.0.0", "10.0.0.1"]) {
    assert.equal(kiemCauHinh(goc([{ loai: "plc", ten: "p", diaChi, chuKyMs: 60000 }])).ok, true, diaChi);
  }
  for (const diaChi of ["256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", " 1.2.3.4", "a.b.c.d", 12, "1.2.3.4 "]) {
    assert.deepEqual(loiCua(goc([{ loai: "plc", ten: "p", diaChi, chuKyMs: 10 }])), [
      { duong: "may[0].diaChi", thongDiep: "phải là IPv4" },
    ], String(diaChi));
  }
  for (const chuKyMs of [60001, 10.5, "100"]) {
    assert.deepEqual(loiCua(goc([{ loai: "plc", ten: "p", diaChi: "1.2.3.4", chuKyMs }])), [
      { duong: "may[0].chuKyMs", thongDiep: "phải là số nguyên 10..60000" },
    ], String(chuKyMs));
  }
});

test("URL camera và độ phân giải AOI", () => {
  for (const url of ["rtsp://10.0.0.5:554/luong1", "http://cam/", "https://a.b/c?d=1"]) {
    assert.equal(kiemCauHinh(goc([{ loai: "camera", ten: "c", url }])).ok, true, url);
  }
  for (const url of ["ftp://x/y", "khong phai url", 42, "file:///C:/a.mp4"]) {
    assert.deepEqual(loiCua(goc([{ loai: "camera", ten: "c", url }])), [
      { duong: "may[0].url", thongDiep: "phải là URL rtsp/http/https" },
    ], String(url));
  }
  assert.equal(kiemCauHinh(goc([{ loai: "aoi", ten: "a", cong: 9, doPhanGiai: 0.5 }])).ok, true);
  for (const doPhanGiai of [0, Infinity, "5"]) {
    assert.deepEqual(loiCua(goc([{ loai: "aoi", ten: "a", cong: 9, doPhanGiai }])), [
      { duong: "may[0].doPhanGiai", thongDiep: "phải là số dương" },
    ], String(doPhanGiai));
  }
});

test("trùng tên máy (sau trim) chỉ về máy ĐẦU TIÊN mang tên đó", () => {
  const x = goc([
    { loai: "camera", ten: "A", url: "http://a/" },
    { loai: "camera", ten: " A ", url: "http://b/" },
    { loai: "robot", ten: "B" },
    { loai: "aoi", ten: "B", cong: 1 },
    { loai: "plc", ten: "A", diaChi: "1.2.3.4" },
    { loai: "aoi", ten: "B", cong: 1 },
  ]);
  assert.deepEqual(loiCua(x), [
    { duong: "may[1].ten", thongDiep: "trùng tên với may[0]" },
    { duong: "may[2].loai", thongDiep: "loại không hợp lệ" },
    { duong: "may[4].ten", thongDiep: "trùng tên với may[0]" },
    { duong: "may[5].ten", thongDiep: "trùng tên với may[3]" },
  ]);
});

test("moTaMay thu hẹp theo loai; laMayPlc lọc mảng", () => {
  const ds: May[] = [
    { loai: "aoi", ten: "A1", cong: 8080, doPhanGiai: 10 },
    { loai: "plc", ten: "P1", cong: 502, diaChi: "10.0.0.2", chuKyMs: 50 },
    { loai: "camera", ten: "C1", url: "rtsp://h/x" },
  ];
  assert.deepEqual(ds.map(moTaMay), ["aoi:A1:8080", "plc:P1@10.0.0.2:502/50ms", "camera:C1@rtsp://h/x"]);
  assert.deepEqual(ds.filter(laMayPlc).map((m) => m.diaChi), ["10.0.0.2"]);
});
