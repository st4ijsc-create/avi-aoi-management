// server/services/ingestCayKetQua.test.ts
//
// Pha 1B Task 4 — lưới cho bộ dịch THUẦN `dichCayKetQua`. Bảy mệnh đề bắt buộc
// theo task-4-brief.md, mỗi mệnh đề một `it` riêng.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";
import { dichCayKetQua, type CayDaDich } from "./ingestCayKetQua";

// Mẫu máy THẬT — nguồn duy nhất cho các ca "đúng số node" / "declaredMismatch=false".
const DUONG_MAU_THAT = "D:\\SOURCES\\AOIData\\dashboard-sample.json";

function tatCaPosition(cay: CayDaDich) {
  return cay.surfaces.flatMap((s) => s.positions);
}
function tatCaCapture(cay: CayDaDich) {
  return cay.surfaces.flatMap((s) => s.positions.flatMap((p) => p.captures));
}

describe("dichCayKetQua — bộ dịch payload v2.0 thành cây 4 cấp", () => {
  // ── Mệnh đề 1 ────────────────────────────────────────────────────────────
  it("dịch mẫu THẬT ra đúng số node từng cấp, khớp summary máy tự khai", () => {
    const raw = JSON.parse(readFileSync(DUONG_MAU_THAT, "utf-8"));
    const payload = machineDataContractV2.parse(raw);
    const cay = dichCayKetQua(payload);

    const soPosition = tatCaPosition(cay).length;
    const soCapture = tatCaCapture(cay).length;
    const soComponent = tatCaCapture(cay).reduce((tong, c) => tong + c.components.length, 0);

    // Khớp summary máy TỰ KHAI trong chính payload.
    expect(cay.surfaces.length).toBe(payload.summary.surfaces.total);
    expect(soPosition).toBe(payload.summary.positions.total);
    expect(soCapture).toBe(payload.summary.captures.total);
    expect(soComponent).toBe(payload.summary.components.total);

    // Chống tự-thoả với chính summary máy khai: khớp con số đã ĐẾM TAY trên
    // file mẫu thật (6 surface × 2 position × 2 capture × 2 component).
    expect(cay.surfaces.length).toBe(6);
    expect(soPosition).toBe(12);
    expect(soCapture).toBe(24);
    expect(soComponent).toBe(48);
  });

  // ── Mệnh đề 2 ────────────────────────────────────────────────────────────
  it("cuộn đúng ở cả ba cấp: capture từ components, position từ captures, surface từ positions", () => {
    const p = mauHopLe();
    // Capture 1 (đủ 2 component, 1 NG) — cuộn ra NG.
    p.surfaces[0].positions[0].captures[0].result = "NG";
    p.surfaces[0].positions[0].captures[0].components = [
      { componentId: "c-ok", result: "OK", ntf: false },
      { componentId: "c-ng", result: "NG", ntf: false },
    ];
    // Capture 2 trong CÙNG position — toàn OK, cuộn ra OK.
    p.surfaces[0].positions[0].captures.push({
      captureId: "cap-2-toan-ok",
      result: "OK",
      ntf: false,
      components: [{ componentId: "c-ok-2", result: "OK", ntf: false }],
    });
    p.surfaces[0].positions[0].result = "NG"; // khớp cuộn thật (OR của 2 capture: NG, OK ⇒ NG)

    // Position 2 trong CÙNG surface — toàn OK, cuộn ra OK.
    p.surfaces[0].positions.push({
      positionId: "P02",
      result: "OK",
      ntf: false,
      captures: [{ captureId: "cap-p02", result: "OK", ntf: false, components: [] }],
    });
    p.surfaces[0].result = "NG"; // khớp cuộn thật (OR của 2 position: NG, OK ⇒ NG)
    p.overallResult = "NG";

    const cay = dichCayKetQua(machineDataContractV2.parse(p));
    const [surface] = cay.surfaces;
    const [position1, position2] = surface.positions;
    const [capture1, capture2] = position1.captures;

    // Cấp capture: cuộn TỪ components.
    expect(capture1.rolledResult).toBe("NG"); // components: OK + NG ⇒ NG
    expect(capture2.rolledResult).toBe("OK"); // component: OK ⇒ OK

    // Cấp position: cuộn TỪ captures (dùng rolledResult của capture, không phải result khai).
    expect(position1.rolledResult).toBe("NG"); // captures: NG (rolled) + OK (rolled) ⇒ NG
    expect(position2.rolledResult).toBe("OK");

    // Cấp surface: cuộn TỪ positions (dùng rolledResult của position).
    expect(surface.rolledResult).toBe("NG"); // positions: NG (rolled) + OK (rolled) ⇒ NG
  });

  // ── Mệnh đề 3 ────────────────────────────────────────────────────────────
  it("declaredMismatch = true khi máy khai một đằng, cuộn ra một nẻo (payload cố ý lệch)", () => {
    const p = mauHopLe();
    // Máy khai capture NÀY là "OK" nhưng component con của nó vẫn "NG" (không sửa).
    p.surfaces[0].positions[0].captures[0].result = "OK";
    // position/surface GIỮ NGUYÊN "NG" — rolledResult của capture (NG, tính từ
    // component NG) vẫn cuộn lên đúng nên hai cấp trên KHÔNG lệch, cô lập lệch
    // đúng vào MỘT cấp (capture) để ca test không lẫn hai hiện tượng.
    const cay = dichCayKetQua(machineDataContractV2.parse(p));
    const capture = cay.surfaces[0].positions[0].captures[0];

    expect(capture.result).toBe("OK"); // máy khai
    expect(capture.rolledResult).toBe("NG"); // cuộn ra từ component NG
    expect(capture.declaredMismatch).toBe(true);

    // Cấp trên KHÔNG lệch vì rolledResult của capture (NG) khớp result khai của
    // position/surface (NG, giữ nguyên từ mauHopLe) — chứng minh declaredMismatch
    // canh ĐÚNG cấp bị lệch, không lan tràn giả.
    expect(cay.surfaces[0].positions[0].declaredMismatch).toBe(false);
    expect(cay.surfaces[0].declaredMismatch).toBe(false);
  });

  // ── Mệnh đề 4 ────────────────────────────────────────────────────────────
  it("declaredMismatch = false trên mẫu THẬT (máy nhất quán) ở cả ba cấp", () => {
    const raw = JSON.parse(readFileSync(DUONG_MAU_THAT, "utf-8"));
    const payload = machineDataContractV2.parse(raw);
    const cay = dichCayKetQua(payload);

    expect(cay.surfaces.every((s) => s.declaredMismatch === false)).toBe(true);
    expect(tatCaPosition(cay).every((p) => p.declaredMismatch === false)).toBe(true);
    expect(tatCaCapture(cay).every((c) => c.declaredMismatch === false)).toBe(true);
  });

  // ── Mệnh đề 5 ────────────────────────────────────────────────────────────
  it("cấp surface PHÁI SINH: declaredMismatch=false trên mẫu thật là HỆ QUẢ CẤU TẠO (surface.result vốn đã là rollup phía máy), KHÔNG PHẢI bằng chứng cuộn đúng", () => {
    const raw = JSON.parse(readFileSync(DUONG_MAU_THAT, "utf-8"));
    const payload = machineDataContractV2.parse(raw);
    const cay = dichCayKetQua(payload);

    // Đúng như mệnh đề 4 đã canh — lặp lại RIÊNG ở đây với tên ca nói rõ lý do
    // cấu tạo, để không ai đọc ca này rồi kết luận nhầm "cuộn surface đã được
    // chứng minh đúng": generator phía máy TỰ tính surface.result bằng worst-case
    // rollup từ positions[] con (HookProductContext không có node Surface), nên
    // gần như CHẮC CHẮN nó sẽ khớp với cuộn của TA — mệnh đề 3 mới là ca chứng
    // minh cuộn hoạt động đúng khi có lệch thật.
    expect(cay.surfaces.every((s) => s.declaredMismatch === false)).toBe(true);
  });

  // ── Mệnh đề 6 ────────────────────────────────────────────────────────────
  it("verdictLuuTru áp cho verdict gốc: mọi result OK nhưng ntf true (bubbled từ lá) ⇒ verdict lưu trữ 'NTF' (lỗ 6,55%)", () => {
    const p = mauHopLe();
    // Toàn cây "OK" nhưng NTF được máy khai NHẤT QUÁN từ lá lên tới payload gốc —
    // không NG ở đâu cả, chỉ có cờ ntf=true xuyên suốt.
    p.overallResult = "OK";
    p.ntf = true;
    p.surfaces[0].result = "OK";
    p.surfaces[0].ntf = true;
    p.surfaces[0].positions[0].result = "OK";
    p.surfaces[0].positions[0].ntf = true;
    p.surfaces[0].positions[0].captures[0].result = "OK";
    p.surfaces[0].positions[0].captures[0].ntf = true;
    p.surfaces[0].positions[0].captures[0].components[0].result = "OK";
    p.surfaces[0].positions[0].captures[0].components[0].ntf = true;

    const cay = dichCayKetQua(machineDataContractV2.parse(p));

    expect(cay.rolledResult).toBe("OK"); // không NG nào trong cây
    expect(cay.rolledNtf).toBe(true); // cờ ntf cuộn (OR) từ lá lên
    expect(cay.verdictLuuTru).toBe("NTF"); // verdictLuuTru({result:"OK", ntf:true}) === "NTF"
  });

  // ── Mệnh đề 7 ────────────────────────────────────────────────────────────
  it("components: [] rỗng ⇒ capture vẫn hợp lệ (hợp đồng chấp nhận), cuộn ra OK", () => {
    const p = mauHopLe();
    p.surfaces[0].positions[0].captures[0].result = "OK";
    p.surfaces[0].positions[0].captures[0].ntf = false;
    p.surfaces[0].positions[0].captures[0].components = [];
    // Khớp lại cấp trên để mẫu vẫn nhất quán (không lẫn với mệnh đề declaredMismatch).
    p.surfaces[0].positions[0].result = "OK";
    p.surfaces[0].positions[0].ntf = false;
    p.surfaces[0].result = "OK";
    p.surfaces[0].ntf = false;
    p.overallResult = "OK";

    const cay = dichCayKetQua(machineDataContractV2.parse(p));
    const capture = cay.surfaces[0].positions[0].captures[0];

    expect(capture.components).toEqual([]);
    expect(capture.rolledResult).toBe("OK");
    expect(capture.rolledNtf).toBe(false);
    expect(capture.declaredMismatch).toBe(false);
  });
});
