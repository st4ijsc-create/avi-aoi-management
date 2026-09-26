/**
 * ★★★ **PHẠM VI của CỔNG ẢNH trên CSDL THẬT — âm ĐỐI XỨNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CHẠM CSDL THẬT, VÀ VÌ SAO PHẢI DỰNG **HAI** NHÀ MÁY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `machineIdsTrongPhamVi` chạy chuỗi `machines → stations → production_lines → workshops` bằng SQL
 * thô có bí danh. Một lưới giả lập `getDb` **không phát biểu được** `42P01` (bí danh sai) hay
 * `42809` (khuôn ANY-mảng-JS) — chỉ Postgres nói được.
 *
 * ⚠⚠ Và trên `aoi_management(_test)` **mọi** máy có sẵn đều thuộc nhà máy 1, nên chiều ÂM *"A
 * không thấy ảnh của B"* là **KHÔNG ĐO ĐƯỢC** ở đó: một ca "chặn" chạy trên tập một-nhà-máy sẽ
 * xanh dù cổng có tồn tại hay không. Đây đúng là lớp lỗi **"lượng từ TỰ THOẢ"** đã ghi trong sổ
 * tay repo. Nên lượt này dựng HAI cây phân cấp rời nhau.
 *
 * ⚠⚠ **ÂM ĐỐI XỨNG là bắt buộc.** Mỗi ca chặn có ca sinh đôi ở chiều ngược (B xem được của B).
 * Không có nó thì một bản vá hỏng kiểu *"luôn trả về nhà máy của A"* — hoặc tệ hơn, *"chặn tất
 * cả"* — vẫn XANH ở mọi ca chặn.
 *
 * ⚠ §ĐỘT BIẾN ở cuối file là điều kiện để mọi ca trên có nghĩa: nó tái dựng **chính xác** hình
 * dạng lỗi cũ (cổng trả `null` = "không lọc") và đòi các ca chặn ĐỎ trở lại.
 *
 * ⚠ DỌN DẸP: `product_inspections` là bảng **WORM** (`avi_app` bị thu hồi DELETE, mig 0224/0279)
 * và có FK `ON DELETE RESTRICT` tới `machines`. Nên có LỐI DỌN THỨ HAI: xoá mềm cả chuỗi. Mọi
 * phép đếm bám vào tiền tố `RUN` duy nhất, không bao giờ vào số tuyệt đối của bảng.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import {
  machineIdsChoLoiVao,
  mayTrongPhamViAnh,
  phamViDaApAnh,
  sanPhamTrongPhamViAnh,
  xoaNhoDemPhamViAnh,
  type LoiVaoAnh,
} from "./_congAnh";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `CGA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`;

const FAC_A = `${RUN}_FA`.slice(0, 50);
const FAC_B = `${RUN}_FB`.slice(0, 50);
const SN_A = `${RUN}_SNA`.slice(0, 50);
const SN_B = `${RUN}_SNB`.slice(0, 50);

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0, wsA: 0, wsB: 0, lnA: 0, lnB: 0, stA: 0, stB: 0, mcA: 0, mcB: 0,
  pmA: 0, pmB: 0, uAdmin: 0, uA: 0, uB: 0, uNone: 0,
};

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* xem §DỌN DẸP */ }
}

/** Lối vào "người dùng" — thứ duy nhất có cổng phạm vi. */
const nguoiDung = (userId: number, userRole = "engineer"): LoiVaoAnh =>
  ({ kieu: "nguoiDung", userId, userRole });

/**
 * ⚠ Nhớ đệm phải bị xoá ở CẢ HAI tầng trước mỗi phép đo: `_congAnh` giữ 30 giây theo
 * `userId:userRole`, còn `accessControl.getUserAssignmentCodes` giữ 30 giây theo `userId`. Quên
 * một trong hai ⇒ ca sau đọc phạm vi của ca trước, và lưới sẽ "xanh" vì một lý do chẳng liên quan.
 */
async function xoaMoiNhoDem(): Promise<void> {
  xoaNhoDemPhamViAnh();
  const { clearAssignmentCache } = await import("../_core/accessControl");
  clearAssignmentCache();
}

