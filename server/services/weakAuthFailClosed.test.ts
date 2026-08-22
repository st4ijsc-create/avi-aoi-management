/**
 * G — HAI ĐƯỜNG XÁC THỰC YẾU PHẢI ĐÓNG SẴN, mở là một quyết định phải gõ ra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ "MẶC ĐỊNH TƯƠNG THÍCH" TRONG XÁC THỰC NGHĨA LÀ "MỞ SẴN CHO NGƯỜI KHÔNG ĐỌC TÀI LIỆU"
 * ══════════════════════════════════════════════════════════════════════════════════
 * Trước 2026-08-22, cả hai đường yếu mặc định `allow`:
 *   • `machines.apiKey` — khoá dùng chung, lưu NGUYÊN VĂN, không băm, không xoay vòng;
 *   • `machineCode`-only — **không có bí mật nào cả**. Mã máy in trên nhãn ngoài vỏ máy,
 *     có trong báo cáo, trong URL, trong ảnh chụp màn hình. Nó là ĐỊNH DANH, chưa bao giờ
 *     là bí mật.
 *
 * Lý do ghi trong mã cho mặc định `allow` của đường thứ hai là: *"đây vẫn là phương thức
 * CHÍNH được tài liệu hoá, nên production mới lật, dev thì không"*. Lập luận ấy có một lỗ
 * không vá được bằng thêm chữ: **"production" không phải một trạng thái mà hệ thống tự
 * biết** — nó là một lời hứa của con người, và không lời hứa nào được kiểm ở đây. Hệ quả
 * thực tế: mọi bản cài chạy mở cho tới khi có ai đó nhớ ra.
 *
 * ── TIỀN ĐỀ ĐÃ ĐO, KHÔNG GIẢ ĐỊNH (2026-08-22) ──────────────────────────────────
 * 42 máy · **50 khoá `mk_` riêng từng máy còn hiệu lực, phủ đủ 42/42** · **0 máy đang
 * dùng thiếu khoá riêng** · 17 dòng plaintext đã bị mig 0334 xoá.
 * Không còn ai phụ thuộc đường yếu ⇒ giữ nó mở không mua được gì mà vẫn trả đủ giá.
 *
 * ── VÌ SAO CẦN LƯỚI NÀY DÙ MÃ ĐÃ ĐÚNG ────────────────────────────────────────────
 * Một mặc định là một dòng chữ; đổi lại nó tốn đúng năm ký tự và không làm đỏ thứ gì
 * (chính vì thế nó mới đứng nguyên ở `allow` suốt từ doc 51 tới nay). Lưới này biến việc
 * đó thành một hành động phải giải thích.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sharedMachineKeyPolicy, machineCodeOnlyPolicy, sharedMachineKeyAllowed } from "./machineAuthService";

const HERE = dirname(fileURLToPath(import.meta.url));

const BIEN = ["MACHINE_SHARED_KEY_ALLOWED", "MACHINE_CODE_ONLY_ALLOWED"] as const;
const luu: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const b of BIEN) {
    luu[b] = process.env[b];
    delete process.env[b];
  }
});
afterEach(() => {
  for (const b of BIEN) {
    if (luu[b] === undefined) delete process.env[b];
    else process.env[b] = luu[b];
  }
});

describe("G — xác thực yếu đóng sẵn", () => {
  it("★★★ KHÔNG khai gì ⇒ CẢ HAI đường yếu bị TỪ CHỐI", () => {
    expect(sharedMachineKeyPolicy()).toBe("deny");
    expect(machineCodeOnlyPolicy()).toBe("deny");
    expect(sharedMachineKeyAllowed()).toBe(false);
  });

  it("★★★ giá trị RÁC cũng phải rơi về `deny`, không bao giờ NỚI hơn mặc định", () => {
    // Đây là chỗ một mặc định lỏng gây hại lặng lẽ nhất: người vận hành gõ sai khi định
    // SIẾT, và nhận đúng trạng thái MỞ. Cùng lớp lỗi với E4 (env gõ sai im lặng rơi về
    // mặc định) — nhưng ở đây cái rơi xuống là một cánh cửa.
    // ⚠ Bản đầu của ca này xếp "yes"/"1" vào nhóm rác và ĐỎ. Chúng KHÔNG phải rác:
    // `parseWeakAuthPolicy` cố ý nhận từ vựng boolean cũ (`true|1|on|yes|allow`) để
    // không phá các file .env đời trước. Danh sách dưới đây chỉ còn thứ THẬT SỰ không
    // thuộc từ vựng nào — đọc thẳng từ `parseWeakAuthPolicy`, không đoán.
    for (const v of ["fasle", "", "  ", "ALLOWED_PLEASE", "denied", "read only"]) {
      process.env.MACHINE_SHARED_KEY_ALLOWED = v;
      process.env.MACHINE_CODE_ONLY_ALLOWED = v;
      const s = sharedMachineKeyPolicy();
      const c = machineCodeOnlyPolicy();
      expect(["deny", "read-only"], `MACHINE_SHARED_KEY_ALLOWED="${v}" ⇒ ${s}`).toContain(s);
      expect(["deny", "read-only"], `MACHINE_CODE_ONLY_ALLOWED="${v}" ⇒ ${c}`).toContain(c);
    }
  });

  it("mở lại vẫn được — nhưng phải KHAI BÁO tường minh", () => {
    // Đối trọng: nếu bản vá biến `deny` thành thứ không gỡ được thì một nhà máy còn thiết
    // bị đời cũ sẽ kẹt hoàn toàn. Siết KHÔNG có nghĩa là khoá cứng.
    process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
    process.env.MACHINE_CODE_ONLY_ALLOWED = "true";
    expect(sharedMachineKeyPolicy()).toBe("allow");
    expect(machineCodeOnlyPolicy()).toBe("allow");
  });

  it("nấc giữa `read-only` vẫn còn — con đường di trú dần không bị xoá", () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
    expect(sharedMachineKeyPolicy()).toBe("read-only");
  });

  it("★★★ mã nguồn phải ghi `deny` làm mặc định — không để ai lật lại bằng năm ký tự", () => {
    // Đọc MÃ (đã bỏ comment) chứ không chỉ đọc hành vi: hai ca trên vẫn xanh nếu ai đó
    // đổi mặc định thành "allow" rồi thêm một lớp ép kiểu ở chỗ khác. Ca này nói thẳng
    // về hằng số đang nằm trong lời gọi.
    const src = readFileSync(join(HERE, "machineAuthService.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(src).toMatch(/parseWeakAuthPolicy\(\s*"MACHINE_SHARED_KEY_ALLOWED"[^)]*?,\s*"deny"\s*\)/);
    expect(src).toMatch(/parseWeakAuthPolicy\(\s*"MACHINE_CODE_ONLY_ALLOWED"[^)]*?,\s*"deny"\s*\)/);
  });
});
