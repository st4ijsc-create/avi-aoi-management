/**
 * ★★★ Pha 7 / migration `0316` — **NEO HAI CHIỀU GIỮA HAI NGUỒN CỦA CÙNG MỘT KHÁI NIỆM.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — `0316` ĐỔI **MỘT LỖ** LẤY **MỘT LỖ** NẾU KHÔNG CÓ NÓ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước `0316`, tập *"phương thức được công nhận là xác thực nội bộ"* có **một** chủ:
 * `shared/xacThucNoiBo.ts::PHUONG_THUC_XAC_THUC_NOI_BO`. Migration `0316` chốt cùng khái niệm ấy
 * **lần thứ hai**, bằng plpgsql, trong thân hàm `kiem_xac_thuc_noi_bo()`:
 *
 *     noi_bo CONSTANT text[] := ARRAY['local','password'];
 *
 * Hai bản sao của một khái niệm là **chính xác** cơ chế đã đẻ ra phần tử thứ N+1 **mười bảy lần**
 * trong chuỗi pha này. Và ở đây nó hỏng theo **cả hai chiều, mỗi chiều một kiểu**:
 *
 *   · **TS có, DB thiếu** ⇒ mã sản xuất công nhận `'password'`, trigger thì **không** ⇒ lượt ghi
 *     hợp lệ bị ném `check_violation`. Đường đăng nhập/đổi mật khẩu **gãy tại DB**, và `tsc` xanh.
 *   · **DB có, TS thiếu** ⇒ trigger cho một hàng đi qua, còn `laXacThucNoiBo()` trả `false` ⇒
 *     **đúng nhà tù I-4 quay lại**, lần này với một hàng mà ràng buộc DB đã **chúc phúc**.
 *
 * ⇒ Không chiều nào tự lộ ra. Nên lưới này **đọc định nghĩa hàm TỪ DB ĐANG CHẠY**
 *   (`pg_get_functiondef`) — không đọc file `.sql`, vì file trên đĩa chỉ chứng minh **ý định**,
 *   còn thứ cưỡng chế lượt ghi lúc 3 giờ sáng là **hàm đã nạp trong DB**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO KHÔNG HỎI ĐÍCH DANH `kiem_xac_thuc_noi_bo` — LƯỚI THEO **TÊN** LÀ LƯỚI THEO DANH SÁCH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lưới ghim đúng một tên hàm sẽ **mù** với hàm canh thứ hai mà migration `0317` thêm vào — và
 * đó đúng là lớp lỗi *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"*. Nên §1 hỏi theo **KHÁI NIỆM**:
 * ***mọi*** hàm plpgsql trong `public` mà thân nhắc tới `loginMethod`. Hàm canh thứ hai tự rơi vào
 * lượng từ; nó mang một tập khác ⇒ **ĐỎ**, không cần ai nhớ đếm lại.
 *
 * ⚠ **FAIL-CLOSED, KHÔNG `skip`.** Không có DB, hay không tìm thấy hàm nào ⇒ **ĐỎ**. Một lưới tự
 *   bỏ qua mình là *"glob rỗng"* ở dạng khác: nó khai XANH đúng lúc nó không đo gì cả — lớp lỗi đã
 *   tái diễn **sáu lần**. Ô "cầu chì" dưới đây tồn tại chỉ để điều đó không xảy ra lặng lẽ.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PHUONG_THUC_XAC_THUC_NOI_BO } from "@shared/xacThucNoiBo";

/** Một hàm plpgsql có nhắc `loginMethod`, kèm định nghĩa đầy đủ do chính DB in ra. */
interface HamCanh {
  ten: string;
  dinhNghia: string;
}

/**
 * Rút tập chuỗi trong **literal `ARRAY[…]`** của một định nghĩa hàm.
 *
 * ⚠ Cố ý **không** rút mọi chuỗi trong thân hàm: câu `RAISE` chứa `'<NULL>'` và cả câu tiếng Việt,
 *   rút bừa thì tập luôn lệch và ô này thành nhiễu vĩnh viễn. Chỉ `ARRAY[…]` mới là **nơi khái
 *   niệm được khai**. Nếu một ngày hàm viết lại bằng `IN ('local','password')` thì bộ rút trả rỗng
 *   ⇒ cầu chì §1 ĐỎ ⇒ người sửa buộc phải dạy lại lưới này, thay vì lưới lặng lẽ thành chân lý rỗng.
 */
