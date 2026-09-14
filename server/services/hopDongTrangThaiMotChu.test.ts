/**
 * hopDongTrangThaiMotChu.test.ts — ★★★ ĐỢT 53 (QA lần 8, SAI #2): MỌI BỀ MẶT PHẢI ĐƯA ĐỦ DỮ KIỆN
 * VÀO `mapMachineStatus` — BẤT BIẾN QUÉT, KHÔNG PHẢI DANH SÁCH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT LƯỚI QUÉT CHỨ KHÔNG PHẢI THÊM VÀI CA `expect`
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 34 đưa bốn nguồn về MỘT hàm `mapMachineStatus` và ghim bằng lưới hành vi. Lưới ấy xanh suốt
 * 19 đợt, mà QA lần 8 vẫn đo được `factoryCommand.overview = "idle"` ≠ `factoryCommand.machineDetail
 * = "running"` cho CÙNG máy, CÙNG giây. Lý do: hàm ĐÚNG, **người gọi đánh rơi đối số**
 * (`assetCockpitService` trả `operationStatus: null` cứng ⇒ `factoryCommandService:576` `?? undefined`).
 * Một lưới hành vi trên HÀM không bao giờ thấy được điều đó.
 *
 * G110 nói thẳng: vá một lớp lỗi ở hai chỗ mà không quét chỗ thứ ba. Nên lưới này **liệt kê mọi chỗ
 * gọi bằng cách quét mã**, rồi bắt từng chỗ phải khai dữ kiện. Thêm một đường thứ tư ngày mai mà quên
 * `operationStatus` ⇒ lưới ĐỎ ngay, không cần ai nhớ tới tệp này.
 *
 * ★ Tầng hành vi của cùng bản vá nằm ở `trangThaiMayTuoi.test.ts`; tầng SỐNG (6 bề mặt trên dist,
 *   có chèn nhịp tim `now()`) ở `.qa-dot53/hopdong53.mjs` + `.qa-dot53/hd-<tag>/tong.json`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../..");

/** Mọi tệp `.ts` SẢN PHẨM dưới `server/` (bỏ test) — nguồn của phép liệt kê. */
function quetTs(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    const p = resolve(thuMuc, ten);
    if (statSync(p).isDirectory()) {
      if (ten === "node_modules") continue;
      quetTs(p, ra);
    } else if (ten.endsWith(".ts") && !ten.includes(".test.")) {
      ra.push(p);
    }
  }
  return ra;
}

/** Cắt danh sách đối số của một lời gọi bắt đầu tại `(` — cân ngoặc, bỏ qua chuỗi. */
function doiSo(src: string, moNgoac: number): string[] {
  let sau = 0;
  let i = moNgoac;
  let batDau = moNgoac + 1;
  const ra: string[] = [];
  let trongChuoi: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === trongChuoi) trongChuoi = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") trongChuoi = c;
    else if (c === "(" || c === "[" || c === "{") sau++;
    else if (c === ")" || c === "]" || c === "}") {
      sau--;
      if (sau === 0) {
        ra.push(src.slice(batDau, i));
        return ra.map((s) => s.trim());
      }
    } else if (c === "," && sau === 1) {
      ra.push(src.slice(batDau, i));
      batDau = i + 1;
    }
  }
  return ra.map((s) => s.trim());
}

const TEP = quetTs(resolve(GOC, "server"));

/** Mọi chỗ GỌI `mapMachineStatus(` trong mã sản phẩm (bỏ dòng khai báo hàm và chú thích). */
const CHO_GOI: { tep: string; dong: number; doiSo2: string; nguon: string }[] = [];
for (const p of TEP) {
  const src = readFileSync(p, "utf8");
  let tu = 0;
  for (;;) {
    const i = src.indexOf("mapMachineStatus(", tu);
    if (i < 0) break;
    tu = i + 1;
    // bỏ chính định nghĩa hàm
    if (/export function\s*$/.test(src.slice(Math.max(0, i - 24), i))) continue;
    // bỏ chỗ nằm trong chú thích của cùng dòng
    const dauDong = src.lastIndexOf("\n", i) + 1;
    const truoc = src.slice(dauDong, i);
    if (/^\s*(\*|\/\/)/.test(truoc)) continue;
    const args = doiSo(src, i + "mapMachineStatus".length);
    if (args.length < 2) continue;
    CHO_GOI.push({
      tep: p.slice(GOC.length + 1).replace(/\\/g, "/"),
      dong: src.slice(0, i).split("\n").length,
      doiSo2: args[1].replace(/\s+/g, " "),
      nguon: src,
    });
  }
}

