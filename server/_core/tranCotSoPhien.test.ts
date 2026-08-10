/**
 * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-2** — **KHÔNG HEADER NÀO ĐÚC ĐƯỢC MỘT PHIÊN KHÔNG THU HỒI ĐƯỢC.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ cột `varchar(n)` của `user_sessions`: giá trị ghi vào bị cắt về đúng `n` — trần SUY TỪ
 * SCHEMA, không từ một danh sách viết tay — nên KHÔNG lượt `INSERT` nào hỏng vì độ dài.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRÊN MÁY CHỦ SỐNG (PID 37600, mã trước bản vá) — KHÔNG PHẢI SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     login (`User-Agent` **3.770** ký tự)  ⇒ HTTP 200  {"success":true,"user":{"id":51,…}}
 *     select id from user_sessions where id > 290       ⇒ **(0 rows)**   ← KHÔNG CÓ HÀNG SỔ
 *     auth.logout                            ⇒ HTTP 200 {"success":true} ← "ĐĂNG XUẤT THÀNH CÔNG"
 *     auth.me                                ⇒ HTTP 200 {"id":51,…}      ← **VẪN ĐỦ HỒ SƠ**
 * Biến duy nhất đổi so với lượt đối chứng (phiên CÓ hàng sổ ⇒ `auth.me` = `null`) là **độ dài
 * header `User-Agent`** — dữ liệu **KẺ TẤN CÔNG** đặt tuỳ ý.
 *
 * Cơ chế, đo lại độc lập trên PostgreSQL thật (giao dịch tạm, bảng TEMP, đã `ROLLBACK`):
 *     INSERT INTO t_probe(x varchar(255)) VALUES (repeat('x',300))
 *     ⇒ ERROR: value too long for type character varying(255)
 * Và `information_schema` của **cả hai** DB xác nhận `deviceName varchar(255)` · `ipAddress
 * varchar(45)` · `sessionToken text` (mig 0317 đã áp).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BA LỚP CHỐNG "TỰ THOẢ"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **§1 TRẦN SUY TỪ SCHEMA** — nếu bộ suy trần trả rỗng, mọi ô dưới thành chân lý rỗng ⇒ ô cầu
 *     chì đo lại chính nó và neo vào hai cột ĐO ĐƯỢC (`deviceName` 255 · `ipAddress` 45).
 *  2. **§2 HÀNH VI trên DB THẬT** — §1 chỉ nói *"phép cắt có hình dạng đúng"*. §2 gọi `ghiSoPhien`
 *     với **UA dài THẬT (3.770 ký tự)** trên `aoi_management_test` và đọc lại hàng sổ. Một chuỗi
 *     ngắn ở đây làm ca **xanh vô nghĩa** — đó chính là cách ca 300-ký-tự cũ bị dời đi mà không ai
 *     hỏi cột kế bên có trần không.
 *  3. **§4 NGƯỜI GHI DUY NHẤT** — ∀ điểm `.insert(userSessions)` trong `server/**` phải đi qua
 *     `catTheoTranCot`. Một người ghi **THỨ HAI** ở một file chưa tồn tại tự vào lượng từ (M3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Cắt là **chuẩn hoá**, không phải kiểm tra. Nó đóng lớp lỗi `22001`; nó **không** đóng các
 *     nguyên nhân khác của một lượt ghi sổ hỏng (mất kết nối, quyền bị thu, bảng đổi hình dạng).
 *     Nửa ấy do bộ đếm `soPhien_ghiSoLoi_total` canh — nay có bề mặt Prometheus (§3).
 *  2. `deviceName` vẫn là `varchar(255)`: đổi sang `text` là **DDL**, cần chủ dự án duyệt
 *     (`drizzle/0318_session_device_name_text.sql.DRAFT`). Phép cắt ở đây **không phụ thuộc** vào
 *     lượt DDL ấy — nó đọc trần từ schema, nên khi cột thành `text` thì cột ấy tự rời tập bị cắt.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import { catTheoTranCot, catChuoi, tranVarcharCua } from "../db/catTheoTranCot";
import { ghiSoPhien } from "./authService";
import {
  demLoiGhiSoPhien,
  datLaiDemLoiGhiSoPhien,
  renderSoPhienPrometheus,
} from "./demSoPhien";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "p8c2-tran-cot";
/** Độ dài header `User-Agent` của lượt đo sống. **Dùng đúng số này**, không dùng một chuỗi ngắn. */
const DAI_THAT = 3770;
const UA_DAI = "Mozilla/5.0 (".concat("A".repeat(DAI_THAT - 13));

