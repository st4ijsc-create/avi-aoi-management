/**
 * ★★★ Pha 7 Task 9 / **R2** — *"script xoay BÁO THÀNH CÔNG mà KHÔNG XOAY GÌ"* phải là điều
 * **KHÔNG XẢY RA ĐƯỢC**.
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỚP LỖI, VÀ VÌ SAO NÓ NGUY HƠN MỘT LỖI THƯỜNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `scripts/xoay-bi-mat-2fa.mjs` chạy SQL **thô**. Bản trước Task 9 viết
 * `UPDATE users SET two_factor_secret = NULL`. Sau khi (9c) chuyển hạt giống TOTP sang
 * `user_secrets` **mà cột cũ vẫn còn trên `users`** cho tới migration `0315`, câu ấy:
 *   · chạy **THÀNH CÔNG** (cột tồn tại),
 *   · in *"✔ Đã xoay N tài khoản"*,
 *   · và **KHÔNG xoay bí mật đang được dùng** — 2FA của mọi người vẫn chạy bằng hạt giống **ĐÃ
 *     LỘ**, còn ảnh chụp hoàn tác thì chụp một **bản chết**.
 * Không có mã lỗi nào, không có dòng log nào sai. Người vận hành đọc *"đã xoay"* và **đóng hồ sơ**.
 * Đây đúng lớp Critical của Pha 3 (*"giết nhầm tiến trình rồi báo cáo thành công"*).
 *
 * ⚠⚠ Phép đếm ở Bước 2 (§2.6 báo cáo Task 9) bắt được nó **TRƯỚC KHI ĐỔI** — lần thứ HAI trong
 *    cùng một lượt đếm mà thứ nguy nhất **không phải** cái đang được vá.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO LƯỚI NÀY CÓ HAI TẦNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  §1 **VỊ TỪ** — `loiCuaNguonBiMat()` được `import` thẳng từ chính file script (script **vừa là
 *     kịch bản vừa là module**; `main()` chỉ chạy khi gọi trực tiếp). Đây là ô nói *"cổng nguồn
 *     TỪ CHỐI đúng lúc cần từ chối"*.
 *  §2 **HÀNH VI ĐẦU-CUỐI** — chạy **chính script ấy** như một tiến trình con, trỏ vào một DB
 *     **không có** `user_secrets`, và đòi **mã thoát ≠ 0**. Ô §1 một mình không đủ: nó chứng minh
 *     vị từ đúng, **không** chứng minh script GỌI nó trước khi đụng dữ liệu. Lớp lỗi *"lưới theo
 *     FILE, không theo ĐƯỜNG THOÁT"* đã tái diễn **mười một** lần.
 *
 * ⚠ VÙNG MÙ ĐƯỢC KHAI: §2 dùng DB `postgres` (mặc định của cụm) làm *"nguồn sai"*. Nó không có
 *   `user_secrets`, cũng không có `users` — nên nó chứng minh **cổng chặn TRƯỚC mọi truy vấn dữ
 *   liệu**, chứ không tái dựng đúng kịch bản *"có `users`, thiếu `user_secrets`"*. Kịch bản ấy được
 *   §1 phủ ở tầng vị từ. Nói ra để không ai đọc màu xanh này thành "đã phủ hết".
 */
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BANG_NGUON_BI_MAT, loiCuaNguonBiMat } from "../../scripts/xoay-bi-mat-2fa.mjs";

const chay = promisify(execFile);
const GOC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SCRIPT = join(GOC, "scripts", "xoay-bi-mat-2fa.mjs");

/** DB test thật (vitest.setup.ts ép `DATABASE_URL` về bản sao đã cách ly). */
const DB_DUNG = process.env.DATABASE_URL!;
/** Cùng cụm, cùng thông tin đăng nhập — nhưng **KHÔNG có** `user_secrets`. */
const DB_SAI = DB_DUNG.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