describe("★★★ Đợt 53 — MỘT hợp đồng trạng thái: không chỗ gọi nào được đánh rơi `operationStatus`", () => {
  it("phép liệt kê CÓ BẮT ĐƯỢC gì (đối chứng dương của chính thiết bị đo)", () => {
    // Nếu con số này về 0 vì đổi tên hàm / đổi cây thư mục, lưới sẽ "xanh" một cách vô nghĩa.
    expect(CHO_GOI.length).toBeGreaterThanOrEqual(4);
    const tep = new Set(CHO_GOI.map((c) => c.tep));
    expect(tep).toContain("server/services/factoryCommandService.ts");
    expect(tep).toContain("server/services/ecosystem/assetCockpitService.ts");
    expect(tep).toContain("server/db/twinCanh.ts");
  });

  it("★★★ KHÔNG chỗ gọi nào truyền HẰNG `null`/`undefined` làm `operationStatus`", () => {
    const xau = CHO_GOI.filter((c) => c.doiSo2 === "null" || c.doiSo2 === "undefined");
    expect(
      xau.map((c) => `${c.tep}:${c.dong} → mapMachineStatus(…, ${c.doiSo2}, …)`),
      "đúng hình dạng đã làm assetCockpitService trả 'running' cho MỌI máy đang kết nối",
    ).toEqual([]);
  });

  it("★ chỗ nào KHÔNG có dữ kiện thật thì phải KHAI bằng `VAN_HANH_XAP_XI_KET_NOI`", () => {
    // Đối số hợp lệ: một biểu thức đọc `operationStatus`, hoặc hằng khai xấp xỉ tường minh.
    for (const c of CHO_GOI) {
      // Ba dạng hợp lệ: 1. biểu thức đọc thẳng cột · 2. hằng khai xấp xỉ tường minh ·
      // 3. một BIẾN mà chính tệp ấy gán từ `operationStatus` (ca `opStatus` của `assetCockpitService`:
      //    truy vấn ở trên, dùng ở dưới — vẫn là dữ kiện thật, chỉ đi qua một tên).
      const laTen = /^[A-Za-z_$][\w$]*$/.test(c.doiSo2);
      const truyVetBien = laTen && new RegExp(`\\b${c.doiSo2}\\b\\s*=[^;]*operationStatus`).test(c.nguon);
      const ok = /operationStatus/i.test(c.doiSo2) || c.doiSo2.includes("VAN_HANH_XAP_XI_KET_NOI") || truyVetBien;
      expect(ok, `${c.tep}:${c.dong} truyền "${c.doiSo2}" — không đọc operationStatus, cũng không khai xấp xỉ`).toBe(true);
    }
  });

  it("★★★ `assetCockpitService` ĐỌC `operationStatus` trong ĐÚNG truy vấn đã có (0 truy vấn thêm)", () => {
    const src = readFileSync(resolve(GOC, "server/services/ecosystem/assetCockpitService.ts"), "utf8");
    expect(src).toMatch(
      /\.select\(\{\s*lastHeartbeat: machinesTable\.lastHeartbeat,\s*operationStatus: machinesTable\.operationStatus\s*\}\)/,
    );
    expect(src).toMatch(/operationStatus: opStatus,/);
    expect(src).not.toMatch(/operationStatus: null,/);
    // Vẫn CHỈ một truy vấn `machinesTable` ở nhánh liveState — thêm cột, không thêm round-trip.
    const nhanh = src.slice(src.indexOf("let hbMay"), src.indexOf("const connected = dangKetNoi"));
    expect(nhanh.match(/\.from\(machinesTable\)/g) ?? []).toHaveLength(1);
  });

  it("★ `factoryCommand.machineDetail` lấy `operationStatus` từ hợp đồng liveState (nơi dữ kiện từng rơi)", () => {
    const src = readFileSync(resolve(GOC, "server/services/factoryCommandService.ts"), "utf8");
    expect(src).toMatch(/detail\.liveState\.value\?\.operationStatus/);
  });
});
