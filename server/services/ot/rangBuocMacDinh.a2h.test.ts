/**
 * SCADA R1b-2b-2a A2(h) H6 — MỘT vị từ "STOP ghim" cho miễn trừ ràng buộc HITL (tự duyệt của engine), dùng chung bởi cổng (1) và chỗ tính
 * `opts.pinnedStop` của giữ chỗ (bước 5a-stop). Quét NGUỒN (không DB): hai chỗ gọi đúng một hàm xuất `phanLoaiStopGhimRangBuoc`; cổng (1) không định
 * nghĩa "STOP" lần thứ hai (không `laStopChoKhoa` / `phanLoaiStopKhoa` / `matchPinnedStop` / `classifyOtStop` / `isStopCommandType` trực tiếp);
 * `optsGiuCho.pinnedStop` lấy từ đúng kết quả đó. Thêm: hàm chung trả đúng như `classifyOtStop` (một định nghĩa, không phải bản sao).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyOtStop, phanLoaiStopGhimRangBuoc } from "./commandDispatcher";
import { FOE_ENGINE_TOOL, foeSelfApprovalRefusal } from "./otActionBinding";

const NGUON = readFileSync(fileURLToPath(new URL("./commandDispatcher.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** đoạn nguồn từ dấu `tu` (lần đầu) tới dấu `den` (lần đầu sau nó) — dấu thiếu ⇒ ném (bài quét không bao giờ xanh vì tìm hụt). */
function doan(tu: string, den: string): string {
  const a = NGUON.indexOf(tu);
  if (a < 0) throw new Error(`không thấy dấu: ${tu}`);
  const b = NGUON.indexOf(den, a + tu.length);
  if (b < 0) throw new Error(`không thấy dấu: ${den}`);
  return NGUON.slice(a, b);
}
/** bỏ chú thích (dòng `//` và khối) — chỉ đếm MÃ. */
const ma = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const CONG1 = ma(doan("// ── (1) Authorization gate", "// ── (1b)"));
const HAM_CONG1 = ma(doan("async function laStopGhimTaiCong1(", "\n}\n"));
const BUOC_5A_STOP = ma(doan("let stopCls: OtStopClassification", "const stopOverrides"));
const LOI_CHUNG = /\b(laStopChoKhoa|phanLoaiStopKhoa|matchPinnedStop|classifyOtStop|isStopCommandType|stopPinsFromTagRows)\s*\(/;

describe("A2(h) H6 — một vị từ STOP ghim cho cổng (1) và giữ chỗ", () => {
  it("cổng (1) hỏi DUY NHẤT qua laStopGhimTaiCong1, không định nghĩa STOP lần hai; kết quả đi vào verifyActionBinding ({ pinnedStop })", () => {
    expect(dem(CONG1, /\blaStopGhimTaiCong1\(/g)).toBe(1);
    expect(CONG1).toMatch(/const ghim = pending\?\.tool === FOE_ENGINE_TOOL \? await stopGhim\(\) : false;/);
    expect(CONG1).not.toMatch(LOI_CHUNG);
    expect(CONG1).not.toMatch(/\bphanLoaiStopGhimRangBuoc\(/); // qua hàm phụ, không gọi thẳng với ghim khác
    expect(dem(CONG1, /verifyActionBinding\([^)]*\{ pinnedStop: ghim, daTieuChoBuoc2: daTieu \}/g)).toBe(2);
    expect(CONG1).toMatch(/const daTieu = t\.requireBoundAction !== true;/); // dạng thô + dạng ép kiểu
  });

  it("hàm phụ của cổng (1): loadStopPins + phanLoaiStopGhimRangBuoc, không vị từ STOP nào khác", () => {
    expect(dem(HAM_CONG1, /\bphanLoaiStopGhimRangBuoc\(/g)).toBe(2);
    expect(HAM_CONG1).toMatch(/\bloadStopPins\(db, input\.adapterId\)/);
    expect(HAM_CONG1).not.toMatch(LOI_CHUNG);
    expect(HAM_CONG1).toMatch(/pins = null/); // đọc ghim lỗi ⇒ không ghim
  });

  it("bước 5a-stop: stopCls từ CÙNG hàm (ghim từ hàng bước 3), và optsGiuCho.pinnedStop = stopCls.pinnedStop", () => {
    expect(dem(BUOC_5A_STOP, /stopCls = phanLoaiStopGhimRangBuoc\(input\.commandType, input\.writes, stopPinsFromTagRows\(step3TagRows\)\)/g)).toBe(1);
    expect(BUOC_5A_STOP).not.toMatch(/\bclassifyOtStop\(/);
    expect(ma(NGUON)).toMatch(/const optsGiuCho = \{[^}]*pinnedStop: stopCls\.pinnedStop \}/);
    // toàn tệp: hàm chung được gọi đúng 3 lần (2 trong hàm phụ cổng (1), 1 ở 5a-stop)
    expect(dem(ma(NGUON), /\bphanLoaiStopGhimRangBuoc\(/g)).toBe(4); // + chính dòng khai báo
  });

  it("giữ chỗ dùng pinnedStop làm miễn trừ, không tự tính lại", () => {
    const giuCho = ma(doan("async function reserveRealWrite(", "\n}\n"));
    expect(giuCho).toMatch(/verifyActionBinding\(pending, opts\.bindingInput \?\? input, t, \{ pinnedStop: opts\.pinnedStop === true, altWrites: opts\.rawBindingWrites \}\)/);
    expect(giuCho).not.toMatch(/daTieuChoBuoc2/); // AMENDMENT 2 — rào cuối: giữ chỗ chỉ nhận 'confirmed'
    expect(giuCho).not.toMatch(LOI_CHUNG);
  });

  it("cờ pinnedStop CHỈ nhấc foeSelfApprovalRefusal (vì vậy cổng (1) chỉ đọc ghim cho hàng của engine), và foeSelfApprovalRefusal = null cho mọi tool khác", () => {
    const xac = ma(doan("function verifyActionBinding(", "\n}\n"));
    expect(dem(xac, /opts\.pinnedStop/g)).toBe(1);
    expect(xac).toMatch(/if \(opts\.pinnedStop !== true\) \{\s*const self = foeSelfApprovalRefusal\(pending, t\.requestedBy\);/);
    expect(foeSelfApprovalRefusal({ tool: "set_machine_param", userId: 1, previewJson: null }, 1)).toBeNull();
    expect(foeSelfApprovalRefusal({ tool: FOE_ENGINE_TOOL, userId: 1, previewJson: null }, 1)).not.toBeNull();
  });

  it("hàm chung trả đúng như classifyOtStop (một định nghĩa)", () => {
    const pins = [{ tagKey: "a", value: 0 }, { tagKey: "b", value: true }];
    const ca: Array<[string, Array<{ tagKey: string; value: unknown }>, typeof pins | null]> = [
      ["stop", [{ tagKey: "a", value: 0 }], pins],
      ["e_stop", [{ tagKey: "b", value: 1 }], pins],
      ["stop", [{ tagKey: "a", value: 1 }], pins],
      ["stop", [{ tagKey: "z", value: 0 }], pins],
      ["stop", [{ tagKey: "a", value: 0 }], null],
      ["set_param", [{ tagKey: "a", value: 0 }], pins],
      ["stop", [], pins],
    ];
    for (const [loai, w, p] of ca) expect(phanLoaiStopGhimRangBuoc(loai, w, p)).toEqual(classifyOtStop(loai, w, p));
  });
});
