/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — **"AI ĐỌC ĐƯỢC PHIÊN CỦA AI", ĐO TRÊN CSDL THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY PHẢI CHẠM CSDL THẬT, KHÔNG DÙNG `db` GIẢ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thứ đang được canh là một **mệnh đề WHERE**. Một `db` giả trả về mảng do chính lưới nạp vào ⇒
 * `eq(userId)` có mặt hay không **không đổi kết quả** ⇒ đột biến "bỏ hàng rào" sống sót và lưới
 * vẫn xanh. Đó đúng khuôn *"xanh vì lý do sai"* mà repo này đã trả giá nhiều lần. Nên ở đây:
 * hai TÀI KHOẢN thật, hàng thật, và phép hỏi đi qua **đúng tuyến tRPC** người dùng dùng.
 *
 * ⚠ ĐỘT BIẾN PHẢI BẮT ĐƯỢC (đã chạy, xem báo cáo): bỏ `eq(aiCodingSessions.userId, userId)` khỏi
 *   `moPhien`/`danhSachPhien`/`xoaPhien` ở `server/db/aiCodingSessions.ts` ⇒ §1/§2/§3 ĐỎ.
 *
 * ⚠ Dọn dẹp GIỚI HẠN theo hàng CHÍNH FILE NÀY tạo (`openId` mang tiền tố + dấu thời gian), theo
 *   đúng bất biến của `server/_core/xoaHangKhongGioiHanTrongTest.test.ts`: vitest chạy song song
 *   trên MỘT CSDL test, một lượt xoá rộng ở đây sẽ giết hàng của file khác.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

/**
 * ⚠ `LICENSE_MODULE_GATE_ENABLED=false`: `repoWorkspaceRouter` đứng sau `moduleGate("MOD_AI")`,
 *   **chạy TRƯỚC** cổng quyền `ai_repo_read`. Để nguyên thì §2 ("thiếu quyền ⇒ PERMISSION_DENIED")
 *   sẽ **XANH VÌ LÝ DO SAI** — bị chặn bởi license chứ không bởi RBAC. Tắt nó ⇒ biến duy nhất còn
 *   lại là cổng QUYỀN. (Cùng lý lẽ đã ghi ở `vramPermissionSplit.test.ts`.)
 *   `AUDIT_ALL_MUTATIONS=false`: bỏ middleware kiểm toán ghi DB fire-and-forget của mọi mutation.
 */
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { getDb } from "../db/connection";
import { users, permissions, aiCodingSessions } from "../../drizzle/schema";
import { repoWorkspaceRouter } from "./repoWorkspaceRouter";

const TAG = `aics_${Date.now()}`;
const DU_AN = "repo"; // luôn có trong danh sách trắng (mặc định `gocHopCat()` khi env vắng)

let idA = 0;
let idB = 0;
let idKhongQuyen = 0;
let idAdmin = 0;
let coDb = false;

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;
const caller = (id: number, role = "engineer") => repoWorkspaceRouter.createCaller(ctxFor(id, role));