describe("★★★ Task 9 / R2 §1 — CỔNG NGUỒN: vị từ từ chối đúng lúc cần từ chối", () => {
  it("★★★ bảng nguồn KHÔNG tồn tại ⇒ có LỖI, và câu lỗi gọi ĐÚNG TÊN bảng", () => {
    const loi = loiCuaNguonBiMat({ coBangNguon: false, soHangLechNguon: 0 });
    expect(loi, "thiếu bảng nguồn mà cổng vẫn cho qua ⇒ script sẽ UPDATE một cột ĐÃ CHẾT").toBeTruthy();
    expect(loi).toContain(BANG_NGUON_BI_MAT);
  });

  it("★★★ có bảng nguồn nhưng DỮ LIỆU CHƯA CHÉP SANG ⇒ vẫn phải từ chối", () => {
    // Tình huống thật: 0314 tạo bảng nhưng câu `INSERT … SELECT` chưa chạy (hoặc một tài khoản
    // được tạo bởi build cũ). Xoay lúc này để lại một bí mật VẪN DÙNG ĐƯỢC ở chỗ script không nhìn.
    const loi = loiCuaNguonBiMat({ coBangNguon: true, soHangLechNguon: 3 });
    expect(loi, "lệch nguồn mà vẫn cho xoay ⇒ bí mật đã lộ SỐNG SÓT qua lượt xoay").toBeTruthy();
    expect(loi).toContain("3");
  });

  it("★★ KHÔNG BẮT NHẦM — nguồn đúng, không lệch ⇒ cổng cho qua (`null`)", () => {
    // Không có ô này thì một cổng **chặn hết** cũng "đạt", và Task 10 không bao giờ chạy được.
    expect(loiCuaNguonBiMat({ coBangNguon: true, soHangLechNguon: 0 })).toBeNull();
  });

  it("★★★ tên bảng nguồn khớp bảng THẬT mà mã đang đọc (`user_secrets`), không phải một chuỗi tự do", () => {
    expect(BANG_NGUON_BI_MAT).toBe("user_secrets");
  });
});

describe("★★★ Task 9 / R2 §2 — HÀNH VI ĐẦU-CUỐI: trỏ SAI bảng ⇒ THẤT BẠI, KHÔNG im lặng thành công", () => {
  it("★★★★ chạy thật script với DB KHÔNG có `user_secrets` ⇒ mã thoát ≠ 0 và KHÔNG in 'đã xoay'", async () => {
    let ma = 0;
    let out = "";
    let err = "";
    try {
      const kq = await chay(process.execPath, [SCRIPT, `--db=${DB_SAI}`], { timeout: 60_000 });
      out = kq.stdout;
      err = kq.stderr;
    } catch (e) {
      const x = e as { code?: number; stdout?: string; stderr?: string };
      ma = typeof x.code === "number" ? x.code : 1;
      out = x.stdout ?? "";
      err = x.stderr ?? "";
    }
    const tatCa = `${out}\n${err}`;
    expect(
      ma,
      `script thoát 0 khi trỏ vào một DB KHÔNG có \`${BANG_NGUON_BI_MAT}\`.\n` +
        "⚠ Đó chính là lượt 'báo cáo thành công mà không xoay gì'.\n---\n" +
        tatCa,
    ).not.toBe(0);
    expect(tatCa, "câu lỗi không gọi tên bảng nguồn ⇒ người vận hành không biết phải sửa gì").toContain(
      BANG_NGUON_BI_MAT,
    );
    expect(tatCa, "script vẫn in một câu KẾ HOẠCH XOAY dù nguồn sai").not.toMatch(/Đã xoay|LƯỢT KHÔ/);
  }, 90_000);

  it("★★★ ĐỐI CHỨNG DƯƠNG — cùng script, DB ĐÚNG ⇒ thoát 0, in ra ĐÚNG tên bảng nó sẽ đụng", async () => {
    // Không có ô này thì một script **luôn hỏng** cũng thoả ô trên, và Task 10 mất điều kiện vào.
    const kq = await chay(process.execPath, [SCRIPT, `--db=${DB_DUNG}`], { timeout: 60_000 });
    const tatCa = `${kq.stdout}\n${kq.stderr}`;
    expect(tatCa).toContain(`Nguồn bí mật đang dùng: \`${BANG_NGUON_BI_MAT}\``);
    // Lượt KHÔ mặc định — không được đụng dữ liệu.
    expect(tatCa).not.toContain("Đã xoay");
  }, 90_000);
});

