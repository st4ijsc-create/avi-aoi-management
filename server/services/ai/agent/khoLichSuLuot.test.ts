/** Đợt 12 · H5.4 — `chuanBiBanLuu`: che bí mật hai lớp, trần 400 tin / 400 KB, nén mạnh rồi từ chối. */
import { describe, expect, it } from "vitest";
import type { TinNhan } from "@shared/agentCore";
import { TRAN_BYTE_BAN_LUU, TRAN_TIN_BAN_LUU, chuanBiBanLuu, tiepTucBat } from "./khoLichSuLuot";

const KHOA = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const goi = (id: string, args = "{}") => ({ id, type: "function" as const, function: { name: "read_file", arguments: args } });

describe("tiepTucBat", () => {
  it("chỉ '1' bật", () => {
    expect(tiepTucBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "on"]) expect(tiepTucBat(v)).toBe(false);
  });
});

describe("chuanBiBanLuu", () => {
  it("★★★ bí mật bị che ở MỌI chỗ: content · reasoning_content · arguments của tool_calls · kết quả tool", () => {
    const vao: TinNhan[] = [
      { role: "system", content: "SYS không được lưu" },
      { role: "user", content: `khoá của tôi ${KHOA}` },
      { role: "assistant", content: `ok ${KHOA}`, reasoning_content: `nghĩ ${KHOA}`, tool_calls: [goi("a", `{"k":"${KHOA}"}`)] },
      { role: "tool", tool_call_id: "a", name: "read_file", content: `kết quả ${KHOA}` },
    ];
    const r = chuanBiBanLuu(vao);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.tinNhan)).not.toContain(KHOA);
    expect(r.tinNhan).toHaveLength(3);
    expect(r.tinNhan.some((m) => m.role === "system")).toBe(false);
    expect(r.soByte).toBeGreaterThan(0);
    // cấu trúc giữ nguyên (id lời gọi, role, tên tool)
    expect(r.tinNhan[1]!.tool_calls![0]!.id).toBe("a");
    expect(r.tinNhan[2]).toMatchObject({ role: "tool", tool_call_id: "a", name: "read_file" });
    // không đột biến đầu vào
    expect(vao[1]!.content).toContain(KHOA);
  });

  it("vượt 400 tin ⇒ từ chối (qua-nhieu-tin), không cắt lặng lẽ", () => {
    const vao: TinNhan[] = Array.from({ length: TRAN_TIN_BAN_LUU + 1 }, (_v, i) => ({ role: "user", content: `m${i}` }));
    expect(chuanBiBanLuu(vao)).toEqual({ ok: false, ly: "qua-nhieu-tin" });
    expect(chuanBiBanLuu(vao.slice(0, TRAN_TIN_BAN_LUU)).ok).toBe(true);
  });

  it("★ vượt 400 KB nhưng nén mạnh được ⇒ lưu bản đã nén, ≤ trần", () => {
    const dong: TinNhan[] = [{ role: "user", content: "q" }];
    for (let i = 0; i < 12; i++) {
      dong.push({ role: "assistant", content: "", tool_calls: [goi(`c${i}`, `{"path":"f${i}"}`)] });
      dong.push({ role: "tool", tool_call_id: `c${i}`, name: "read_file", content: "x".repeat(60_000) });
    }
    const r = chuanBiBanLuu(dong);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soByte).toBeLessThanOrEqual(TRAN_BYTE_BAN_LUU);
    expect(r.tinNhan).toHaveLength(dong.length);
    // bước cuối nguyên văn, bước cũ bị rút
    expect(r.tinNhan.at(-1)!.content.length).toBe(60_000);
    expect(r.tinNhan.some((m) => m.role === "tool" && m.content.startsWith("[compacted:"))).toBe(true);
  });

  it("★ vượt 400 KB và nén mạnh KHÔNG đủ (bước cuối quá lớn) ⇒ từ chối (qua-lon) để host XOÁ bản lưu", () => {
    const vao: TinNhan[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", tool_calls: [goi("a")] },
      { role: "tool", tool_call_id: "a", name: "read_file", content: "y".repeat(TRAN_BYTE_BAN_LUU + 10) },
    ];
    expect(chuanBiBanLuu(vao)).toEqual({ ok: false, ly: "qua-lon" });
  });

  it("đếm byte theo UTF-8 thật (tiếng Việt/ký tự rộng không lọt trần)", () => {
    const vao: TinNhan[] = [{ role: "user", content: "ệ".repeat(Math.floor(TRAN_BYTE_BAN_LUU / 2)) }];
    expect(chuanBiBanLuu(vao).ok).toBe(false); // ~3 byte/ký tự ⇒ vượt trần dù ít ký tự hơn trần
  });
});
