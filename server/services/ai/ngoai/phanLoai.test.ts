import { describe, expect, it } from "vitest";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { capNhatMucLuot, ganMucDuLieu, mucChoBeMat, mucTinhCuaDinhNghia, taoMucDuLieuLuot, type DocDinhNghiaCon, type MucDuLieu } from "./phanLoai";

const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, parameters });
const def = (...nodes: ReturnType<typeof nut>[]) => ({ nodes, connections: [] }) as unknown as FlowDefinition;
const chuoi = (...loai: string[]): MucDuLieu => loai.reduce<MucDuLieu>((m, l) => capNhatMucLuot(m, l), "ky-thuat");

describe("phân loại mức dữ liệu theo lượt", () => {
  it("chuỗi node: kỹ thuật thuần ⇒ ky-thuat; có số liệu ⇒ van-hanh (kể cả sau code / set); node lạ ⇒ van-hanh", () => {
    expect(chuoi("kich-hoat.thu-cong", "du-lieu.dat", "ai.tom-tat")).toBe("ky-thuat");
    expect(chuoi("kich-hoat.thu-cong", "du-lieu.so-lieu", "du-lieu.ma", "ai.tom-tat")).toBe("van-hanh");
    expect(chuoi("kich-hoat.thu-cong", "x.y")).toBe("van-hanh");
    expect(chuoi("ot.doc-tag", "du-lieu.dat")).toBe("van-hanh");
  });

  it("bề mặt: kết quả tool vận hành đã ghép ⇒ van-hanh; không ghép gì ⇒ ky-thuat", () => {
    expect(mucChoBeMat("agent-turn", ["ky-thuat", "van-hanh"])).toBe("van-hanh");
    expect(mucChoBeMat("chat", [])).toBe("ky-thuat");
  });

  it("taoMucDuLieuLuot: chỉ node ĐÃ có bước trong lượt; id không có trong định nghĩa ⇒ van-hanh", async () => {
    const d = def(nut("a", "kich-hoat.thu-cong"), nut("b", "du-lieu.so-lieu"), nut("c", "ai.llm"));
    const docCon: DocDinhNghiaCon = async () => null;
    expect(await taoMucDuLieuLuot(d, ["a"], docCon)()).toBe("ky-thuat");
    expect(await taoMucDuLieuLuot(d, ["a", "b"], docCon)()).toBe("van-hanh");
    expect(await taoMucDuLieuLuot(d, ["a", "z"], docCon)()).toBe("van-hanh");
  });

  it("luồng con: cha [thu-cong, goi-con] với con có so-lieu ⇒ van-hanh; con thuần ⇒ ky-thuat; con không đọc được / không ghim / vòng ⇒ van-hanh", async () => {
    const con1 = def(nut("x", "kich-hoat.thu-cong"), nut("y", "du-lieu.so-lieu"));
    const con2 = def(nut("x", "kich-hoat.thu-cong"), nut("y", "ai.llm"));
    const vong = def(nut("x", "luong.goi-con", { flowId: "vong", version: 1 }));
    const docCon: DocDinhNghiaCon = async (f) => (f === "con1" ? con1 : f === "con2" ? con2 : f === "vong" ? vong : null);
    const cha = (p: Record<string, unknown>) => def(nut("a", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", p));
    expect(await taoMucDuLieuLuot(cha({ flowId: "con1", version: 3 }), ["a", "g"], docCon)()).toBe("van-hanh");
    expect(await taoMucDuLieuLuot(cha({ flowId: "con2", version: 3 }), ["a", "g"], docCon)()).toBe("ky-thuat");
    expect(await taoMucDuLieuLuot(cha({ flowId: "khong-co", version: 3 }), ["a", "g"], docCon)()).toBe("van-hanh");
    expect(await taoMucDuLieuLuot(cha({ flowId: "con2" }), ["a", "g"], docCon)()).toBe("van-hanh");
    expect(await taoMucDuLieuLuot(cha({ flowId: "vong", version: 1 }), ["a", "g"], docCon)()).toBe("van-hanh");
    // ai.agent: luồng con khai làm công cụ
    const agent = def(nut("a", "kich-hoat.thu-cong"), nut("t", "ai.agent", { luongCon: [{ flowId: "con2", version: 1 }, { flowId: "con1", version: 1 }] }));
    expect(await taoMucDuLieuLuot(agent, ["a", "t"], docCon)()).toBe("van-hanh");
    expect(await mucTinhCuaDinhNghia(def(nut("a", "kich-hoat.lich"), nut("b", "ai.agent", { luongCon: [{ flowId: "con2", version: 1 }] })), docCon)).toBe("ky-thuat");
  });

  it("★ không hạ được: node gán lại / định nghĩa lại `mucDuLieu` ⇒ ném, mức vẫn van-hanh; ô không liệt kê (không vào JSON / spread)", async () => {
    const ngu = ganMucDuLieu({ runId: "r" } as { runId: string; mucDuLieu?: () => Promise<MucDuLieu> }, async () => "van-hanh");
    expect(() => {
      "use strict";
      (ngu as { mucDuLieu?: unknown }).mucDuLieu = async () => "ky-thuat";
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(ngu, "mucDuLieu", { value: async () => "ky-thuat" })).toThrow(TypeError);
    expect(await ngu.mucDuLieu!()).toBe("van-hanh");
    expect(JSON.stringify(ngu)).toBe('{"runId":"r"}');
    expect("mucDuLieu" in { ...ngu }).toBe(false);
  });
});
