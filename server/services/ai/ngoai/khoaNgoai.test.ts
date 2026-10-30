/**
 * ★ Đợt 10.3 Task 7 — khoá AI ngoài theo nhà máy: thủ tục `aiNgoai.*` (caller tRPC thật, CSDL `_test` thật) + thunk giải mã chỉ khi
 * gọi + KHÔNG LỘ khoá ở mọi đường ra (đầu ra tRPC, sổ, audit, log, lỗi). Khoá giả SINH lúc chạy.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-khoa-ngoai-0123456789abcdef";
});

const h = vi.hoisted(() => ({ cho: null as number[] | null, auditHong: false }));
vi.mock("../../flow/phamViLuong", async (goc) => {
  const that = await goc<typeof import("../../flow/phamViLuong")>();
  return { ...that, nhaMayChoPhep: vi.fn(async (pv: never) => (h.cho !== null ? h.cho : that.nhaMayChoPhep(pv))) };
});
vi.mock("../../auditTrailService", async (goc) => {
  const that = await goc<typeof import("../../auditTrailService")>();
  return {
    ...that,
    logCrudOperationInTx: vi.fn(async (...a: Parameters<typeof that.logCrudOperationInTx>) => {
      if (h.auditHong) throw new Error("audit hỏng");
      return that.logCrudOperationInTx(...a);
    }),
  };
});

import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiNgoaiRouter } from "../../../routers/aiNgoaiRouter";
import { aiSettingsRouter } from "../../../routers/aiSettingsRouter";
import { layKhoaChoNhaCungCap } from "./khoaNgoai";
import { goiAiNgoai, phuThuocMacDinh, type PhuThuocCong } from "./congNgoai";
import { TU_DIEN_RONG } from "./cheDuLieu";
import { taoNhaCungCapGia } from "./nhaCungCap/gia";
import { LoiNgoai } from "./loi";
import { ghepPhan } from "./ghepPhan";

const TIN_X = ghepPhan([{ vaiTro: "user", phan: [{ loai: "cau-go-lap-trinh", noiDung: "x" }] }]).tinNhan;

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));
const TAG = `kn${Date.now().toString(36)}`;
const KHOA = "sk-ant-api03-" + "Z".repeat(95);
const KHOA_MOI = "sk-ant-api03-" + "Y".repeat(95);
const ADMIN = { user: { id: 990_777, role: "admin", name: "khoa-ngoai" } } as never;
let A = 0;
let B = 0;
const db = async () => (await getDb()) as never;

beforeAll(async () => {
  [A, B] = await Promise.all(["a", "b"].map(async (x) => Number((await exec(sql`INSERT INTO factories (code, name) VALUES (${`${TAG}${x}`}, ${"NM"}) RETURNING id`))[0]!.id)));
});
afterAll(async () => {
  for (const f of [A, B].filter(Boolean)) {
    await exec(sql`DELETE FROM ai_ngoai_model WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_nha_may WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_api_keys WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_dem WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_dem_phut WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
});

const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiNgoai ? e.ma : ((e as { code?: string }).code ?? String(e));
  }
};

describe("khoá theo nhà máy", () => {
  it("taoKhoa: lưu enc:v1, trả cuoi4; dsKhoa chỉ cuoi4; thunk: đúng nhà máy ⇒ khoá, nhà máy khác ⇒ lỗi; xoay ⇒ khoá mới; thu hồi ⇒ lỗi", async () => {
    const goi = aiNgoaiRouter.createCaller(ADMIN);
    const tao = await goi.taoKhoa({ factoryId: A, nhaCungCap: "anthropic", ten: `${TAG}-k`, khoa: KHOA });
    expect(tao).toEqual({ id: expect.any(Number), cuoi4: "ZZZZ" });
    const [r] = await exec(sql`SELECT "encryptedKey", status, "factoryId" FROM ai_api_keys WHERE id = ${tao.id}`);
    expect(String(r!.encryptedKey)).toMatch(/^enc:v1:/);
    expect(String(r!.encryptedKey)).not.toContain("ZZZZ");
    const ds = await goi.dsKhoa({ factoryId: A });
    expect(ds).toEqual([{ id: tao.id, ten: `${TAG}-k`, nhaCungCap: "anthropic", status: "active", cuoi4: "ZZZZ", capNhatLuc: expect.any(Date) }]);

    expect(await layKhoaChoNhaCungCap(await db(), tao.id, A)()).toBe(KHOA);
    expect(await maLoi(layKhoaChoNhaCungCap(await db(), tao.id, B)())).toBe("NGOAI_KHOA_KHONG_HOP_LE");
    const thunk = layKhoaChoNhaCungCap(await db(), tao.id, A);
    await goi.xoayKhoa({ id: tao.id, khoa: KHOA_MOI });
    expect(await thunk()).toBe(KHOA_MOI); // đọc TƯƠI mỗi lần
    await goi.thuHoiKhoa({ id: tao.id });
    expect(await maLoi(thunk())).toBe("NGOAI_KHOA_KHONG_HOP_LE");
  });

  it("khoá legacy (không phải enc:v1) ⇒ từ chối; khoá không tồn tại ⇒ NOT_FOUND ở thủ tục", async () => {
    const [k] = await exec(sql`INSERT INTO ai_api_keys (name, provider, "encryptedKey", status, "createdBy", "factoryId")
      VALUES (${`${TAG}-legacy`}, 'openai', ${Buffer.from("plain-legacy-key").toString("base64")}, 'active', 1, ${A}) RETURNING id`);
    expect(await maLoi(layKhoaChoNhaCungCap(await db(), Number(k!.id), A)())).toBe("NGOAI_KHOA_KHONG_HOP_LE");
    expect(await maLoi(aiNgoaiRouter.createCaller(ADMIN).thuHoiKhoa({ id: 2_000_000_000 }))).toBe("NOT_FOUND");
  });
});

describe("khoaKhongLo — khoá không xuất hiện ở bất kỳ đường ra nào", () => {
  it("tRPC, sổ, audit, console, lỗi ném ra (message / cause / stack / mọi thuộc tính) ⇒ 0 lần", async () => {
    const goi = aiNgoaiRouter.createCaller(ADMIN);
    const log: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void log.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})))).join(" "))),
    );
    try {
      const tao = await goi.taoKhoa({ factoryId: B, nhaCungCap: "anthropic", ten: `${TAG}-kl`, khoa: KHOA });
      await exec(sql`INSERT INTO ai_ngoai_nha_may ("factoryId", "batNgoai", "tranLanPhut") VALUES (${B}, true, 600) ON CONFLICT DO NOTHING`);
      await exec(sql`INSERT INTO ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId", "tranTokenLuot", "batModel") VALUES (${B}, 'anthropic', 'm', 'M', ${tao.id}, 100000, true)`);
      const ra: unknown[] = [tao, await goi.dsKhoa({ factoryId: B }), await aiSettingsRouter.createCaller(ADMIN).listApiKeys()];
      const dep: PhuThuocCong = {
        ...phuThuocMacDinh,
        env: () => ({ AI_NGOAI_ENABLED: "true" }),
        layTuDien: async () => TU_DIEN_RONG,
        layNhaCungCap: () => gia,
      };
      // lượt 1: thành công (nhà cung cấp nhận khoá qua thunk); lượt 2: lỗi NHẮC LẠI khoá + khoá trong cause/stack
      const gia = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
      const ngu = { userId: 7, flowId: null, runId: null, tuDong: false, nhaMayNguoiGoi: null, nhaMayChuDuLieu: [B], nguonMuc: { loai: "be-mat" as const, beMat: "chat" as const, phanDaGhep: [] } };
      ra.push(await goiAiNgoai({ dich: { nhaCungCap: "anthropic", model: "m" }, tinNhan: TIN_X, maxTokens: 10, mucDich: "t", ngu }, dep));
      expect(gia.nhan[0]!.khoa).toBe(KHOA);
      const giaLoi = {
        ...gia,
        async goi(_yc: unknown, layKhoa: () => Promise<string>) {
          const k = await layKhoa();
          const e = new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `401 invalid x-api-key ${k}`);
          (e as { cause?: unknown }).cause = new Error(`header x-api-key: ${k}`);
          throw e;
        },
      };
      let loi: unknown;
      try {
        await goiAiNgoai({ dich: { nhaCungCap: "anthropic", model: "m" }, tinNhan: TIN_X, maxTokens: 10, mucDich: "t", ngu }, { ...dep, layNhaCungCap: () => giaLoi as never });
      } catch (e) {
        loi = e;
      }
      expect(loi).toBeInstanceOf(LoiNgoai);
      ra.push(JSON.stringify(loi, Object.getOwnPropertyNames(loi)), String((loi as Error).stack));
      ra.push(await exec(sql`SELECT * FROM ai_external_calls WHERE "factoryId" = ${B}`));
      ra.push(await exec(sql`SELECT details FROM audit_logs WHERE "entityType" = 'ai_ngoai_khoa' AND "entityId" = ${tao.id}`));
      const tatCa = JSON.stringify(ra) + log.join("\n");
      for (const manh of [KHOA, KHOA.slice(13, 60), "Z".repeat(40)]) expect(tatCa).not.toContain(manh);
      expect((await exec(sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'ai_ngoai_khoa' AND "entityId" = ${tao.id}`))[0]!.n).toBe(1);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("rà kiem-dinh Task 7 (F1–F4)", () => {
  it("F1: người gọi phạm vi {A} ⇒ MỌI thủ tục khoá (cũ + mới) trên nhà máy / khoá của B ⇒ NOT_FOUND", async () => {
    const kB = await aiNgoaiRouter.createCaller(ADMIN).taoKhoa({ factoryId: B, nhaCungCap: "openai", ten: `${TAG}-B`, khoa: KHOA });
    h.cho = [A];
    try {
      const ngoai = aiNgoaiRouter.createCaller(ADMIN);
      const cu = aiSettingsRouter.createCaller(ADMIN);
      const ma = async (p: Promise<unknown>) => ((await maLoi(p)) as string);
      expect(await ma(ngoai.taoKhoa({ factoryId: B, nhaCungCap: "openai", ten: "x", khoa: KHOA }))).toBe("NOT_FOUND");
      expect(await ma(ngoai.xoayKhoa({ id: kB.id, khoa: KHOA_MOI }))).toBe("NOT_FOUND");
      expect(await ma(ngoai.thuHoiKhoa({ id: kB.id }))).toBe("NOT_FOUND");
      expect(await ma(ngoai.dsKhoa({ factoryId: B }))).toBe("NOT_FOUND");
      expect(await ma(cu.createApiKey({ name: "x", provider: "openai", apiKey: KHOA, factoryId: B }))).toBe("NOT_FOUND");
      expect(await ma(cu.toggleApiKey({ id: kB.id }))).toBe("NOT_FOUND");
      expect(await ma(cu.deleteApiKey({ id: kB.id }))).toBe("NOT_FOUND");
      expect(await ma(cu.testApiKey({ id: kB.id }))).toBe("NOT_FOUND");
      expect((await cu.listApiKeys()).some((k: { id: number }) => k.id === kB.id)).toBe(false);
      const [r] = await exec(sql`SELECT status FROM ai_api_keys WHERE id = ${kB.id}`);
      expect(r!.status).toBe("active");
    } finally {
      h.cho = null;
    }
  });

  it("F2: khoá ngắn (< 20 ký tự) ⇒ không lộ đuôi ('••••'), audit ghi độ dài", async () => {
    const t = await aiNgoaiRouter.createCaller(ADMIN).taoKhoa({ factoryId: A, nhaCungCap: "openai", ten: `${TAG}-ngan`, khoa: "vllm1234" });
    expect(t.cuoi4).toBe("••••");
    const [a] = await exec(sql`SELECT details FROM audit_logs WHERE "entityType" = 'ai_ngoai_khoa' AND "entityId" = ${t.id}`);
    expect(String(a!.details)).not.toContain("1234");
    expect(String(a!.details)).toContain('"doDai":8');
  });

  it("F3: endpoint lưu — scheme lạ / userinfo / metadata / nội bộ chưa khai ⇒ BAD_REQUEST; công cộng https và nội bộ ĐÃ khai ⇒ được", async () => {
    const goi = aiNgoaiRouter.createCaller(ADMIN);
    const tao = (endpoint: string) => goi.taoKhoa({ factoryId: A, nhaCungCap: "openai_compat", ten: `${TAG}-ep`, khoa: KHOA, endpoint });
    for (const e of ["file:///etc/passwd", "ftp://x.com", "https://user:pw@api.x.com/v1", "https://169.254.169.254/v1", "https://[fe80::1]/v1", "http://llm.local:8000/v1", "http://api.public.com/v1", "https://api.x.com/v1?key=abc"]) {
      expect(await maLoi(tao(e)), e).toBe("BAD_REQUEST");
    }
    await exec(sql`INSERT INTO ai_ngoai_host_noi_bo ("factoryId", "hostCong") VALUES (${A}, 'llm.local:8000') ON CONFLICT DO NOTHING`);
    try {
      expect(await maLoi(tao("http://LLM.local.:8000/v1"))).toBeNull();
      expect(await maLoi(tao("https://api.groq.example/v1"))).toBeNull();
      const [r] = await exec(sql`SELECT endpoint FROM ai_api_keys WHERE "factoryId" = ${A} AND name = ${`${TAG}-ep`} ORDER BY id LIMIT 1`);
      expect(r!.endpoint).toBe("http://llm.local:8000/v1");
    } finally {
      await exec(sql`DELETE FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${A}`);
    }
  });

  it("F4: audit ghi lỗi ⇒ thay đổi khoá ROLLBACK (tạo không còn hàng, xoay giữ khoá cũ, thu hồi giữ active)", async () => {
    const goi = aiNgoaiRouter.createCaller(ADMIN);
    const k = await goi.taoKhoa({ factoryId: A, nhaCungCap: "anthropic", ten: `${TAG}-au`, khoa: KHOA });
    h.auditHong = true;
    try {
      expect(await maLoi(goi.taoKhoa({ factoryId: A, nhaCungCap: "anthropic", ten: `${TAG}-au2`, khoa: KHOA }))).not.toBeNull();
      expect(await maLoi(goi.xoayKhoa({ id: k.id, khoa: KHOA_MOI }))).not.toBeNull();
      expect(await maLoi(goi.thuHoiKhoa({ id: k.id }))).not.toBeNull();
    } finally {
      h.auditHong = false;
    }
    expect((await exec(sql`SELECT count(*)::int AS n FROM ai_api_keys WHERE name = ${`${TAG}-au2`}`))[0]!.n).toBe(0);
    expect(await layKhoaChoNhaCungCap(await db(), k.id, A)()).toBe(KHOA);
  });

  it("F5: thunk đòi đúng nhà cung cấp của khoá", async () => {
    const k = await aiNgoaiRouter.createCaller(ADMIN).taoKhoa({ factoryId: A, nhaCungCap: "openai", ten: `${TAG}-ncc`, khoa: KHOA });
    expect(await maLoi(layKhoaChoNhaCungCap(await db(), k.id, A, "anthropic")())).toBe("NGOAI_KHOA_KHONG_HOP_LE");
    expect(await layKhoaChoNhaCungCap(await db(), k.id, A, "openai")()).toBe(KHOA);
  });
});
