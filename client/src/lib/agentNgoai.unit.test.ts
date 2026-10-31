// Đợt 10.4b L4 — công tắc agent-ngoài do MÁY CHỦ mở (danh mục `duocDungO`), chỉ có nghĩa khi đang chọn đúng model ngoài đó.
import { describe, expect, it } from "vitest";
import { agentNgoaiMo, dungAgentNgoai } from "./agentNgoai";
import type { MucModel } from "./chonModel";

const mk = (ma: string, loai: MucModel["loai"], duocDungO?: string[]): MucModel =>
  ({ ma, loai, nhan: ma, moTa: "", trangThai: "san-sang", ...(duocDungO ? { duocDungO } : {}) }) as MucModel;
const NG = "ngoai:openai:gpt-test";
const DM = [mk("auto", "auto"), mk("vai-tro:code.software", "vai-tro"), mk(NG, "ngoai", ["chat", "coding", "agent"]), mk("ngoai:openai:chi-coding", "ngoai", ["coding"]), mk("ngoai:openai:khong-khai", "ngoai")];

describe("agentNgoaiMo", () => {
  it("model ngoài có 'agent' trong duocDungO ⇒ mở", () => expect(agentNgoaiMo(DM, NG)).toBe(true));
  it("model ngoài chỉ có coding ⇒ đóng (máy chủ chưa mở agent)", () => expect(agentNgoaiMo(DM, "ngoai:openai:chi-coding")).toBe(false));
  it("danh mục không khai duocDungO ⇒ đóng (fail-closed)", () => expect(agentNgoaiMo(DM, "ngoai:openai:khong-khai")).toBe(false));
  it("model không có trong danh mục ⇒ đóng", () => expect(agentNgoaiMo(DM, "ngoai:openai:la")).toBe(false));
  it("model cục bộ / auto ⇒ đóng", () => {
    expect(agentNgoaiMo(DM, "auto")).toBe(false);
    expect(agentNgoaiMo(DM, "vai-tro:code.software")).toBe(false);
  });
  it("mã mang loại không phải ngoài dù trùng chuỗi ⇒ đóng", () => {
    expect(agentNgoaiMo([mk(NG, "vai-tro", ["agent"])], NG)).toBe(false);
  });
});

describe("dungAgentNgoai", () => {
  it("bật + model ngoài đã mở agent ⇒ đi đường agent-ngoài", () => expect(dungAgentNgoai(true, DM, NG)).toBe(true));
  it("tắt ⇒ không", () => expect(dungAgentNgoai(false, DM, NG)).toBe(false));
  it("bật nhưng đã đổi về model cục bộ ⇒ KHÔNG rò sang lượt cục bộ", () => {
    expect(dungAgentNgoai(true, DM, "vai-tro:code.software")).toBe(false);
    expect(dungAgentNgoai(true, DM, "auto")).toBe(false);
  });
  it("bật nhưng bề mặt agent đóng ⇒ không", () => expect(dungAgentNgoai(true, DM, "ngoai:openai:chi-coding")).toBe(false));
});
