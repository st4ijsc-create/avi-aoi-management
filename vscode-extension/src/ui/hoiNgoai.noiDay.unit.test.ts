/**
 * Đợt 10.4b-E — NỐI DÂY model ngoài vào bangChat/phienAgent/htmlBang bằng ghim VĂN BẢN (bangChat không dựng được trong lưới nhẹ) + hành vi thuần của
 * `luotChoWebview` (khôi phục hội thoại đã lưu cũng đi qua bộ render không tin cậy).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { luotChoWebview } from "../loi/modelNgoai";

const doc = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const bang = doc("ui", "bangChat.ts");
const phan = (a: string, b: string) => bang.slice(bang.indexOf(a), bang.indexOf(b));
const hoiNgoai = phan("private async hoiNgoai(", "private async hoi(");

describe("nối dây model ngoài", () => {
  it("★★★ hoiNgoai KHÔNG thu thập ngữ cảnh workspace / công cụ / MCP / bộ nhớ / đề xuất ghi", () => {
    expect(hoiNgoai.length).toBeGreaterThan(500);
    for (const cam of ["thuThapNguCanh", "chayToolCucBo", "dsToolMcpDangCoSan", "docDanhSachBoNho", "dungYeuCauStream", "xuLyDeXuatCucBo", "xuLyYeuCauLenh", "dungKhoiTepNgoai", "goiToolMcpNgoai", "phienAgent.chay"]) {
      expect(hoiNgoai).not.toContain(cam);
    }
  });
  it("★★★ lịch sử gửi model ngoài CHỈ gồm lượt do model ngoài sinh (lượt cục bộ có thể chứa mã/dữ liệu repo)", () => {
    expect(hoiNgoai).toContain("lichSu: this.lichSu.filter((l) => l.nguon),");
  });
  it("★★★ chọn model ngoài ⇒ rẽ sang hoiNgoai TRƯỚC khi quyết đường agent; không thể vào phienAgent.chay", () => {
    const rẽ = bang.indexOf("if (laChonNgoai(this.chonModelHienTai)) {");
    expect(rẽ).toBeGreaterThan(0);
    expect(rẽ).toBeLessThan(bang.indexOf("const duongAgent = "));
    expect(rẽ).toBeLessThan(bang.indexOf("void this.phienAgent.chay("));
    expect(bang.slice(rẽ, rẽ + 400)).toContain("return;");
  });
  it("★★★ phòng thủ lớp hai: agent không bao giờ nhận mã ngoai: từ ô chọn", () => {
    expect(bang).toContain('chonModel: () => (laChonNgoai(this.chonModelHienTai) ? "auto" : this.chonModelHienTai),');
  });
  it("lượt ngoài lưu kèm nhãn nguồn cho CẢ câu hỏi và trả lời; máy chủ tự lưu ⇒ không gọi saveStreamedMessage", () => {
    expect(hoiNgoai).toContain('{ role: "user", content: cauHoi, nguon: nhan }, { role: "assistant", content: traLoi, nguon: nhan }');
    expect(hoiNgoai).not.toContain("saveStreamedMessage");
  });
  it("render cuối của lượt ngoài qua lamKhongTinCay; đồng ý theo (hội thoại, model); hỏi đồng ý là hộp thoại modal", () => {
    expect(hoiNgoai).toContain("lamKhongTinCay(phanTichMarkdown(traLoi))");
    expect(hoiNgoai).toContain("khoaDongY(maHT, chonModel)");
    expect(hoiNgoai).toContain("{ modal: true }");
  });
  it("khôi phục hội thoại (khởi động + Lịch sử) đều qua luotChoWebview", () => {
    expect(bang.match(/\.map\(luotChoWebview\)/g)).toHaveLength(2);
  });
  it("webview: huy hiệu nguồn chỉ bằng textContent; xử lý nguon_ngoai + huyHieu ở hoan_tat + khôi phục", () => {
    const html = doc("ui", "htmlBang.ts");
    expect(html).toContain('m.loai === "nguon_ngoai"');
    expect(html).toContain("if (m.huyHieu && khoiTraLoi) datHuyHieuNguon(khoiTraLoi, m.huyHieu);");
    expect(html).toContain("if (l.huyHieu) datHuyHieuNguon(khung, l.huyHieu);");
    const ham = html.slice(html.indexOf("function datHuyHieuNguon("), html.indexOf("function themLuot("));
    expect(ham).toContain("h.textContent = ");
    expect(ham).not.toContain("innerHTML");
  });
  it("history gửi máy chủ KHÔNG mang trường nguon", () => {
    expect(doc("loi", "yeuCau.ts")).toContain("history: dv.lichSu.map((l) => ({ role: l.role, content: l.content })),");
  });
});

describe("luotChoWebview", () => {
  it("lượt cục bộ: nguyên như cũ (không huy hiệu); lượt ngoài: huy hiệu + cây không liên kết + bỏ ký tự hai chiều", () => {
    const cuc = luotChoWebview({ role: "assistant", content: "[a](https://h.example)" });
    expect(cuc.huyHieu).toBeUndefined();
    expect(JSON.stringify(cuc.cay)).toContain('"t":"a"');
    const ngoai = luotChoWebview({ role: "assistant", content: "[a](https://h.example) x‮y", nguon: "Model ngoài · p/m" });
    expect(ngoai.huyHieu).toBe("Model ngoài · p/m");
    expect(JSON.stringify(ngoai.cay)).not.toContain('"t":"a"');
    expect(JSON.stringify(ngoai.cay)).toContain("(h.example)");
    expect(String(ngoai.noiDung)).not.toContain("‮");
  });
  it("lượt người dùng ngoài: có huy hiệu, không có cây", () => {
    const u = luotChoWebview({ role: "user", content: "hỏi", nguon: "Model ngoài · p/m" });
    expect(u.cay).toBeUndefined();
    expect(u.huyHieu).toBe("Model ngoài · p/m");
  });
  it("nguon rỗng/không phải chuỗi ⇒ coi là cục bộ", () => {
    expect(luotChoWebview({ role: "assistant", content: "x", nguon: "" }).huyHieu).toBeUndefined();
    expect(luotChoWebview({ role: "assistant", content: "x", nguon: 5 as never }).huyHieu).toBeUndefined();
  });
});
