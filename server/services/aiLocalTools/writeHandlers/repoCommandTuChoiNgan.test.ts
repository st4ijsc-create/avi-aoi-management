/**
 * ★★★ 2026-08-23 · UX LÔ 1 (A1/A2/B3) — LƯỚI CHO **LỜI TỪ CHỐI LỆNH** ở cả hai mặt tiếp xúc:
 * `preview` (thẻ duyệt — dấu `[MÃ]` + bảng gấp) và `execute` (câu ngắn + gợi ý + bảng trong `data`).
 *
 * BA SỰ VIỆC LIVE ĐANG CANH:
 *   (A1) `CMD_METACHAR` mà chân thẻ nói "không có quyền" — câu server phải TỚI người dùng;
 *   (A2) thẻ chìa nút Xác nhận cho một lệnh chính preview khai sẽ bị chặn;
 *   (B3) mỗi lượt gõ sai ăn nguyên bức tường 9 lệnh (~2.300 ký tự).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ dấu `[MÃ]` ở nhánh `chan()` (client hết đường khoá nút)      ⇒ §1 ĐỎ
 *   • dấu bị đặt cả lên cảnh báo THÔNG TIN (khoá nút oan)             ⇒ §2 ĐỎ
 *   • câu CMD_NOT_ALLOWED phình lại thành bức tường                   ⇒ §3 ĐỎ (trần có SỐ)
 *   • gợi ý sai họ (`npm` gợi lệnh dotnet)                            ⇒ §3 ĐỎ
 *   • bảng đầy đủ rơi mất khỏi `data`/`[DANH_SACH_LENH]`              ⇒ §3/§4 ĐỎ (mất thông tin)
 *
 * ⚠ CRLF-an-toàn: mọi phép so là `toContain`/regex không neo dòng.
 */
import { describe, it, expect } from "vitest";
import "../index"; // đăng ký tool (side-effect)
import { docDanhSachLenh, docMaChan, timMaChan } from "@shared/aiCodingTuChoi";
import { DANH_SACH_TRANG, goiYLenhGanNhat } from "../repoCommandSandbox";
import { getTool } from "../toolRegistry";

const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };
const tool = () => getTool("run_command")!;

describe("§1 (A2) — nhánh TỪ CHỐI của preview mang dấu [MÃ] máy-đọc-được", () => {
  it("★★★ ký tự cấm (chữ 'và' lọt vào lệnh) ⇒ warnings[0] mang [CMD_METACHAR] và câu nói về KÝ TỰ, không về quyền", async () => {
    const pv = await tool().preview!({ command: "dotnet test và cho tôi biết" }, CTX as never);
    expect(timMaChan(pv.warnings)).toBe("CMD_METACHAR");
    expect(pv.warnings[0]).toContain("ký tự");
    expect(pv.warnings.join("\n")).not.toContain("không có quyền");
  });

  it("★★★ lệnh ngoài danh sách trắng ⇒ [CMD_NOT_ALLOWED] + một cảnh báo [DANH_SACH_LENH] gấp được", async () => {
    const pv = await tool().preview!({ command: "npm run build" }, CTX as never);
    expect(timMaChan(pv.warnings)).toBe("CMD_NOT_ALLOWED");
    const bang = pv.warnings.map(docDanhSachLenh).find((d) => d !== null);
    expect(bang, "bảng đầy đủ phải đi kèm — gấp lại chứ không vứt đi").not.toBeNull();
    expect(bang!.length).toBe(DANH_SACH_TRANG.length);
    for (const m of DANH_SACH_TRANG) expect(bang!.some((d) => d.includes(m.nhan)), m.nhan).toBe(true);
  });
});

describe("§2 (A2, chiều ÂM) — lệnh HỢP LỆ không mang dấu nào: nút Xác nhận không bị khoá oan", () => {
  it("★★★ `git status` (hợp lệ) ⇒ timMaChan = null dù thẻ có 4 cảnh báo thủ tục", async () => {
    const pv = await tool().preview!({ command: "git status" }, CTX as never);
    expect(pv.warnings.length).toBeGreaterThan(0);
    expect(timMaChan(pv.warnings)).toBeNull();
    expect(pv.warnings.map(docDanhSachLenh).find((d) => d !== null)).toBeUndefined();
  });

  it("★★★ `dotnet format` (ghiDia — cảnh báo NỔI BẬT nhưng là THÔNG TIN) ⇒ vẫn null", async () => {
    const pv = await tool().preview!({ command: "dotnet format sandbox-projects/csharp-demo" }, CTX as never);
    expect(pv.warnings[0]).toContain("GHI ĐÈ TỆP MÃ NGUỒN");
    expect(timMaChan(pv.warnings)).toBeNull();
  });
});

