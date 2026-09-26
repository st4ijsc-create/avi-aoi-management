/**
 * ★★★ GỐC RỄ THẬT của sự cố HỘ MA — lưới canh, đo LIVE 2026-08-19.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vram_leases` tích **104/107 hàng của 77 pid ĐÃ CHẾT = 54.755 MiB hộ ma** trên card 32 GB ⇒ dư
 * địa tính ra **ÂM (−19054 MiB)** ⇒ **MỌI lượt gọi model bị từ chối**. Bộ quét hộ ma CÓ tồn tại và
 * ĐÚNG; nó **mù** vì `readProcTable()` trả `null` 100% số nhịp.
 *
 * Chẩn đoán ban đầu (của tôi VÀ của agent) là *"powershell lỗi/timeout"*. **SAI.** Đo trực tiếp:
 * powershell chạy xong, trả **122.285 ký tự**, và `JSON.parse` ném:
 *
 *     Bad control character in string literal in JSON at position 83902
 *
 * Ký tự thủ phạm: **U+001A**, nằm trong `CommandLine` của một tiến trình đang chạy trên máy.
 * `ConvertTo-Json` của Windows PowerShell 5.1 **KHÔNG thoát ký tự điều khiển thô**.
 *
 * ⚠ VÌ SAO PHÉP ĐO TRƯỚC ĐÓ KHÔNG BÁC BỎ ĐƯỢC GÌ: "cùng lệnh chạy từ một tiến trình Node khác cho
 * 413–467 ms, 0 lỗi" — phép đo ấy đo `run()`, thứ **quả thật chạy xong**. Nó KHÔNG đo `JSON.parse`.
 * *Cái được đo không phải cái đang hỏng* — cùng lớp lỗi với "lưới xanh vì lý do sai".
 *
 * ⚠ HỎNG PHỤ THUỘC **DỮ LIỆU ĐANG CHẠY TRÊN MÁY**, KHÔNG phụ thuộc mã ⇒ không tái hiện được trên
 * máy sạch, và biến mất khi tiến trình kia tắt. Vì thế lưới này **KHÔNG gọi powershell** — nó ghim
 * đúng CHUỖI đã đo được, để phép canh tất định và không đổi màu theo máy.
 *
 * ⚠ ĐÃ THỬ VÀ ĐO LÀ KHÔNG ĂN: lọc phía PowerShell bằng `-replace '[\x00-\x1F]'` — U+001A vẫn lọt
 * (vị trí ném 83902 → 83897, tức gần như không đổi). Nên việc lọc nằm ở phía Node.
 */
import { describe, it, expect } from "vitest";
import { parseProcTable, loBoKyTuDieuKhienTho } from "./vramGpuHolders";

/** U+001A — ĐÚNG ký tự đã làm hỏng lượt phân tích thật. Không dùng `\n`/`\t` cho dễ. */
const SUB = "\u001a";

/**
 * Tái dựng ĐÚNG hình dạng `ConvertTo-Json -Compress` nhả ra: ký tự điều khiển **THÔ** nằm trong
 * một chuỗi (nếu nó được thoát đúng thành `\u001a` thì đã không có sự cố nào).
 */
function nhuPowershellNha(cmdline: string): string {
  return `[{"pid":100,"ppid":4,"cmd":"${cmdline}","ct":1786685550544},{"pid":200,"ppid":100,"cmd":"node.exe","ct":1786685550999}]`;
}