function rutTapArray(dinhNghia: string): string[] {
  const tap = new Set<string>();
  for (const khoi of dinhNghia.matchAll(/ARRAY\s*\[([^\]]*)\]/gi)) {
    for (const chuoi of (khoi[1] ?? "").matchAll(/'([^']*)'/g)) tap.add(chuoi[1] as string);
  }
  return [...tap].sort();
}

let hamCanh: HamCanh[] = [];
let loiKetNoi: string | null = null;

beforeAll(async () => {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) {
      loiKetNoi = "getDb() trả null — chưa dựng DB test? (`node scripts/setup-test-db.mjs`)";
      return;
    }
    const { sql } = await import("drizzle-orm");
    /**
     * ⚠⚠ `AS MATERIALIZED` **KHÔNG** phải trang trí — bỏ nó đi thì câu này NÉM, đo được:
     *
     *     ERROR:  "array_agg" is an aggregate function
     *
     * Bộ lập kế hoạch đẩy vị từ `pg_get_functiondef(p.oid) LIKE …` **xuống dưới** phép quét
     * `pg_proc`, tức chạy TRƯỚC phép lọc `lanname='plpgsql'`, nên nó gọi hàm ấy trên **mọi** hàng
     * — kể cả hàm gộp, thứ mà `pg_get_functiondef` từ chối theo cấu tạo. CTE materialized ghim
     * thứ tự: lọc trước, in định nghĩa sau.
     *
     * ⚠ Lọc bằng `prosrc` (thân thô) chứ không bằng `pg_get_functiondef` vì cùng lý do ấy.
     */
    const rows = await db.execute(sql`
      WITH ung_vien AS MATERIALIZED (
        SELECT p.oid, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosrc LIKE '%loginMethod%'
      )
      SELECT proname AS ten, pg_get_functiondef(oid) AS dinh_nghia
      FROM ung_vien ORDER BY proname
    `);
    hamCanh = (rows as unknown as Array<{ ten: string; dinh_nghia: string }>).map((r) => ({
      ten: r.ten,
      dinhNghia: r.dinh_nghia,
    }));
  } catch (e) {
    loiKetNoi = e instanceof Error ? e.message : String(e);
  }
});

describe("★★★ 0316 §1 — cầu chì: hàm canh PHẢI đọc được TỪ DB ĐANG CHẠY", () => {
  it("★★★ có DB, và migration 0316 ĐÃ ÁP (0 hàm ⇒ ĐỎ, không phải 'không có gì để kiểm')", () => {
    expect(
      loiKetNoi,
      `không đọc được định nghĩa hàm từ DB ⇒ ô này KHÔNG được im lặng bỏ qua: bất biến của 0316 ` +
        `chỉ tồn tại ở tầng DB.\n  Chi tiết: ${loiKetNoi}`,
    ).toBeNull();
    expect(
      hamCanh.length,
      "không thấy hàm plpgsql nào nhắc `loginMethod` ⇒ migration `drizzle/0316_loginmethod_noi_bo_guard.sql` " +
        "CHƯA ÁP lên DB này (áp bằng owner `aoi`, CẢ HAI DB), hoặc ai đó đã DROP nó.\n" +
        "⚠ Nếu để ô này xanh khi hàm vắng mặt thì mọi ô dưới là CHÂN LÝ RỖNG.",
    ).toBeGreaterThan(0);
  });

  it("★★★ mỗi hàm canh phải khai tập nội bộ bằng literal `ARRAY[…]` (rút được, không rỗng)", () => {
    expect(loiKetNoi).toBeNull();
    for (const h of hamCanh) {
      expect(
        rutTapArray(h.dinhNghia).length,
        `hàm \`${h.ten}\` nhắc \`loginMethod\` nhưng không rút được \`ARRAY[…]\` nào.\n` +
          "⇒ Khái niệm đã được viết bằng một hình dạng khác (vd `IN (…)`) mà bộ rút không thấy.\n" +
          "  ĐỪNG nới bộ rút cho xanh: hãy dạy nó hình dạng mới, nếu không lưới thành chân lý rỗng.",
      ).toBeGreaterThan(0);
    }
  });
});

