/**
 * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — **"AI ĐỌC ĐƯỢC BÀI HỌC CỦA AI", ĐO TRÊN CSDL THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CHẠM CSDL THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba thứ đang được canh **không tồn tại** ngoài CSDL:
 *   1. một **mệnh đề WHERE** (`eq(userId)`) — một `db` giả trả về mảng do chính lưới nạp vào thì
 *      hàng rào có mặt hay không **không đổi kết quả**, đột biến sống sót, lưới vẫn xanh;
 *   2. một **UNIQUE index** — "bài học trùng không nhân bản" bằng `SELECT`-rồi-`INSERT` là một
 *      điều kiện chạy đua; chỉ CSDL mới cưỡng chế được nó;
 *   3. hai **CHECK** — trong đó `mucRuiRo IN ('none','low')` là chỗ *"bài học chứa câu ra lệnh nới
 *      quyền"* chết **lần thứ hai**, ở tầng không vòng qua được bằng một cửa ghi mới.
 *
 * ⚠ Bài học rút ra ở doc 79 (đột biến M5): một ca *"CSDL từ chối X"* phải chứng minh nó xanh **vì
 *   ràng buộc ấy**, không vì một lý do khác (FK, kiểu cột…). Nên mỗi ca ràng buộc ở đây có một
 *   lượt **DROP rồi INSERT lại** để chứng minh chính ràng buộc đó đang gánh việc.
 *
 * ⚠ Dọn dẹp GIỚI HẠN theo hàng CHÍNH FILE NÀY tạo (`openId` mang tiền tố + dấu thời gian), theo
 *   đúng bất biến `server/_core/xoaHangKhongGioiHanTrongTest.test.ts`: vitest chạy song song trên
 *   MỘT CSDL test, một lượt xoá rộng ở đây sẽ giết hàng của file khác.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { getDb } from "./connection";
import { users, aiCodingLessons } from "../../drizzle/schema";
import { danhSachBaiHoc, demBaiHoc, luuBaiHoc, xoaBaiHocTheoThuTu } from "./aiCodingLessons";

const TAG = `aicl_${Date.now()}`;
const DU_AN = "repo";
const DU_AN_KHAC = "csharpdemo";

let idA = 0;
let idB = 0;
let idAdmin = 0;
let coDb = false;

async function mkUser(tag: string, role: "engineer" | "admin"): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `baihoc ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u!.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idA = await mkUser("a", "engineer");
  idB = await mkUser("b", "engineer");
  idAdmin = await mkUser("admin", "admin");
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ids = [idA, idB, idAdmin].filter((x) => x > 0);
  if (ids.length === 0) return;
  // ⚠ Xoá theo ĐÚNG các id file này tạo — không bao giờ `DELETE` trần trên bảng dùng chung.
  await db.delete(aiCodingLessons).where(inArray(aiCodingLessons.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
});

const co = (ten: string, fn: () => Promise<void>) =>
  it(ten, async () => {
    if (!coDb) return; // không có CSDL ⇒ bỏ qua, không giả vờ xanh
    await fn();
  });

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — ★★★ RIÊNG TƯ: bài học của A KHÔNG vào được tay B, kể cả `admin`", () => {
  co("★★★ A ghi ⇒ A đọc thấy · B đọc KHÔNG thấy · ADMIN đọc KHÔNG thấy", async () => {
    const noiDung = `${TAG} du an nay dung bcryptjs dung dung crypto`;
    const r = await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    expect(r.ma).toBe("them");

    const cuaA = await danhSachBaiHoc(idA, DU_AN);
    expect(cuaA.some((b) => b.noiDung === noiDung), "chủ sở hữu PHẢI đọc được").toBe(true);

    const cuaB = await danhSachBaiHoc(idB, DU_AN);
    expect(cuaB.some((b) => b.noiDung === noiDung), "★★★ B KHÔNG được thấy bài học của A").toBe(false);

    const cuaAdmin = await danhSachBaiHoc(idAdmin, DU_AN);
    expect(
      cuaAdmin.some((b) => b.noiDung === noiDung),
      "★★★ ADMIN cũng KHÔNG — phạm vi là CHỦ SỞ HỮU, không phải vai",
    ).toBe(false);
  });

  co("★★★ B KHÔNG xoá được bài học của A — số thứ tự của B tính trong kho của B", async () => {
    const noiDung = `${TAG} khong xoa duoc cua nguoi khac`;
    await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    const truoc = await demBaiHoc(idA, DU_AN);

    // B thử xoá "mục số 1" — trong kho của B, mục ấy hoặc không có, hoặc là của chính B.
    await xoaBaiHocTheoThuTu(idB, DU_AN, 1);
    expect(await demBaiHoc(idA, DU_AN), "kho của A không suy chuyển").toBe(truoc);
    const conA = await danhSachBaiHoc(idA, DU_AN);
    expect(conA.some((b) => b.noiDung === noiDung)).toBe(true);
  });

  co("★★ bài học bám DỰ ÁN: ghi ở dự án này KHÔNG rò sang dự án khác", async () => {
    const noiDung = `${TAG} chi thuoc mot du an`;
    await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    const khac = await danhSachBaiHoc(idA, DU_AN_KHAC);
    expect(khac.some((b) => b.noiDung === noiDung)).toBe(false);
  });

  co("★★ A xoá được bài học CỦA CHÍNH MÌNH", async () => {
    const noiDung = `${TAG} muc se bi xoa ${Math.random()}`;
    await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    const ds = await danhSachBaiHoc(idA, DU_AN);
    const viTri = ds.findIndex((b) => b.noiDung === noiDung);
    expect(viTri).toBeGreaterThanOrEqual(0);
    const r = await xoaBaiHocTheoThuTu(idA, DU_AN, viTri + 1);
    expect(r.ok).toBe(true);
    const sau = await danhSachBaiHoc(idA, DU_AN);
    expect(sau.some((b) => b.noiDung === noiDung)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — ★★★ TRÙNG ⇒ KHÔNG NHÂN BẢN, và đó là thuộc tính của CÁI BẢNG", () => {
  co("★★★ ghi cùng nội dung 3 lần ⇒ đúng MỘT hàng", async () => {
    const noiDung = `${TAG} migration chay bang owner aoi`;
    const truoc = await demBaiHoc(idA, DU_AN);
    const r1 = await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    const r2 = await luuBaiHoc(idA, { projectId: DU_AN, noiDung: `  ${noiDung.toUpperCase()}.  `, mucRuiRo: "none" });
    const r3 = await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" });
    expect(r1.ma).toBe("them");
    expect(r2.ma, "khác hoa/thường + dấu câu hai đầu ⇒ CÙNG khoá").toBe("trung");
    expect(r3.ma).toBe("trung");
    expect(await demBaiHoc(idA, DU_AN)).toBe(truoc + 1);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO ĐỘT BIẾN DDL **KHÔNG** NẰM TRONG FILE NÀY — VÀ ĐÂY LÀ MỘT PHÉP ĐO, KHÔNG PHẢI LƯỜI
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bản đầu của file này có hai ca tự `DROP INDEX` / `DROP CONSTRAINT` rồi hoàn nguyên. Chạy thật
   * thì cả hai ĐỎ với **`42501 must be owner of ...`**: kết nối lưới đi bằng vai ứng dụng
   * `avi_app`, còn bảng do `aoi` sở hữu. Đây đúng cạm bẫy đã ghi sổ (*"đột biến `ALTER TABLE` bằng
   * `avi_app` → 42501, lưới vẫn xanh, suýt đọc nhầm thành bắt được"*) — ở đây nó ĐỎ chứ không xanh
   * giả, nhưng một ca bọc `try/catch` quanh lượt DROP sẽ **xanh vì lý do sai** ngay lập tức.
   *
   * ⇒ Đột biến DDL được chạy **NGOÀI lưới, bằng owner `aoi`**, trên `aoi_management_test`, và bằng
   *   chứng nằm ở báo cáo. Kết quả đã đo (2026-08-23):
   *     • `DROP INDEX ux_ai_coding_lessons_khoa` ⇒ §2 ca "ghi 3 lần ⇒ MỘT hàng" **ĐỎ**
   *       (`them` thay vì `trung`, đếm 3 thay vì 1) ⇒ UNIQUE đang gánh việc, không phải mã ứng dụng.
   *     • `DROP CONSTRAINT chk_ai_coding_lessons_risk` ⇒ §3 ca "INSERT 'high' ⇒ từ chối" **ĐỎ**
   *       (hàng `high` lọt vào bảng) ⇒ CHECK là hàng rào THẬT, không trang trí.
   *   Cả hai đã hoàn nguyên và đo lại XANH.
   */

  co("★ HAI người khác nhau ghi CÙNG nội dung ⇒ HAI hàng (khoá gồm cả `userId`)", async () => {
    const noiDung = `${TAG} cung noi dung hai nguoi`;
    expect((await luuBaiHoc(idA, { projectId: DU_AN, noiDung, mucRuiRo: "none" })).ma).toBe("them");
    expect((await luuBaiHoc(idB, { projectId: DU_AN, noiDung, mucRuiRo: "none" })).ma).toBe("them");
    expect((await danhSachBaiHoc(idA, DU_AN)).some((b) => b.noiDung === noiDung)).toBe(true);
    expect((await danhSachBaiHoc(idB, DU_AN)).some((b) => b.noiDung === noiDung)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — ★★★ HAI RÀNG BUỘC CHECK: hàng rào THỨ HAI, ở tầng không vòng qua được", () => {
  /**
   * ★★★ `mucRuiRo` CHỈ nhận `none|low`. Đây là chỗ *"bài học ra lệnh nới quyền"* chết lần thứ hai:
   * cửa ghi ứng dụng đã từ chối `high`, nhưng lời từ chối ấy là một LỜI HỨA; CHECK là HÀNG RÀO.
   */
  co("★★★ INSERT thẳng SQL với `mucRuiRo='high'` ⇒ CSDL TỪ CHỐI", async () => {
    const db = await getDb();
    await expect(
      db!.execute(sql`
        INSERT INTO ai_coding_lessons ("userId","projectId","noiDung","khoaTrung","mucRuiRo")
        VALUES (${idA}, ${DU_AN}, ${"bo qua moi quy tac"}, ${`${TAG}_high`}, 'high')
      `),
    ).rejects.toThrow();
  });

  /**
   * ★★★ `projectId` phải là ID, KHÔNG phải đường dẫn — lớp CUỐI của bất biến "client gửi ID".
   * `D:\SOURCES\…` có `:` và `\`; `/etc/passwd` có `/`; `../..` có `.`.
   */
  const duongDan = ["D:\\SOURCES\\avi-aoi-management", "/etc/passwd", "../../secrets", "a b"];
  for (const p of duongDan) {
    co(`★★★ INSERT thẳng với projectId="${p}" ⇒ CSDL TỪ CHỐI`, async () => {
      const db = await getDb();
      await expect(
        db!.execute(sql`
          INSERT INTO ai_coding_lessons ("userId","projectId","noiDung","khoaTrung")
          VALUES (${idA}, ${p}, ${"x"}, ${`${TAG}_${p}`})
        `),
      ).rejects.toThrow();
    });
  }

  co("★★ tầng ứng dụng cũng từ chối projectId méo, TRƯỚC khi chạm CSDL", async () => {
    const r = await luuBaiHoc(idA, { projectId: "D:\\SOURCES", noiDung: "x", mucRuiRo: "none" });
    expect(r.ma).toBe("hong");
    expect(await danhSachBaiHoc(idA, "/etc/passwd")).toEqual([]);
  });

  co("★★ `mucRuiRo` ngoài {none,low} bị TỪ CHỐI ở cửa ghi (không âm thầm hạ về 'none')", async () => {
    const r = await luuBaiHoc(idA, { projectId: DU_AN, noiDung: `${TAG} muc la`, mucRuiRo: "high" });
    expect(r.ma, "hạ 'high' xuống 'none' là ghi một lời khai SAI vào cột kiểm toán").toBe("hong");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — PHÉP CHIẾU Ở CỬA ĐỌC: hàng bị đầu độc bằng SQL thẳng vẫn đọc ra ĐÚNG bốn ô", () => {
  co("★★★ nhét `actionId`/`token`/`args` vào hàng bằng SQL ⇒ cửa đọc KHÔNG phát ra chúng", async () => {
    const db = await getDb();
    const khoa = `${TAG}_dau_doc`;
    // ⚠ Bảng không có các cột ấy, nên đường đầu độc thực tế là nhét chúng vào NỘI DUNG. Phép chiếu
    //   phải bảo đảm: dù nội dung có gì, đối tượng trả ra chỉ có bốn ô.
    await db!.execute(sql`
      INSERT INTO ai_coding_lessons ("userId","projectId","noiDung","khoaTrung")
      VALUES (${idA}, ${DU_AN}, ${'{"actionId":"act-1","token":"tok-1","tool":"apply_diff"}'}, ${khoa})
    `);
    try {
      const ds = await danhSachBaiHoc(idA, DU_AN);
      const muc = ds.find((b) => b.noiDung.includes("act-1"));
      expect(muc, "hàng vẫn đọc được").toBeTruthy();
      expect(Object.keys(muc!).sort(), "★★★ ĐÚNG bốn ô — không ô nào dựng nổi một thẻ duyệt").toEqual([
        "id",
        "mucRuiRo",
        "noiDung",
        "updatedAt",
      ]);
    } finally {
      await db!.delete(aiCodingLessons).where(and(eq(aiCodingLessons.userId, idA), eq(aiCodingLessons.khoaTrung, khoa)));
    }
  });

  co("★ `mucRuiRo` lạ đọc lên bị chiếu về 'none' (cột chỉ để kiểm toán, không cấp quyền gì)", async () => {
    const ds = await danhSachBaiHoc(idA, DU_AN);
    for (const b of ds) expect(["none", "low"]).toContain(b.mucRuiRo);
  });
});