describe("§1 — CA HỎNG THẬT: một ký tự điều khiển thô làm chết cả bảng tiến trình", () => {
  /**
   * ⚠ Dòng lệnh mẫu KHÔNG được chứa `\` trần: trong JSON đó là **escape bất hợp lệ**, một lớp hỏng
   * KHÁC hẳn. Lưới bản đầu của tôi dính đúng bẫy này — ca đỏ, và nó đỏ ĐÚNG: bản vá cố ý KHÔNG
   * chữa mù. `ConvertTo-Json` thật vẫn thoát `\` đúng chuẩn; nó chỉ bỏ sót ký tự ĐIỀU KHIỂN.
   * Nên chuỗi mẫu ở đây phải cô lập ĐÚNG MỘT biến: ký tự điều khiển thô.
   */
  const DONG_LENH = `grep.exe -E case|report ${SUB}|FATAL`;

  it("★★★ JSON.parse TRẦN ném trên chuỗi này (chứng minh ca này KHÔNG tự thoả)", () => {
    // Nếu ca này KHÔNG ném thì mọi khẳng định dưới đây vô nghĩa — nó là NEO của cả file.
    expect(() => JSON.parse(nhuPowershellNha(DONG_LENH))).toThrow();
  });

  it("★★★ `parseProcTable` VẪN đọc được — 2 hàng, không trả null (đây là bản vá)", () => {
    const raw = nhuPowershellNha(DONG_LENH);
    const rows = parseProcTable(raw);
    expect(rows, "trả null = bộ quét hộ ma mù = đúng sự cố 2 ngày").not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(rows![0].pid).toBe(100);
    expect(rows![1].pid).toBe(200);
  });

  it("★★★ `ctime` và `ppid` PHẢI sống sót — chúng là bằng chứng 'PID đã bị cấp lại'", () => {
    const rows = parseProcTable(nhuPowershellNha(`app.exe ${SUB} x`))!;
    // Mất ctime ⇒ mất khả năng phân biệt "cha thật" với "PID cấp lại" ⇒ hộ ma loại 2 bất tử.
    expect(rows[0].ctime).toBe(1786685550544);
    expect(rows[0].ppid).toBe(4);
  });

  it("★★ ký tự điều khiển bị BỎ, phần còn lại của dòng lệnh GIỮ NGUYÊN (khớp đường dẫn còn dùng được)", () => {
    const rows = parseProcTable(nhuPowershellNha(`D:\\\\app\\\\node.exe${SUB} --run`))!;
    expect(rows[0].cmdline).toContain("node.exe");
    expect(rows[0].cmdline).toContain("--run");
    expect(rows[0].cmdline).not.toContain(SUB);
  });

  const KHAC = [
    ["U+0000 NUL", "\u0000"],
    ["U+0001 SOH", "\u0001"],
    ["U+001F US", "\u001f"],
    ["U+000C FF", "\u000c"],
  ] as const;
  for (const [ten, ch] of KHAC) {
    it(`★★ ${ten} cũng được xử — không chỉ riêng U+001A tình cờ gặp hôm nay`, () => {
      const rows = parseProcTable(nhuPowershellNha(`x.exe${ch}y`));
      expect(rows).not.toBeNull();
      expect(rows!.length).toBe(2);
    });
  }
});

describe("§2 — KHÔNG vá quá tay: bản vá chỉ chạm đúng lớp hỏng đã đo", () => {
  it("★★★ JSON SẠCH đi đường thường, kết quả KHÔNG đổi một byte", () => {
    const sach = nhuPowershellNha("C:\\\\Windows\\\\System32\\\\svchost.exe -k netsvcs");
    const rows = parseProcTable(sach)!;
    expect(rows.length).toBe(2);
    expect(rows[0].cmdline).toBe("C:\\Windows\\System32\\svchost.exe -k netsvcs");
  });

  it("★★★ escape HỢP LỆ `\\u001a` (6 ký tự) KHÔNG bị đụng — nó là dữ liệu đúng, không phải rác", () => {
    // Đây là ranh giới: ký tự điều khiển THÔ là bất hợp lệ; dạng ĐÃ THOÁT là hợp lệ và phải giữ.
    const raw = `[{"pid":7,"ppid":1,"cmd":"a\\u001ab","ct":5}]`;
    const rows = parseProcTable(raw)!;
    expect(rows[0].cmdline).toBe(`a${SUB}b`);
  });

  it("★★★ JSON hỏng vì lý do KHÁC vẫn trả null — KHÔNG thử-lại-mù", () => {
    // Bản vá không được biến thành "cứ hỏng là chữa"; người gọi phải còn đường biết mình mù.
    expect(parseProcTable("{khong phai json")).toBeNull();
    expect(parseProcTable('[{"pid":1,"ppid":2,')).toBeNull();
  });

  it("★★ hàng thiếu pid/ppid vẫn bị loại (hành vi cũ giữ nguyên)", () => {
    const raw = `[{"pid":"khong-phai-so","ppid":1,"cmd":"x","ct":5},{"pid":9,"ppid":1,"cmd":"y","ct":6}]`;
    const rows = parseProcTable(raw)!;
    expect(rows.length).toBe(1);
    expect(rows[0].pid).toBe(9);
  });
});

describe("§3 — bộ lọc là một hàm THUẦN, kiểm được riêng", () => {
  it("★★ bỏ đúng U+0000–U+001F, giữ mọi thứ khác", () => {
    expect(loBoKyTuDieuKhienTho(`a${SUB}b\u0000c`)).toBe("abc");
    expect(loBoKyTuDieuKhienTho("tiếng Việt có dấu · 中文 · {}[]\"\\")).toBe(
      "tiếng Việt có dấu · 中文 · {}[]\"\\",
    );
  });

  it("★★★ ĐỐI CHỨNG — chuỗi KHÔNG có ký tự điều khiển thì hàm trả về CHÍNH NÓ", () => {
    const s = `[{"pid":1,"ppid":0,"cmd":"a b c","ct":9}]`;
    expect(loBoKyTuDieuKhienTho(s)).toBe(s);
  });
});