describe("§3 (B3) — câu CMD_NOT_ALLOWED: NGẮN + gợi ý ĐÚNG HỌ theo argv[0]", () => {
  it("★★★ `dotnet publish x` ⇒ câu ngắn (<700 ký tự) + gợi ý ĐỦ BA mục dotnet, KHÔNG lộ mục npm/git", async () => {
    const ra = await tool().execute!({ command: "dotnet publish x" }, CTX as never);
    const s = String(ra.textSummary ?? "");
    expect(ra.note).toBe("CMD_NOT_ALLOWED");
    expect(s.length, "bức tường 2.300 ký tự không được sống lại").toBeLessThan(700);
    expect(s).toContain("dotnet build");
    expect(s).toContain("dotnet test");
    expect(s).toContain("dotnet format");
    expect(s).not.toContain("npm run check");
    expect(s).not.toContain("git status");
    // Bất biến cũ giữ nguyên: khai đúng SỐ LƯỢNG từ bảng sống.
    expect(s).toContain(`${DANH_SACH_TRANG.length} lệnh được phép`);
  });

  it("★★ argv[0] không đoán được (`foobar x`) ⇒ không gợi bừa, chỉ chỉ về danh sách đầy đủ", async () => {
    const ra = await tool().execute!({ command: "foobar x" }, CTX as never);
    const s = String(ra.textSummary ?? "");
    expect(ra.note).toBe("CMD_NOT_ALLOWED");
    expect(s).not.toContain("Có phải bạn định chạy");
    expect(s).toContain("Xem cả danh sách");
  });

  it("★★ `goiYLenhGanNhat` thuần: dotnet⇒3 · npm⇒2 · git⇒2 · lạ/méo⇒0", () => {
    expect(goiYLenhGanNhat("dotnet").length).toBe(3);
    expect(goiYLenhGanNhat("npm").length).toBe(2);
    expect(goiYLenhGanNhat("git").length).toBe(2);
    expect(goiYLenhGanNhat("DOTNET").length).toBe(3); // không phân biệt hoa thường
    expect(goiYLenhGanNhat("foobar")).toEqual([]);
    expect(goiYLenhGanNhat(undefined)).toEqual([]);
    expect(goiYLenhGanNhat(42 as never)).toEqual([]);
  });
});

describe("§4 (B3) — bảng đầy đủ theo lượt execute trong `data.danhSachChoPhep` (thông tin không mất)", () => {
  it("★★★ CMD_NOT_ALLOWED ⇒ data mang đủ 9 dòng; lượt HỢP LỆ bị chặn vì mã KHÁC thì KHÔNG đính bảng", async () => {
    const ra = await tool().execute!({ command: "npm run build" }, CTX as never);
    const bang = (ra.data as { danhSachChoPhep?: string[] }).danhSachChoPhep ?? [];
    expect(bang.length).toBe(DANH_SACH_TRANG.length);
    // METACHAR: bảng không liên quan (lỗi là ký tự, không phải chọn nhầm lệnh) ⇒ không đính.
    const mc = await tool().execute!({ command: "npm run check; rm -rf /" }, CTX as never);
    expect(mc.note).toBe("CMD_METACHAR");
    expect((mc.data as { danhSachChoPhep?: string[] }).danhSachChoPhep).toBeUndefined();
  });
});

describe("§5 (A1) — câu của server nói BẢN CHẤT + việc-phải-làm (đối chiếu chân thẻ client)", () => {
  it("★★★ CMD_METACHAR: dòng ĐẦU textSummary nêu đích danh ký tự phạm luật — đúng câu client sẽ đặt vào chân thẻ", async () => {
    const ra = await tool().execute!({ command: "dotnet test và" }, CTX as never);
    expect(ra.note).toBe("CMD_METACHAR");
    const dongDau = String(ra.textSummary ?? "").split("\n", 1)[0]!;
    expect(dongDau).toContain("ký tự");
    expect(dongDau).toContain("à"); // nêu ĐÍCH DANH ký tự — người sửa được mà không phải đoán
    expect(dongDau).not.toContain("quyền");
  });

  it("★ docMaChan đọc được đúng mã từ chính cảnh báo preview (vòng server-ghi → client-đọc khép kín)", async () => {
    const pv = await tool().preview!({ command: "npm run build" }, CTX as never);
    expect(pv.warnings.some((w) => docMaChan(w) === "CMD_NOT_ALLOWED")).toBe(true);
  });
});
