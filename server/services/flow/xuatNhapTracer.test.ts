/**
 * TRACER XUẤT LUỒNG (kiểm định 2026-10-25) — tự gieo dấu vết riêng vào MỘT luồng đủ loại node rồi đòi gói xuất KHÔNG chứa chúng.
 * Đặt vào server/services/flow/xuatNhapTracer.test.ts. Hiện (347cf3790) ĐỎ ở các ca F1/F3 — đó là mục đích; xanh khi luong-ui vá F1/F3 (F2 = cảnh báo).
 */
import { describe, expect, it } from "vitest";
import { phanTichGoi, quetVanBan, taoGoi } from "./xuatNhap";
import "./nut/index";

type P = Record<string, unknown>;
const node = (id: string, type: string, parameters: P, extra: P = {}) => ({ id, type, typeVersion: 1, name: `n-${id}`, position: [0, 0] as [number, number], parameters, ...extra });
const def = (): any => ({
  id: "luong-nguon-ABC",
  name: "Luong PLANTA-TRACER",
  version: 3,
  nodes: [
    node("a", "kich-hoat.thu-cong", {}),
    node("b", "du-lieu.dat", { truong: { machineId: 4242, ghiChu: "MAY-TRACER-01 hong", sau: { hon: { nua: [{ id: 4242 }] } } } }),
    node("c", "logic.neu", { dieuKien: "{{ $json.machineId == 4242 }}" }),
    node("d", "tich-hop.http-gui", { url: "https://hook.example.com/x?token=SECRET-URL-7f3a#SECRET-FRAG-1", tieuDe: { "X-Api-Key": "SECRET-HDR-9", Accept: "application/json" }, than: { password: "SECRET-BODY-5", ghiChu: "ok" }, kieuXacThuc: "bearer" }, { credentialRef: "bi-mat-1" }),
    node("e", "tich-hop.thong-bao", { nguoiNhan: [7, "8", "{{ $json.u }}"], tieuDe: "x", noiDung: "y", duongDan: "/alerts" }),
    node("f", "ot.de-xuat-luong", { workflowId: 99, version: 4 }),
    node("g", "luong.goi-con", { flowId: "luong-con-tracer", version: 2 }),
    node("h", "ai.agent", { luongCon: [{ flowId: "luong-con-tracer", ten: "t", moTa: "m" }], traTaiLieu: true, heThong: "Ban la tro ly nha may PLANTA-TRACER" }),
    node("i", "bao-tri.tao-phieu", { may: 4242, tieuDe: "Phieu" }),
    node("j", "ot.doc-tag", { may: "4242", tag: "T1" }),
    node("k", "kich-hoat.su-kien", { suKien: "ng.alert", bat: true }),
    node("l", "nguoi.duyet", { vaiTroDuyet: "supervisor", tieuDe: "Duyet", noiDung: "MAY-TRACER-01" }),
  ],
  connections: [],
  settings: { errorFlowId: "luong-loi-tracer", uuTien: "background", luuDuLieu: "day-du", affinity: ["plantA-gpu-01"], timeoutS: 60 },
  pinData: { a: [{ json: { bi: "SECRET-PIN-1" } }] },
});
const goiChu = () => JSON.stringify(taoGoi(def()).goi);

describe("TRACER xuất luồng", () => {
  it("(đã đạt) pinData · id luồng · errorFlowId · credentialRef · luồng con · FOE · người nhận · bảo trì · OT không lọt", () => {
    const s = goiChu();
    for (const d of ["SECRET-PIN-1", "luong-nguon-ABC", "luong-loi-tracer", "bi-mat-1", "luong-con-tracer", '"workflowId":99', '"nguoiNhan":[7', '"may":4242', '"may":"4242"']) expect(s, d).not.toContain(d);
  });
  it("F1 — bí mật nhúng thẳng vào url / tieuDe / than của node HTTP KHÔNG lọt vào gói", () => {
    const s = goiChu();
    for (const d of ["SECRET-URL-7f3a", "SECRET-FRAG-1", "SECRET-HDR-9", "SECRET-BODY-5"]) expect(s, d).not.toContain(d);
  });
  it("F1 — tiêu đề vô hại (Accept) và khoá không-bí-mật của thân được GIỮ (không phá luồng)", () => {
    const s = goiChu();
    expect(s).toContain("application/json");
    expect(s).toContain("hook.example.com");
  });
  it("F3 — settings.affinity (nhãn hạ tầng của nhà máy nguồn) KHÔNG lọt", () => {
    expect(goiChu()).not.toContain("plantA-gpu-01");
  });
  it("F2 — id số của máy nguồn (4242) trong du-lieu.dat / biểu thức ⇒ có CẢNH BÁO (vị trí node + trường) khi dấu vết có id số", () => {
    const cb = quetVanBan(def(), { maMay: ["MAY-TRACER-01"], nhaMay: ["PLANTA-TRACER"], nguoi: [], idMay: [4242] } as never);
    expect(cb.some((c) => c.nodeId === "b" && /4242/.test(c.khop))).toBe(true);
    expect(cb.some((c) => c.nodeId === "c")).toBe(true);
  });
  it("quét văn bản vẫn bắt tên/mã (đã đạt)", () => {
    const cb = quetVanBan(def(), { maMay: ["MAY-TRACER-01"], nhaMay: ["PLANTA-TRACER"], nguoi: [] });
    expect(cb.map((c) => `${c.nodeId}:${c.khop}`).sort()).toEqual(["(luồng):PLANTA-TRACER", "b:MAY-TRACER-01", "h:PLANTA-TRACER", "l:MAY-TRACER-01"].sort());
  });
  it("NHẬP gói độc: __proto__ / constructor.prototype không ô nhiễm Object.prototype", () => {
    const doc = JSON.parse('{"dinhDang":"luong-ai/1","bam":"","luong":{"id":"x","name":"x","version":1,"nodes":[{"id":"a","type":"kich-hoat.thu-cong","typeVersion":1,"name":"a","position":[0,0],"parameters":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":"y"}}}}],"connections":[],"settings":{"__proto__":{"p3":"z"}}}}');
    phanTichGoi(doc);
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).p2).toBeUndefined();
    expect(({} as any).p3).toBeUndefined();
  });
});