async function mkUser(tag: string, role: "engineer" | "admin", capQuyen: boolean): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `phien ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  if (capQuyen) {
    await db!.insert(permissions).values({
      userId: u!.id,
      category: "settings",
      moduleName: "ai_repo_read",
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
    });
  }
  return u!.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idA = await mkUser("a", "engineer", true);
  idB = await mkUser("b", "engineer", true);
  idKhongQuyen = await mkUser("noperm", "engineer", false);
  idAdmin = await mkUser("admin", "admin", false); // admin: checkPermission short-circuit
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ids = [idA, idB, idKhongQuyen, idAdmin].filter((x) => x > 0);
  if (ids.length === 0) return;
  // GIỚI HẠN theo đúng id file này tạo — xem khối ⚠ ở đầu file.
  await db.delete(aiCodingSessions).where(inArray(aiCodingSessions.userId, ids));
  await db.delete(permissions).where(inArray(permissions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
});

/** Tạo một phiên qua ĐÚNG tuyến người dùng dùng, trả id. */
async function taoPhien(uid: number, noiDung: string): Promise<string> {
  const r = await caller(uid).luuPhien({
    projectId: DU_AN,
    sessionId: null,
    turns: [{ role: "user", content: noiDung }, { role: "assistant", content: "ok" }],
  });
  expect(r.ok, `tạo phiên cho ${uid} phải thành công`).toBe(true);
  return r.id!;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — KỸ SƯ A KHÔNG ĐỌC ĐƯỢC PHIÊN CỦA KỸ SƯ B", () => {
  it("★★★ B mở phiên của A ⇒ NOT_FOUND (không nội dung, không siêu dữ liệu)", async () => {
    if (!coDb) return;
    const cuaA = await taoPhien(idA, "bí mật của A: đọc server/routers.ts");

    // Chiều thuận — chính chủ đọc được (nếu không, ca âm dưới đây tự thoả).
    const tuA = await caller(idA).moPhien({ sessionId: cuaA });
    expect(tuA.ok).toBe(true);
    expect(tuA.session?.turns?.[0]?.content).toBe("bí mật của A: đọc server/routers.ts");

    // Chiều nghịch — đây là ô phải ĐỎ khi hàng rào bị gỡ.
    const tuB = await caller(idB).moPhien({ sessionId: cuaA });
    expect(tuB.ok).toBe(false);
    expect(tuB.note).toBe("NOT_FOUND");
    expect(tuB.session).toBeNull();
  });

  it("★★★ ADMIN cũng KHÔNG đọc được phiên của A (phạm vi là CHỦ SỞ HỮU, không phải vai)", async () => {
    if (!coDb) return;
    const cuaA = await taoPhien(idA, "phiên riêng của A");
    const tuAdmin = await caller(idAdmin, "admin").moPhien({ sessionId: cuaA });
    expect(tuAdmin.ok).toBe(false);
    expect(tuAdmin.session).toBeNull();
  });

  it("★★ danh sách của B KHÔNG chứa phiên nào của A", async () => {
    if (!coDb) return;
    const cuaA = await taoPhien(idA, "A lượt danh sách");
    const cuaB = await taoPhien(idB, "B lượt danh sách");

    const dsA = await caller(idA).danhSachPhien({ projectId: DU_AN });
    const dsB = await caller(idB).danhSachPhien({ projectId: DU_AN });
    expect(dsA.sessions.map((s) => s.id)).toContain(cuaA);
    expect(dsA.sessions.map((s) => s.id)).not.toContain(cuaB);
    expect(dsB.sessions.map((s) => s.id)).toContain(cuaB);
    expect(dsB.sessions.map((s) => s.id)).not.toContain(cuaA);
  });

  it("★★ B KHÔNG xoá được phiên của A, và KHÔNG ghi đè được nó", async () => {
    if (!coDb) return;
    const cuaA = await taoPhien(idA, "A không được mất phiên này");

    const xoa = await caller(idB).xoaPhien({ sessionId: cuaA });
    expect(xoa.ok).toBe(false);

    const ghiDe = await caller(idB).luuPhien({
      projectId: DU_AN,
      sessionId: cuaA,
      turns: [{ role: "user", content: "B ghi đè" }],
    });
    expect(ghiDe.ok).toBe(false);

    // Bằng chứng hàng CÒN NGUYÊN — không tin lời khai `ok:false`, đọc lại nội dung thật.
    const doclai = await caller(idA).moPhien({ sessionId: cuaA });
    expect(doclai.session?.turns?.[0]?.content).toBe("A không được mất phiên này");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — RBAC: PHIÊN KHÔNG MỞ QUYỀN MỚI (`ai_repo_read/canView`)", () => {
  it("★★ tài khoản THIẾU `ai_repo_read` ⇒ PERMISSION_DENIED ở cả bốn tuyến", async () => {
    if (!coDb) return;
    const c = caller(idKhongQuyen);
    const ds = await c.danhSachPhien({ projectId: DU_AN });
    expect(ds.ok).toBe(false);
    expect(ds.note).toBe("PERMISSION_DENIED");
    expect(ds.sessions).toEqual([]);

    const luu = await c.luuPhien({ projectId: DU_AN, sessionId: null, turns: [{ role: "user", content: "x" }] });
    expect(luu.note).toBe("PERMISSION_DENIED");
    expect(luu.id).toBeNull();

    const mo = await c.moPhien({ sessionId: "00000000-0000-4000-8000-000000000000" });
    expect(mo.note).toBe("PERMISSION_DENIED");

    const xoa = await c.xoaPhien({ sessionId: "00000000-0000-4000-8000-000000000000" });
    expect(xoa.note).toBe("PERMISSION_DENIED");
  });

  it("★ và tài khoản thiếu quyền KHÔNG để lại một hàng nào (chặn TRƯỚC khi chạm CSDL)", async () => {
    if (!coDb) return;
    const db = await getDb();
    const con = await db!
      .select({ id: aiCodingSessions.id })
      .from(aiCodingSessions)
      .where(eq(aiCodingSessions.userId, idKhongQuyen));
    expect(con).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — PHIÊN MANG **ID DỰ ÁN**, KHÔNG BAO GIỜ ĐƯỜNG DẪN", () => {
  it("★★★ gửi ĐƯỜNG DẪN làm projectId ⇒ tuyến TỪ CHỐI (zod chặn ở cửa)", async () => {
    if (!coDb) return;
    for (const duong of ["D:\\SOURCES\\avi-aoi-management", "/etc/passwd", "../..", "sandbox-projects/csharp-demo"]) {
      await expect(
        caller(idA).luuPhien({ projectId: duong, sessionId: null, turns: [{ role: "user", content: "x" }] }),
        `projectId "${duong}" phải bị từ chối`,
      ).rejects.toThrow();
    }
  });

  it("★★ id ĐÚNG HÌNH DẠNG nhưng KHÔNG trong danh sách trắng ⇒ PROJECT_NOT_FOUND", async () => {
    if (!coDb) return;
    // Hình dạng hợp lệ ⇒ qua zod; `phanGiaiGoc` mới là cửa phán quyết (fail-closed).
    const r = await caller(idA).luuPhien({
      projectId: "khongTonTaiTrongDanhSachTrang",
      sessionId: null,
      turns: [{ role: "user", content: "x" }],
    });
    expect(r.note).toBe("PROJECT_NOT_FOUND");
    expect(r.id).toBeNull();
  });

  it("★★★ CSDL TỪ CHỐI một đường dẫn ngay cả khi vòng qua tRPC (CHECK của mig 0333)", async () => {
    if (!coDb) return;
    const db = await getDb();
    // Đây là lớp CUỐI: một cửa ghi thứ hai (hoặc `INSERT` tay) cũng không lưu được đường dẫn.
    await expect(
      db!.insert(aiCodingSessions).values({
        userId: idA,
        projectId: "D:\\SOURCES\\avi-aoi-management",
        title: "vòng qua tRPC",
        turns: [{ role: "user", content: "x" }],
        turnCount: 1,
      }),
    ).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — NẠP LẠI MỘT PHIÊN **KHÔNG BAO GIỜ** PHÁT RA MỘT THẺ DUYỆT HITL", () => {
  it("★★★ hàng bị ĐẦU ĐỘC bằng SQL thẳng (nhét actionId/token) ⇒ đọc ra vẫn chỉ {role, content}", async () => {
    if (!coDb) return;
    const db = await getDb();
    // Ghi THẲNG vào CSDL, vòng qua `locLuot` ở cửa ghi — mô phỏng: một cửa ghi thứ hai ngày mai,
    // một bản khôi phục CSDL cũ, hoặc một lượt sửa tay. Đây chính là ca "thẻ duyệt CŨ nạp lại".
    const [row] = await db!
      .insert(aiCodingSessions)
      .values({
        userId: idA,
        projectId: DU_AN,
        title: "phiên đã bị đầu độc",
        turns: [
          {
            role: "assistant",
            content: "Đề xuất SỬA tệp",
            actionId: "11111111-1111-4111-8111-111111111111",
            token: "11111111-1111-4111-8111-111111111111",
            tool: "apply_diff",
            args: { path: "src/Calculator.cs", original: "CŨ", modified: "MỚI" },
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        turnCount: 1,
      })
      .returning({ id: aiCodingSessions.id });

    const doc = await caller(idA).moPhien({ sessionId: String(row!.id) });
    expect(doc.ok).toBe(true);
    const luot = doc.session!.turns[0] as unknown as Record<string, unknown>;
    expect(Object.keys(luot).sort()).toEqual(["content", "role"]);
    // Nêu đích danh từng ô: một phép so `toEqual` có thể xanh vì một lý do khác.
    for (const k of ["actionId", "token", "tool", "args", "expiresAt"]) {
      expect(Object.prototype.hasOwnProperty.call(luot, k), `ô "${k}" lọt ra client`).toBe(false);
    }
    // Và **toàn bộ chuỗi JSON trả về** không được chứa băm/token nào — chống ô lồng bị bỏ sót.
    expect(JSON.stringify(doc.session)).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("★★ và cửa GHI qua tRPC từ chối thẳng một lượt mang ô thẻ duyệt (zod .strict())", async () => {
    if (!coDb) return;
    await expect(
      caller(idA).luuPhien({
        projectId: DU_AN,
        sessionId: null,
        // Ép kiểu vì đúng ra TypeScript đã chặn — lưới đo hàng rào LÚC CHẠY, không lúc biên dịch.
        turns: [{ role: "user", content: "x", actionId: "y", token: "z" }] as never,
      }),
    ).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — LUỸ ĐẲNG + NHÃN TỰ SINH (không ai phải đặt tên phiên)", () => {
  it("★ lưu lại cùng sessionId ⇒ CẬP NHẬT, không đẻ hàng thứ hai", async () => {
    if (!coDb) return;
    const db = await getDb();
    const id = await taoPhien(idB, "câu hỏi đầu tiên của B");
    await caller(idB).luuPhien({
      projectId: DU_AN,
      sessionId: id,
      turns: [
        { role: "user", content: "câu hỏi đầu tiên của B" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "lượt thứ hai" },
      ],
    });
    const hang = await db!
      .select({ id: aiCodingSessions.id, title: aiCodingSessions.title, n: aiCodingSessions.turnCount })
      .from(aiCodingSessions)
      .where(and(eq(aiCodingSessions.id, id), eq(aiCodingSessions.userId, idB)));
    expect(hang).toHaveLength(1);
    expect(hang[0]!.n).toBe(3);
    // Nhãn suy từ câu hỏi ĐẦU, do SERVER đặt — client không gửi ô `title` nào.
    expect(hang[0]!.title).toBe("câu hỏi đầu tiên của B");
  });

  it("★ phiên RỖNG không đẻ ra hàng nào (nút 'Phiên mới' không chạm CSDL)", async () => {
    if (!coDb) return;
    const r = await caller(idB).luuPhien({ projectId: DU_AN, sessionId: null, turns: [] });
    expect(r.ok).toBe(false);
    expect(r.id).toBeNull();
  });
});
