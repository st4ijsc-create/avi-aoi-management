/**
 * Đợt 10.2 — `thamSo.chonModel` của node AI ở phía LƯU và XUẤT/NHẬP luồng:
 *   • kiểm tĩnh LÚC LƯU: chuỗi CỐ ĐỊNH khớp hợp đồng, không biểu thức; lỗi chỉ nêu node sai (luồng CŨ có biểu thức mở lên vẫn cho sửa các node khác);
 *   • xuất: `ngoai:*` KHÔNG đi theo gói (về auto + việc phải chọn lại); `ho-so:*` / `vai-tro:*` / `auto` giữ; node không phải ai.* không bị đụng;
 *   • nhập: gói tay chế mang `ngoai:*` vẫn bị làm sạch lại ở máy chủ; hồ sơ không có ở máy này ⇒ cảnh báo.
 */
import { describe, expect, it } from "vitest";
import { canhBaoHoSoChonModel, lamSachLuong, phanTichGoi, taoGoi } from "./xuatNhap";
import { kiemThamSoNutMoi } from "./kiemThamSoNut";
import "./nut/index";

type P = Record<string, unknown>;
const node = (id: string, type: string, parameters: P) => ({ id, type, typeVersion: 1, name: `n-${id}`, position: [0, 0] as [number, number], parameters });
const dinh = (...nodes: ReturnType<typeof node>[]) => ({ nodes });
const luong = (...nodes: ReturnType<typeof node>[]): any => ({
  id: "luong-cm", name: "v", version: 1,
  nodes: [node("t", "kich-hoat.thu-cong", {}), ...nodes],
  connections: nodes.map((n) => ({ from: { node: "t", port: "main" }, to: { node: n.id, port: "main" } })),
  settings: { uuTien: "background", luuDuLieu: "day-du" },
});

describe("kiểm tĩnh lúc LƯU", () => {
  it("★ giá trị hợp lệ qua: auto · vai-tro · ho-so · ngoai:ncc:model (model có ':'); vắng / null ⇒ qua", () => {
    for (const cm of ["auto", "vai-tro:chat", "vai-tro:code.software", "ho-so:qwen3.6-35b@ctx64k", "ngoai:openai_compat:gpt-4o", "ngoai:anthropic:claude-x:1"]) {
      expect(kiemThamSoNutMoi(dinh(node("a", "ai.llm", { chonModel: cm }))), cm).toEqual([]);
    }
    expect(kiemThamSoNutMoi(dinh(node("a", "ai.llm", {})))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh(node("a", "ai.llm", { chonModel: null })))).toEqual([]);
  });

  it("★ biểu thức / sai dạng / không phải chuỗi / tên tệp GGUF trần ⇒ lỗi NÊU ĐÚNG node, ở MỌI node ai.*", () => {
    for (const type of ["ai.llm", "ai.trich-xuat", "ai.phan-loai", "ai.tom-tat", "ai.agent", "ai.sinh-ma"]) {
      for (const cm of ["{{ $json.model }}", "vai-tro:", "ho-so:", "tep-model.gguf", "ngoai:x", 5, ["auto"], { a: 1 }, "AUTO"]) {
        const l = kiemThamSoNutMoi(dinh(node("sai", type, { chonModel: cm })));
        expect(l, `${type} ${JSON.stringify(cm)}`).toHaveLength(1);
        expect(l[0]).toContain("node 'sai'");
      }
    }
  });

  it("★ luồng CŨ có chonModel biểu thức ở MỘT node: đúng MỘT lỗi nêu node đó; node khác (kể cả lỗi khác) kiểm độc lập; node không phải ai.* bỏ qua chonModel", () => {
    const l = kiemThamSoNutMoi(dinh(node("tot", "ai.llm", { chonModel: "vai-tro:chat" }), node("cu", "ai.phan-loai", { chonModel: "{{ $json.m }}" }), node("khac", "logic.cho", { giay: 999999 }), node("khong-ai", "du-lieu.dat", { chonModel: "{{ x }}" })));
    expect(l).toHaveLength(2);
    expect(l.some((x) => x.includes("node 'cu'") && x.includes("chonModel"))).toBe(true);
    expect(l.some((x) => x.includes("node 'khac'"))).toBe(true);
    expect(l.some((x) => x.includes("node 'tot'") || x.includes("node 'khong-ai'"))).toBe(false);
  });
});

describe("xuất / nhập", () => {
  const goc = () => luong(node("n", "ai.llm", { chonModel: "ngoai:openai_compat:gpt-4o", vaiTro: "chat" }), node("h", "ai.tom-tat", { chonModel: "ho-so:p1" }), node("v", "ai.phan-loai", { chonModel: "vai-tro:classify" }), node("d", "du-lieu.dat", { chonModel: "ngoai:x:y", truong: {} }));

  it("★ lamSachLuong: ngoai:* ⇒ khoá bị xoá + việc chon-model; ho-so/vai-tro giữ; node không phải ai.* không bị đụng", () => {
    const { luong: ra, viec } = lamSachLuong(goc());
    const p = (id: string) => ra.nodes.find((n) => n.id === id)!.parameters as P;
    expect(p("n")).not.toHaveProperty("chonModel");
    expect(p("n").vaiTro).toBe("chat");
    expect(p("h").chonModel).toBe("ho-so:p1");
    expect(p("v").chonModel).toBe("vai-tro:classify");
    expect(p("d").chonModel).toBe("ngoai:x:y");
    expect(viec.filter((x) => x.viec === "chon-model")).toEqual([{ nodeId: "n", truong: "chonModel", viec: "chon-model" }]);
  });

  it("★ gói tay chế mang ngoai:* vẫn bị làm sạch LẠI khi nhập (không tin gói); gói do taoGoi không còn ngoai:*", () => {
    const { goi } = taoGoi(goc());
    expect(JSON.stringify(goi)).not.toContain("ngoai:openai_compat");
    const tay = JSON.parse(JSON.stringify(goi));
    tay.luong.nodes.find((n: { id: string }) => n.id === "n").parameters.chonModel = "ngoai:openai_compat:gpt-4o";
    const p = phanTichGoi(tay);
    if (!p.ok) throw new Error(p.thongDiep);
    expect(JSON.stringify(p.luong)).not.toContain("ngoai:openai_compat");
    expect(p.viec.some((x) => x.viec === "chon-model" && x.nodeId === "n")).toBe(true);
  });

  it("canhBaoHoSoChonModel: hồ sơ không có ở máy này ⇒ cảnh báo nêu node; có ⇒ im; chỉ xét node ai.*", () => {
    expect(canhBaoHoSoChonModel(goc(), () => false)).toEqual([expect.stringContaining("node 'h'")]);
    expect(canhBaoHoSoChonModel(goc(), (id) => id === "p1")).toEqual([]);
  });
});