describe("★★★ 0316 §2 — NEO HAI CHIỀU: tập của DB ≡ `PHUONG_THUC_XAC_THUC_NOI_BO`", () => {
  it("★★★ chiều A — ∀ phần tử hằng TS ⇒ PHẢI có trong hàm DB (thiếu ⇒ lượt ghi HỢP LỆ bị trigger ném)", () => {
    expect(loiKetNoi).toBeNull();
    expect(hamCanh.length).toBeGreaterThan(0);
    const ts = [...PHUONG_THUC_XAC_THUC_NOI_BO].sort();
    for (const h of hamCanh) {
      const db = rutTapArray(h.dinhNghia);
      const thieuODb = ts.filter((v) => !db.includes(v));
      expect(
        thieuODb,
        `hàm \`${h.ten}\` THIẾU ${JSON.stringify(thieuODb)} so với \`PHUONG_THUC_XAC_THUC_NOI_BO\`.\n` +
          `  TS: ${JSON.stringify(ts)}\n  DB: ${JSON.stringify(db)}\n` +
          "⇒ Mã sản xuất công nhận phương thức ấy là nội bộ, nhưng trigger thì KHÔNG ⇒ một lượt ghi\n" +
          "  hợp lệ sẽ ném `check_violation` LÚC CHẠY, trong khi `tsc` vẫn xanh.\n" +
          "  Sửa: một migration mới `CREATE OR REPLACE FUNCTION` cho khớp, áp lên CẢ HAI DB.",
      ).toEqual([]);
    }
  });

  it("★★★ chiều B — ∀ phần tử hàm DB ⇒ PHẢI có trong hằng TS (thừa ⇒ nhà tù I-4 QUAY LẠI)", () => {
    expect(loiKetNoi).toBeNull();
    expect(hamCanh.length).toBeGreaterThan(0);
    const ts = [...PHUONG_THUC_XAC_THUC_NOI_BO].sort();
    for (const h of hamCanh) {
      const db = rutTapArray(h.dinhNghia);
      const thieuOTs = db.filter((v) => !ts.includes(v));
      expect(
        thieuOTs,
        `hàm \`${h.ten}\` CHO PHÉP ${JSON.stringify(thieuOTs)} mà \`PHUONG_THUC_XAC_THUC_NOI_BO\` không công nhận.\n` +
          `  TS: ${JSON.stringify(ts)}\n  DB: ${JSON.stringify(db)}\n` +
          "⇒ Trigger chúc phúc cho hàng ấy, còn `laXacThucNoiBo()` trả `false` ⇒ chủ tài khoản KHÔNG\n" +
          "  đổi được mật khẩu: ĐÚNG nhà tù I-4, lần này có ràng buộc DB đứng ra bảo lãnh.\n" +
          "  Sửa: thêm phần tử vào `shared/xacThucNoiBo.ts` (và `server/_core/xacThucNoiBo.test.ts` §2\n" +
          "  sẽ đòi một MÃ SẢN XUẤT THẬT ghi ra giá trị ấy — không tự khai được).",
      ).toEqual([]);
    }
  });

  it("★★ đối chứng — bộ rút THẬT SỰ phân biệt được, không phải hàm nào cũng 'khớp'", () => {
    // Nếu `rutTapArray` trả rỗng cho mọi đầu vào thì hai ô trên là chân lý rỗng theo cấu tạo.
    expect(rutTapArray("x ARRAY['local','password'] y")).toEqual(["local", "password"]);
    expect(rutTapArray("noi_bo CONSTANT text[] := ARRAY['local'];")).toEqual(["local"]);
    expect(rutTapArray("RAISE 'không có mảng nào ở đây'")).toEqual([]);
  });
});
