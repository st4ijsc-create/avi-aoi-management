/** Đợt 11.4 / mục 6 — terminal chỉ đọc: làm sạch mã điều khiển, CRLF, trần, khung lệnh/exit; nối dây. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRAN_KY_TU_MOT_LAN_GHI, dinhDangLanChay, lamSachChoTerminal } from "./terminalDoc";

describe("terminalDoc", () => {
  it("★ lamSachChoTerminal bỏ ESC/CSI (không để đầu ra điều khiển terminal) và ký tự điều khiển, giữ \n \t", () => {
    expect(lamSachChoTerminal("a\u001b[31mđỏ\u001b[0m\u001b]0;x\u0007b\tc\nd\u0000")).toBe("ađỏ]0;xb\tc\nd");
    expect(lamSachChoTerminal("\u001b[2J\u001b[Hhi")).toBe("hi");
  });
  it("khung: «$ lệnh», nội dung, [exit n]; xuống dòng CRLF; kết bằng dòng trống", () => {
    expect(dinhDangLanChay("npm  run\tcheck", 1, "l1\nl2\n")).toBe("$ npm run check\r\nl1\r\nl2\r\n[exit 1]\r\n\r\n");
    expect(dinhDangLanChay("x", null, "")).toBe("$ x\r\n[exit none]\r\n\r\n");
    expect(dinhDangLanChay("x", 0, "a\r\nb\rc")).toBe("$ x\r\na\r\nb\r\nc\r\n[exit 0]\r\n\r\n");
  });
  it("trần ký tự: cắt đúng TRAN rồi ghi chú", () => {
    const kq = dinhDangLanChay("x", 0, "y".repeat(TRAN_KY_TU_MOT_LAN_GHI + 50));
    expect(kq.split("y").length - 1).toBe(TRAN_KY_TU_MOT_LAN_GHI);
    expect(kq).toContain("đã cắt bớt");
    expect(dinhDangLanChay("x", 0, "y".repeat(TRAN_KY_TU_MOT_LAN_GHI))).not.toContain("đã cắt bớt");
  });
  it("★ ghim trần = 20000 (không chỉ theo hằng)", () => {
    expect(TRAN_KY_TU_MOT_LAN_GHI).toBe(20_000);
  });
  it("★ dòng lệnh cũng bị làm sạch ESC/CSI (header không điều khiển được terminal)", () => {
    expect(dinhDangLanChay("npm\u001b[2J run", 0, "ok")).toBe("$ npm run\r\nok\r\n[exit 0]\r\n\r\n");
  });
  it("★ mã điều khiển C1 8-bit (xterm.js xử lý) bị bỏ: CSI \u009b, OSC \u009d…\u009c", () => {
    expect(lamSachChoTerminal("a\u009b31mb")).toBe("a31mb");
    expect(lamSachChoTerminal("a\u009d0;x\u009cb")).toBe("a0;xb");
    expect(lamSachChoTerminal("x\u007fy\u0085z")).toBe("xyz");
  });
  it("nối dây: BoThucThiVscode ghi terminal sau lệnh; extension đăng ký; manifest có lệnh mở", () => {
    expect(readFileSync(join(__dirname, "..", "ui", "boThucThiVscode.ts"), "utf8")).toContain("ghiLanChayAgent(xet.lenh.hienThi, kq.exitCode, vanBan);");
    expect(readFileSync(join(__dirname, "..", "extension.ts"), "utf8")).toContain("dangKyTerminalDoc(context);");
    const m = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(m.contributes.commands.map((c: { command: string }) => c.command)).toContain("aviAiLocal.moTerminalDoc");
  });
});