describe("★★★ Task 9 / R2 §3 — ∀ SQL thô trong `scripts/**` chạm bí mật phải trỏ bảng nguồn", () => {
  /**
   * Lượng từ trên trục **NGƯỜI GHI NGOÀI ỨNG DỤNG**. Bốn script cùng lớp đã được đếm ở §2.6 báo
   * cáo Task 9 (`xoay-bi-mat-2fa` · `print-otp` · `seed-test-data` · `audit/audit-account`) — và
   * một danh sách bốn tên là một danh sách **có phần tử thứ năm**.
   *
   * ⚠ VÙNG MÙ ĐƯỢC KHAI: bộ quét chỉ đọc **chuỗi mẫu SQL** trong file `.mjs` dưới `scripts/`.
   *   `scripts/seed-admin.mjs` dùng `mysql2` + `connection.execute("… ?")` — một kịch bản **CHẾT**
   *   (repo này chạy Postgres; câu ấy chưa bao giờ chạy được ở đây). Nó KHÔNG được vá ở lượt này
   *   và KHÔNG bị bộ quét nhìn tới; đó là **nợ có trước**, khai ra chứ không im lặng.
   */
  const THU_MUC = join(GOC, "scripts");
  const BO_QUA = new Set(["seed-admin.mjs"]); // mysql2, kịch bản chết — xem docstring

  function moiFileMjs(goc: string): string[] {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const ra: string[] = [];
    for (const ten of readdirSync(goc)) {
      if (ten === "node_modules") continue;
      const p = join(goc, ten);
      if (statSync(p).isDirectory()) ra.push(...moiFileMjs(p));
      else if (ten.endsWith(".mjs") && !ten.startsWith("__tmp")) ra.push(p);
    }
    return ra;
  }

  it("★★★ cầu chì — quét thấy đủ nhiều file (0 file ⇒ ô dưới là chân lý rỗng)", () => {
    expect(moiFileMjs(THU_MUC).length).toBeGreaterThanOrEqual(5);
  });

  it("★★★ ∀ — KHÔNG câu SQL nào GHI vào cột bí mật CŨ trên `users`", () => {
    // ⚠ Đơn vị phân tích là **một mẫu SQL** (một chuỗi giữa hai dấu huyền), KHÔNG phải "400 ký tự
    //   quanh chỗ khớp": lượt chạy đầu của bộ quét này BẮT NHẦM ba chỗ đúng vì thiếu ranh giới —
    //   `UPDATE users SET …` ở mẫu này và `INSERT INTO user_secrets (… "passwordHash" …)` ở mẫu
    //   NGAY SAU bị gộp thành một. Lưới bắt nhầm là lưới sẽ bị người sau tắt đi.
    const viPham: string[] = [];
    for (const f of moiFileMjs(THU_MUC)) {
      const ten = f.slice(THU_MUC.length + 1).replace(/\\/g, "/");
      if (BO_QUA.has(ten)) continue;
      const src = readFileSync(f, "utf8");
      // bỏ chú thích dòng — lý lẽ về lỗ cũ được viết bằng chính câu SQL cũ
      const ma = src
        .split(/\r?\n/)
        .filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d))
        .join("\n");
      for (const mau of ma.match(/`[^`]*`/g) ?? []) {
        if (!/\b(UPDATE\s+users\b|INSERT\s+INTO\s+users\b)/i.test(mau)) continue;
        for (const cot of ["two_factor_secret", '"passwordHash"']) {
          if (mau.includes(cot)) viPham.push(`${ten}: ghi \`${cot}\` trên bảng \`users\``);
        }
      }
    }
    expect(
      viPham.join("\n  "),
      "một script GHI bí mật vào cột CŨ trên `users`.\n" +
        `⚠ Mã đọc bí mật từ \`${BANG_NGUON_BI_MAT}\` ⇒ câu ấy CHẠY THÀNH CÔNG và KHÔNG có tác dụng gì.\n` +
        "  Đúng lớp 'làm hỏng rồi BÁO CÁO THÀNH CÔNG'.",
    ).toBe("");
  });
});