describe.skipIf(!DB_URL)("cổng ảnh — phạm vi nhà máy, âm ĐỐI XỨNG trên CSDL thật", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL as string, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const dungNhaMay = async (n: { fac: string; sn: string }) => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${n.fac}, ${n.fac}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f!.id}, ${n.fac + "W"}, ${n.fac + "W"}) RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w!.id}, ${n.fac + "L"}, ${n.fac + "L"}, 100) RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l!.id}, ${n.fac + "S"}, ${n.fac + "S"}) RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s!.id}, ${n.fac + "M"}, ${n.fac + "M"}, 'AOI') RETURNING id`;
      const [pm] = await sql`INSERT INTO product_models (code, name) VALUES (${n.fac + "PM"}, ${n.fac + "PM"}) RETURNING id`;
      // Sản phẩm nối vào nhà máy qua đường `product_machine_mappings` (một trong ba đường hợp).
      await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId") VALUES (${pm!.id}, ${m!.id})`;
      await sql`
        INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
        VALUES (${m!.id}, ${n.sn}, 'NG', 'NG', NOW() - INTERVAL '1 hour', ${n.fac})`;
      return { f: f!.id as number, w: w!.id as number, l: l!.id as number, s: s!.id as number, m: m!.id as number, pm: pm!.id as number };
    };

    const a = await dungNhaMay({ fac: FAC_A, sn: SN_A });
    const b = await dungNhaMay({ fac: FAC_B, sn: SN_B });
    ids.facA = a.f; ids.wsA = a.w; ids.lnA = a.l; ids.stA = a.s; ids.mcA = a.m; ids.pmA = a.pm;
    ids.facB = b.f; ids.wsB = b.w; ids.lnB = b.l; ids.stB = b.s; ids.mcB = b.m; ids.pmB = b.pm;

    const mkUser = async (username: string, role: string): Promise<number> => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`cga-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r!.id as number;
    };
    ids.uAdmin = await mkUser(`cga-admin-${RUN}`, "admin");
    ids.uA = await mkUser(`cga-eng-a-${RUN}`, "engineer");
    ids.uB = await mkUser(`cga-eng-b-${RUN}`, "engineer");
    ids.uNone = await mkUser(`cga-none-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uA}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uB}, ${FAC_B})`;

    await xoaMoiNhoDem();
  });

  afterAll(async () => {
    try {
      const users = [ids.uAdmin, ids.uA, ids.uB, ids.uNone].filter(Boolean);
      if (users.length) {
        await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
        await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
      }
      for (const s of [SN_A, SN_B]) await safe(() => sql`DELETE FROM product_inspections WHERE "serialNumber" = ${s}`);
      for (const m of [ids.mcA, ids.mcB]) if (m) await safe(() => sql`DELETE FROM product_machine_mappings WHERE "machineId" = ${m}`);
      for (const p of [ids.pmA, ids.pmB]) if (p) await safe(() => sql`DELETE FROM product_models WHERE id = ${p}`);
      // Lối dọn 1: xoá mềm (luôn chạy được kể cả khi WORM chặn xoá cứng phía dưới).
      for (const m of [ids.mcA, ids.mcB]) if (m) await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id = ${m}`);
      for (const s of [ids.stA, ids.stB]) if (s) await safe(() => sql`UPDATE stations SET "isActive" = false WHERE id = ${s}`);
      for (const l of [ids.lnA, ids.lnB]) if (l) await safe(() => sql`UPDATE production_lines SET "isActive" = false WHERE id = ${l}`);
      for (const w of [ids.wsA, ids.wsB]) if (w) await safe(() => sql`UPDATE workshops SET "isActive" = false WHERE id = ${w}`);
      for (const f of [ids.facA, ids.facB]) if (f) await safe(() => sql`UPDATE factories SET "isActive" = false WHERE id = ${f}`);
      // Lối dọn 2: xoá cứng khi WORM cho phép.
      for (const m of [ids.mcA, ids.mcB]) if (m) await safe(() => sql`DELETE FROM machines WHERE id = ${m}`);
      for (const s of [ids.stA, ids.stB]) if (s) await safe(() => sql`DELETE FROM stations WHERE id = ${s}`);
      for (const l of [ids.lnA, ids.lnB]) if (l) await safe(() => sql`DELETE FROM production_lines WHERE id = ${l}`);
      for (const w of [ids.wsA, ids.wsB]) if (w) await safe(() => sql`DELETE FROM workshops WHERE id = ${w}`);
      for (const f of [ids.facA, ids.facB]) if (f) await safe(() => sql`DELETE FROM factories WHERE id = ${f}`);
    } finally {
      await safe(() => sql.end({ timeout: 5 }));
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §1 — MÁY: âm ĐỐI XỨNG (bốn ô của một bảng 2×2, không phải hai ô)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§1 — A không xem được ảnh của B, VÀ B xem được ảnh của riêng B", async () => {
    await xoaMoiNhoDem();

    // Chiều ÂM — đây là lỗ đang được đóng.
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), ids.mcB)).toBe(false);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uB), ids.mcA)).toBe(false);

    // Chiều DƯƠNG — chống "vá quá tay thành chặn tất cả".
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), ids.mcA)).toBe(true);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uB), ids.mcB)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§2 — tài khoản KHÔNG được gán nhà máy: phạm vi RỖNG, không phải 'không lọc'", async () => {
    await xoaMoiNhoDem();
    // ⚠ Phân biệt `[]` (rỗng) với `null` (toàn quyền) là toàn bộ vấn đề: lỗi `DENY_ALL_ROWS` đã ghi
    //   trong repo là một `or()` trả `undefined` ⇒ 4 tài khoản 0-gán đọc 22.996/22.996 bản ghi.
    expect(await machineIdsChoLoiVao(nguoiDung(ids.uNone))).toEqual([]);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uNone), ids.mcA)).toBe(false);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uNone), ids.mcB)).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§3 — admin: `null` = KHÔNG áp cổng nào (chiều dương, chống vá quá tay)", async () => {
    await xoaMoiNhoDem();
    expect(await machineIdsChoLoiVao(nguoiDung(ids.uAdmin, "admin"))).toBeNull();
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uAdmin, "admin"), ids.mcA)).toBe(true);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uAdmin, "admin"), ids.mcB)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§4 — lối vào VÉ KÝ và MASTER KEY không áp cổng, và `scopeApplied` khai đúng sự thật", async () => {
    await xoaMoiNhoDem();
    for (const lv of [{ kieu: "chuKy" } as const, { kieu: "toanCuc" } as const]) {
      expect(await machineIdsChoLoiVao(lv)).toBeNull();
      expect(await mayTrongPhamViAnh(lv, ids.mcA)).toBe(true);
      expect(await mayTrongPhamViAnh(lv, ids.mcB)).toBe(true);
      // ⚠ BOOLEAN `false`, KHÔNG phải nhãn `no_factory_assignment`: hai lối này là một VÉ và một
      //   KHOÁ, không phải một TÀI KHOẢN chưa được gán nhà máy. Gắn nhãn ấy ở đây là khai SAI.
      expect(phamViDaApAnh(lv)).toBe(false);
    }
    expect(phamViDaApAnh(nguoiDung(ids.uA))).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§5 — `machineId` NULL ⇒ TỪ CHỐI (fail-closed), kể cả với tài khoản có phạm vi", async () => {
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), null)).toBe(false);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), undefined)).toBe(false);
    await xoaMoiNhoDem();
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), Number.NaN)).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §6 — SẢN PHẨM: trục KHÁC HẲN, vì `product_models` KHÔNG có cột nhà máy
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§6 — sản phẩm: A không xem được sản phẩm của B, VÀ B xem được của riêng B", async () => {
    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uA), ids.pmB)).toBe(false);
    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uB), ids.pmA)).toBe(false);

    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uA), ids.pmA)).toBe(true);
    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uB), ids.pmB)).toBe(true);

    // Phạm vi rỗng ⇒ từ chối; toàn quyền ⇒ cho qua.
    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uNone), ids.pmA)).toBe(false);
    await xoaMoiNhoDem();
    expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uAdmin, "admin"), ids.pmB)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §ĐỘT BIẾN — điều kiện để mọi ca trên có nghĩa
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§ĐỘT BIẾN — cổng trả `null` (hình dạng lỗi CŨ) ⇒ mọi ca chặn phải sập", async () => {
    // Tái dựng CHÍNH XÁC lỗ cũ: handler phân giải được danh tính rồi **vứt đi**, tức cổng phạm vi
    // báo "không có gì phải lọc". Nếu các ca §1/§2/§6 vẫn xanh dưới hình dạng này thì chúng đang
    // đo một thứ khác chứ không phải cái cổng.
    const hier = await import("../db/hierarchy");
    const that = hier.machineIdsTrongPhamVi;
    const spy = vi.spyOn(hier, "machineIdsTrongPhamVi").mockResolvedValue(null);
    try {
      await xoaMoiNhoDem();
      expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), ids.mcB)).toBe(true); // ⇐ lỗ mở lại
      await xoaMoiNhoDem();
      expect(await mayTrongPhamViAnh(nguoiDung(ids.uNone), ids.mcA)).toBe(true);
      await xoaMoiNhoDem();
      expect(await sanPhamTrongPhamViAnh(nguoiDung(ids.uA), ids.pmB)).toBe(true);
    } finally {
      spy.mockRestore();
      expect(hier.machineIdsTrongPhamVi).toBe(that);
      await xoaMoiNhoDem();
    }

    // …và sau khi gỡ đột biến, cổng phải chặn TRỞ LẠI. Không có phép khẳng định này thì §ĐỘT BIẾN
    // chỉ chứng minh "mock hoạt động", chứ không chứng minh cổng còn sống.
    expect(await mayTrongPhamViAnh(nguoiDung(ids.uA), ids.mcB)).toBe(false);
  });
});