const TRAN = tranVarcharCua(userSessions);

describe("★★★★ Review TOÀN NHÁNH Pha 8 C-2 — ∀ cột varchar của `user_sessions`: cắt theo trần SCHEMA", () => {
  /* ── §1 TRẦN SUY TỪ SCHEMA ─────────────────────────────────────────────────────────────────── */
  it("§1a cầu chì — bộ suy trần KHÔNG rỗng và khớp hai cột ĐO ĐƯỢC trên cả hai DB", () => {
    expect(
      Object.keys(TRAN).length,
      "0 cột có trần ⇒ phép cắt là no-op và MỌI ô dưới đây là chân lý rỗng",
    ).toBeGreaterThanOrEqual(6);
    expect(TRAN.deviceName, "`deviceName` — cột nạp thẳng từ header `User-Agent`").toBe(255);
    expect(TRAN.ipAddress, "`ipAddress` — cột thứ hai của cùng câu INSERT").toBe(45);
  });

  it("★★★ §1b `sessionToken` KHÔNG BAO GIỜ nằm trong tập bị cắt (cắt KHOÁ PHIÊN = tái tạo C-2)", () => {
    expect(
      Object.keys(TRAN),
      "`sessionToken` bị cắt ⇒ hàng sổ không bao giờ khớp cookie ⇒ đúng lỗ C-2, im lặng hơn",
    ).not.toContain("sessionToken");
    const token = "t".repeat(4000);
    expect(
      (catTheoTranCot(userSessions, { sessionToken: token }) as { sessionToken: string }).sessionToken,
      "khoá phiên bị chạm",
    ).toBe(token);
  });

  it("§1c ĐỘT BIẾN TỔNG HỢP — mọi cột có trần đều bị cắt về ĐÚNG trần, không cột nào sót", () => {
    const vao: Record<string, unknown> = { userId: 1, expiresAt: new Date(), sessionToken: "x" };
    for (const ten of Object.keys(TRAN)) vao[ten] = "z".repeat(5000);
    const ra = catTheoTranCot(userSessions, vao) as Record<string, unknown>;
    const sai = Object.entries(TRAN).filter(([ten, n]) => (ra[ten] as string).length !== n);
    expect(sai.map(([t]) => t), "cột có trần mà KHÔNG bị cắt về đúng trần").toEqual([]);
  });

  it("§1d ĐỐI CHỨNG DƯƠNG — chuỗi ngắn hơn trần đi qua NGUYÊN VẸN (không cắt bừa)", () => {
    const ra = catTheoTranCot(userSessions, { deviceName: "curl/8.7.1", ipAddress: "127.0.0.1" });
    expect(ra.deviceName, "cắt nhầm một UA bình thường ⇒ lưới này sẽ bị người sau tắt đi").toBe("curl/8.7.1");
    expect(ra.ipAddress).toBe("127.0.0.1");
  });

  it("§1e cặp thay thế KHÔNG bị chẻ đôi ở đuôi (không đẩy `U+FFFD` xuống DB)", () => {
    // "😀" = một cặp thay thế = 2 đơn vị UTF-16. Cắt ở 5 rơi đúng vào giữa cặp thứ ba.
    const s = "😀😀😀";
    const cat = catChuoi(s, 5);
    expect(cat.length, "cắt ở giữa cặp thay thế phải lùi lại một đơn vị").toBe(4);
    expect(/[\uD800-\uDBFF]$/.test(cat), "còn nửa CAO lẻ ở đuôi").toBe(false);
  });

  /* ── §2 HÀNH VI trên DB THẬT ───────────────────────────────────────────────────────────────── */
  describe("§2 hành vi SỐNG — đường ghi sổ THẬT với UA dài THẬT", () => {
    let uid = 0;

    beforeAll(async () => {
      uid = (
        await db.createLocalUser({
          username: `${DAU}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
          name: "Review Pha 8 C-2 — trần cột sổ phiên",
          role: "user",
        })
      ).id;
    });

    afterAll(async () => {
      const d = await db.getDb();
      if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
      if (uid) await db.deleteUser(uid);
    });

    it("★★★★ §2a `ghiSoPhien` với `User-Agent` 3.770 ký tự ⇒ VẪN CÓ hàng `user_sessions`", async () => {
      expect(uid).toBeGreaterThan(0);
      // Cầu chì: chuỗi phải DÀI THẬT — một chuỗi ngắn làm ô này xanh vô nghĩa.
      expect(UA_DAI.length, "UA phải dài đúng bằng lượt đo sống").toBe(DAI_THAT);
      expect(UA_DAI.length, "UA phải vượt trần cột").toBeGreaterThan(TRAN.deviceName!);

      const token = `${DAU}-ua-dai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      datLaiDemLoiGhiSoPhien();
      const id = await ghiSoPhien({
        userId: uid,
        sessionToken: token,
        ipAddress: "9".repeat(200), // cột thứ hai của cùng câu INSERT — cũng phải qua
        deviceName: UA_DAI,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      expect(
        id,
        "lượt ghi sổ HỎNG ⇒ phiên này vô hình với `session.list` và NGOÀI TẦM mọi đường thu hồi",
      ).not.toBeNull();
      expect(demLoiGhiSoPhien(), "bộ đếm lỗi ghi sổ nhích ⇒ lượt INSERT vẫn vỡ").toBe(0);

      const d = await db.getDb();
      const [hang] = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(hang, "không có hàng sổ ⇒ đúng lỗ C-2").toBeTruthy();
      expect(hang!.deviceName!.length, "`deviceName` phải được cắt về đúng trần").toBe(TRAN.deviceName);
      expect(hang!.ipAddress!.length, "`ipAddress` phải được cắt về đúng trần").toBe(TRAN.ipAddress);
      expect(hang!.sessionToken, "KHOÁ PHIÊN phải nguyên vẹn — hàng phải khớp cookie").toBe(token);
    });

    it("★★★ §2b hàng ấy THU HỒI ĐƯỢC (đó mới là thứ lỗ C-2 lấy đi)", async () => {
      const token = `${DAU}-thuhoi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await ghiSoPhien({
        userId: uid,
        sessionToken: token,
        deviceName: UA_DAI,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const truoc = await db.getSessionByToken(token);
      expect(truoc, "cầu chì: phải có hàng để thu hồi").toBeTruthy();

      await db.thuHoiPhienTheoToken(token);

      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      let loi: string | null = null;
      try {
        await chanNeuPhienDaThuHoi(token);
      } catch (err) {
        loi = String((err as Error)?.message ?? err);
      }
      expect(loi, "phiên đúc bằng một UA dài vẫn KHÔNG thu hồi được ⇒ C-2 chưa đóng").not.toBeNull();
    });
  });

  /* ── §3 BỀ MẶT QUAN SÁT ĐƯỢC — "không im lặng trong lưới" ≠ "không im lặng trong sản xuất" ─── */
  it("★★★ §3 hai bộ đếm sổ phiên có mặt trong kết xuất Prometheus (đường vá 3 của C-2)", () => {
    const ra = renderSoPhienPrometheus();
    for (const ten of ["soPhien_ghiSoLoi_total", "soPhien_chanDaThuHoi_total"]) {
      expect(ra, `bộ đếm \`${ten}\` không có mặt ⇒ sản xuất vẫn im lặng`).toContain(`${ten} `);
      expect(ra, `\`${ten}\` thiếu dòng TYPE ⇒ scraper Prometheus bỏ qua`).toContain(`# TYPE ${ten} counter`);
    }
  });

  it("★★★ §3b bề mặt ấy được MỘT TUYẾN THẬT phát ra (bộ đếm đúng mà không ai đọc thì vẫn im lặng)", () => {
    const ma = readFileSync(join(GOC, "server", "routes", "observabilityRoutes.ts"), "utf8");
    expect(
      ma.includes("renderSoPhienPrometheus"),
      "`GET /api/observability/metrics` không còn phát bộ đếm sổ phiên ⇒ đường vá 3 của C-2 đã rụng",
    ).toBe(true);
  });

  /* ── §4 NGƯỜI GHI DUY NHẤT — ∀, suy từ ĐĨA + AST ───────────────────────────────────────────── */
  /**
   * Mọi điểm `.insert(userSessions)` trong một nguồn, kèm câu trả lời *"lượt `.values(...)` của nó
   * có đi qua `catTheoTranCot` không"*.
   */
  function diemGhiSoPhien(duong: string, ma: string): { dong: number; catTran: boolean }[] {
    const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
    const ra: { dong: number; catTran: boolean }[] = [];
    const tenGoi = (n: ts.CallExpression): string =>
      ts.isPropertyAccessExpression(n.expression)
        ? n.expression.name.text
        : ts.isIdentifier(n.expression)
          ? n.expression.text
          : "";
    const di = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        tenGoi(n) === "insert" &&
        n.arguments.length === 1 &&
        ts.isIdentifier(n.arguments[0]!) &&
        (n.arguments[0] as ts.Identifier).text === "userSessions"
      ) {
        // `.values(...)` treo ngay trên lượt `.insert(...)`.
        let catTran = false;
        const p = n.parent;
        if (p !== undefined && ts.isPropertyAccessExpression(p) && p.name.text === "values") {
          const goi = p.parent;
          if (goi !== undefined && ts.isCallExpression(goi)) {
            const tim = (x: ts.Node): void => {
              if (catTran) return;
              if (ts.isCallExpression(x) && tenGoi(x) === "catTheoTranCot") {
                catTran = true;
                return;
              }
              x.forEachChild(tim);
            };
            goi.arguments.forEach(tim);
          }
        }
        ra.push({ dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, catTran });
      }
      n.forEachChild(di);
    };
    di(sf);
    return ra;
  }

  const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts"]).filter((f) => !laFileTest(f.duong));
  const MOI_DIEM_GHI = MOI_FILE_SX.flatMap((f) => {
    const ma = readFileSync(f.that, "utf8");
    if (!ma.includes("userSessions")) return [];
    return diemGhiSoPhien(f.duong, ma).map((d) => ({ ...d, duong: f.duong }));
  });

  it("§4a cầu chì — bộ suy THẤY người ghi thật (0 điểm ⇒ ô ∀ dưới là chân lý rỗng)", () => {
    expect(MOI_FILE_SX.length, "phạm vi quét đã hỏng").toBeGreaterThanOrEqual(500);
    expect(
      MOI_DIEM_GHI.length,
      "0 điểm `.insert(userSessions)` trong mã sản xuất — bộ suy đang mù với repo",
    ).toBeGreaterThanOrEqual(1);
  });

  it("★★★★ §4b ∀ điểm ghi `user_sessions` trong `server/**`: PHẢI đi qua `catTheoTranCot`", () => {
    expect(
      MOI_DIEM_GHI.filter((d) => !d.catTran).map((d) => `${d.duong}:${d.dong}`),
      [
        "Một lượt ghi `user_sessions` KHÔNG cắt giá trị theo trần cột.",
        "Một chuỗi dài (header `User-Agent` — dữ liệu KẺ TẤN CÔNG) làm lượt INSERT vỡ với `22001`;",
        "`ghiSoPhien` nuốt lỗi ⇒ phiên ấy KHÔNG có hàng sổ ⇒ vô hình với `session.list` và NGOÀI TẦM",
        "`session.revoke` / `revokeAll` / `auth.logout`, sống tới `exp` (đo được: 2027).",
        "⇒ Bọc giá trị bằng `catTheoTranCot(userSessions, …)` (trần SUY TỪ SCHEMA, không viết tay).",
      ].join("\n"),
    ).toEqual([]);
  });

  it("★★★★ §4c M3 — người ghi THỨ HAI trong FILE CHƯA TỒN TẠI vẫn bị bắt", () => {
    const ma = `
      import { userSessions } from "../../drizzle/schema";
      export async function ghiThem(d: any, data: any) {
        return d.insert(userSessions).values(data).returning({ id: userSessions.id });
      }`;
    const diem = diemGhiSoPhien("server/db/nguoiGhiThuHaiN1.ts", ma);
    expect(diem.length, "người ghi mới rơi khỏi lượng từ ⇒ bộ suy mù với file mới").toBe(1);
    expect(diem[0]!.catTran, "người ghi mới KHÔNG cắt trần mà lưới vẫn xanh ⇒ lưới canh theo FILE").toBe(false);

    // …và ĐỐI CHỨNG DƯƠNG: cùng file mới ấy, có cắt ⇒ được tha.
    const maKin = ma.replace(".values(data)", ".values(catTheoTranCot(userSessions, data))");
    expect(diemGhiSoPhien("server/db/nguoiGhiThuHaiN1.ts", maKin)[0]!.catTran).toBe(true);
  });
});
