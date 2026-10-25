/**
 * BIẾN THỂ BÍ MẬT NHÚNG THẲNG trong node HTTP — của người kiểm định (2026-10-25), đo trên 117247e44 (luong-ui đã vá F1 chính).
 * Mỗi ca: một luồng có node `tich-hop.http-gui` mang `SEC-…` ở đúng chỗ ghi trong tên ca ⇒ gói XUẤT KHÔNG được chứa dấu `SEC-…` (hoặc phải có cảnh báo `quetBiMat`).
 * Nhóm "MỨC CAO" = dạng phổ biến; "MỨC THẤP" = hiếm hoặc không thể phát hiện chắc chắn (người sửa có thể xin chủ dự án miễn bằng văn bản, KHÔNG sửa kỳ vọng).
 */
import { describe, expect, it } from "vitest";
import { quetBiMat, taoGoi } from "./xuatNhap";
import "./nut/index";

const node = (id: string, type: string, parameters: Record<string, unknown>) => ({ id, type, typeVersion: 1, name: `n-${id}`, position: [0, 0] as [number, number], parameters });
const http = (parameters: Record<string, unknown>): any => ({
  id: "x", name: "v", version: 1,
  nodes: [node("a", "kich-hoat.thu-cong", {}), node("h", "tich-hop.http-gui", { url: "https://h.example.com/p", ...parameters })],
  connections: [],
  settings: { uuTien: "background", luuDuLieu: "day-du" },
});
const roRi = (p: Record<string, unknown>, dau: string) => {
  const { goi } = taoGoi(http(p));
  return { lot: JSON.stringify(goi).includes(dau), canhBao: quetBiMat(goi.luong).length };
};

const CAO: [string, Record<string, unknown>, string][] = [
  ["than chuỗi 'Authorization: Bearer SEC' (giá trị 2 từ)", { than: "Authorization: Bearer SEC-AUTHBEARER" }, "SEC-AUTHBEARER"],
  ["than chuỗi 'authorization=Basic SEC'", { than: "authorization=Basic SEC-BASIC" }, "SEC-BASIC"],
  ["than object khoá tiếng Việt CÓ DẤU 'mật_khẩu'", { than: { "mật_khẩu": "SEC-VIET" } }, "SEC-VIET"],
  ["than chuỗi form 'mat_khau=' (tiếng Việt không dấu)", { than: "user=a&mat_khau=SEC-FORMVN" }, "SEC-FORMVN"],
  ["than object khoá 'pwd'", { than: { pwd: "SEC-PWD" } }, "SEC-PWD"],
  ["than object khoá 'pass'", { than: { pass: "SEC-PASS" } }, "SEC-PASS"],
  ["than object khoá 'credentials'", { than: { credentials: "SEC-CRED" } }, "SEC-CRED"],
  ["than object khoá 'signature'", { than: { signature: "SEC-SIG" } }, "SEC-SIG"],
  ["than object khoá 'otp'", { than: { otp: "SEC-OTP" } }, "SEC-OTP"],
  ["than object khoá 'sessionId'", { than: { sessionId: "SEC-SESS" } }, "SEC-SESS"],
  ["url userinfo mà mật khẩu CHỨA '@'", { url: "https://admin:SEC-PA@SS-TAIL@h.example.com/p" }, "SS-TAIL"],
  ["url có khoảng trắng đầu (userinfo)", { url: "  https://admin:SEC-LEADSP@h.example.com/p" }, "SEC-LEADSP"],
];
const THAP: [string, Record<string, unknown>, string][] = [
  ["url bí mật trong ĐƯỜNG DẪN (kiểu bot<id>:<token>)", { url: "https://h.example.com/bot123456:SEC-PATH/send" }, "SEC-PATH"],
  ["url tham số ma trận ';jsessionid='", { url: "https://h.example.com/p;jsessionid=SEC-MATRIX" }, "SEC-MATRIX"],
  ["url '?' mã hoá %3F", { url: "https://h.example.com/p%3Ftoken=SEC-ENC" }, "SEC-ENC"],
  ["tieuDe Accept mang 'key=SEC' (giá trị ngắn)", { tieuDe: { Accept: "application/json; key=SEC-ACCEPT" } }, "SEC-ACCEPT"],
  ["tieuDe User-Agent mang 'token=SEC'", { tieuDe: { "User-Agent": "app/1.0 token=SEC-UA" } }, "SEC-UA"],
];

describe("bí mật HTTP — MỨC CAO (dạng phổ biến)", () => {
  for (const [ten, p, dau] of CAO) {
    it(ten, () => {
      const r = roRi(p, dau);
      expect(r.lot && r.canhBao === 0, `lọt '${dau}' mà không cảnh báo`).toBe(false);
      expect(r.lot, `lọt '${dau}'`).toBe(false);
    });
  }
});
describe("bí mật HTTP — MỨC THẤP (hiếm / khó phát hiện chắc chắn)", () => {
  for (const [ten, p, dau] of THAP) {
    it(ten, () => {
      expect(roRi(p, dau).lot, `lọt '${dau}'`).toBe(false);
    });
  }
});
