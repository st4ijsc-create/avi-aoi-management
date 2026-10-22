/**
 * ★ Đợt 9 — tác nhân theo VAI TRÒ, ĐẦU–CUỐI phía server (thiết kế 2026-10-22 §3, lưới i/iii/iv + cờ tắt): lõi agent THẬT, bộ
 * thực thi THẬT, sổ `ai_agent_runs` THẬT (CSDL `_test`). Model: `taoGoiModelMayChu` bị thay để GHI `modelId` engine nhận được.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import type { GoiModel, ManhModel, SuKienAgent, WireToolCall } from "@shared/agentCore";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { RateLimitError, type GatewayPlan, type GatewayRequest } from "../../aiGateway";
import type { AnhSoModel } from "../soModel/anhSoModel";
import { getDb } from "../../../db/connection";
import { docHangLuotChay } from "../../../db/aiAgentRuns";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";
import { _xoaNhoDuAnPlc } from "./nhanDienDuAnPlc";

const h = vi.hoisted(() => ({
  modelNhan: [] as Array<string | undefined>,
  kichBan: [] as Array<{ chu?: string; toolCalls?: unknown[] }>,
  soLuotGoi: 0,
  cauNguoiDung: [] as string[],
}));
vi.mock("./goiModelMayChu", () => ({
  taoGoiModelMayChu: (cauHinh: { modelId?: string } = {}) => {
    h.modelNhan.push(cauHinh.modelId);
    let i = 0;
    return async function* (vao: { tinNhan: Array<{ role: string; content: string }> }): AsyncGenerator<ManhModel> {
      h.soLuotGoi++;
      h.cauNguoiDung.push(vao.tinNhan.filter((m) => m.role === "user").at(-1)?.content ?? "");
      const b = h.kichBan[Math.min(i++, h.kichBan.length - 1)]!;
      if (b.chu) yield { loai: "chu", noiDung: b.chu };
      yield { loai: "xong", toolCalls: (b.toolCalls ?? []) as WireToolCall[], usage: { vao: 1000, ra: 40, nghi: 5 } };
    } as GoiModel;
  },
}));

import { taoQuanLyLuotChay } from "./quanLyLuotChay";

const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const M27 = "Qwen3.6-27B-UD-Q4_K_XL";
const ENV = {
  GGUF_CODE_MODEL: `${M35}.gguf`,
  GGUF_DEFAULT_MODEL: `${M35}.gguf`,
  LLAMA_SERVER_MODEL: `${M35}.gguf`,
} as NodeJS.ProcessEnv;
const P = (f: string) => ({ artifactFile: f, slotClass: "nang" as const, artifactStatus: "available", license: "apache-2.0", enabled: true });
const ANH: AnhSoModel = {
  taiLuc: 1,
  vaiTro: new Map(VAI_TRO_GOC.map((v) => [v.id, { envKey: v.envKey, taskKind: v.taskKind }])),
  profile: new Map([
    ["p27", P(`${M27}.gguf`)],
    ["p35", P(`${M35}.gguf`)],
  ]),
  gan: [
    { roleId: "code.plc", scopeKind: "global", scopeId: null, profileId: "p27", envKey: null, fallback: ["p35"], mode: "active" },
    { roleId: "code.software", scopeKind: "global", scopeId: null, profileId: null, envKey: "GGUF_CODE_MODEL", fallback: [], mode: "active" },
  ],
};

let REPO_TS = "";
let REPO_PLC = "";
let uid = 0;

function git(repo: string, ...a: string[]): string {
  return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
}
function taoRepo(tien: string, tep: Record<string, string>): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), tien)));
  git(r, "init", "-q");
  git(r, "config", "user.email", "t@t");
  git(r, "config", "user.name", "t");
  for (const [rel, nd] of Object.entries(tep)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), nd);
  }
  git(r, "add", "-A");
  git(r, "commit", "-q", "-m", "init");
  return r;
}

type Ghi = { record: Array<Record<string, unknown>>; phu: Array<Record<string, unknown>>; yeuCau: GatewayRequest[] };
function planInferenceGia(ghi: Ghi, nem?: unknown) {
  return vi.fn(async (req: GatewayRequest): Promise<GatewayPlan> => {
    ghi.yeuCau.push(req);
    if (nem) throw nem;
    return {
      decision: {} as never,
      abVariant: null,
      record: (o) => void ghi.record.push(o as never),
      recordPhu: (o) => void ghi.phu.push(o as never),
      safeText: `[che] ${req.text ?? ""}`,
      safetyFlags: {} as never,
      sanitizeOutput: (t) => t,
    };
  });
}

async function chayHet(ql: ReturnType<typeof taoQuanLyLuotChay>, projectId: string, cauHoi = "đọc tệp rồi trả lời") {
  const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "vt" }, cauHoi, projectId, cheDo: "hoi" });
  if (!kq.ok) return { kq, suKien: [] as SuKienAgent[] };
  await kq.luot.xong;
  const suKien: SuKienAgent[] = [];
  ql.nghe(kq.luot.id, uid, 0, (m) => suKien.push(m.suKien))?.();
  return { kq, suKien };
}

beforeAll(async () => {
  REPO_TS = taoRepo("vt-ts-", { "src/a.ts": "export const A = 1;\n", "package.json": "{}\n" });
  REPO_PLC = taoRepo("vt-plc-", { "src/main.st": "PROGRAM Main\nVAR x : INT; END_VAR\nx := x + 1;\nEND_PROGRAM\n" });
  process.env.AI_REPO_SANDBOX_ROOTS = `vtts=TS|${REPO_TS};vtplc=PLC|${REPO_PLC}`;
  const bcrypt = await import("bcryptjs");
  uid = (await createLocalUser({ username: `vt-${Date.now()}`, passwordHash: await bcrypt.hash("Mk-vt-agent!1", 10), name: "vt", role: "admin" })).id;
}, 60_000);

afterEach(() => {
  delete process.env.AI_AGENT_THEO_VAI_TRO;
  h.modelNhan.length = 0;
  h.soLuotGoi = 0;
  h.cauNguoiDung.length = 0;
  _xoaNhoDuAnPlc();
});

afterAll(async () => {
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db && uid > 0) {
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const d of [REPO_TS, REPO_PLC]) fs.rmSync(d, { recursive: true, force: true });
}, 60_000);

const tc = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("cờ TẮT (mặc định) ⇒ như cũ", () => {
  it("★★★ không planInference, engine nhận modelId undefined, bat-dau KHÔNG có model", async () => {
    const ghi: Ghi = { record: [], phu: [], yeuCau: [] };
    h.kichBan = [{ chu: "xong." }];
    const ql = taoQuanLyLuotChay({ vaiTro: { planInference: planInferenceGia(ghi), layAnh: () => ANH, env: ENV } });
    const { kq, suKien } = await chayHet(ql, "vtplc");
    expect(kq.ok).toBe(true);
    expect(ghi.yeuCau).toHaveLength(0);
    expect(h.modelNhan).toEqual([undefined]);
    const bd = suKien.find((e) => e.loai === "bat-dau");
    expect(bd).toBeDefined();
    expect(bd && "model" in bd).toBe(false);
  }, 60_000);
});

describe("cờ BẬT", () => {
  const phu = (ghi: Ghi, nem?: unknown) => ({
    planInference: planInferenceGia(ghi, nem),
    layAnh: () => ANH,
    nguCanhKhe: () => ({ kheBiKhoa: false, kheDangGiu: M35 }),
    env: ENV,
  });

  it("★★★ (i) dự án có .st ⇒ bat-dau.model.vaiTro = code.plc và ENGINE nhận 27B; dự án TS ⇒ code.software, 35B", async () => {
    process.env.AI_AGENT_THEO_VAI_TRO = "1";
    const ghi: Ghi = { record: [], phu: [], yeuCau: [] };
    h.kichBan = [{ chu: "xong." }];
    const ql = taoQuanLyLuotChay({ vaiTro: phu(ghi) });
    const plc = await chayHet(ql, "vtplc");
    expect(h.modelNhan).toEqual([M27]);
    expect(plc.suKien.find((e) => e.loai === "bat-dau")).toMatchObject({ model: { vaiTro: "code.plc", model: M27, nguon: "gan-profile" } });

    const ts = await chayHet(ql, "vtts");
    expect(h.modelNhan).toEqual([M27, M35]);
    expect(ts.suKien.find((e) => e.loai === "bat-dau")).toMatchObject({ model: { vaiTro: "code.software", model: M35 } });
  }, 60_000);

  it("★★★ (iii) RateLimit ở planInference ⇒ 429 + lời nói thật; KHÔNG token, KHÔNG hàng sổ, chỗ được nhả", async () => {
    process.env.AI_AGENT_THEO_VAI_TRO = "1";
    const ghi: Ghi = { record: [], phu: [], yeuCau: [] };
    const db = await getDb();
    const truoc = db ? (await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid))).length : 0;
    // Lần 1 ném RateLimit, lần 2 cho qua — CÙNG một bộ quản lý (sổ giữ chỗ "1 lượt/người" là của từng bộ quản lý: dựng bộ mới
    // cho lần 2 thì lưới mù với chỗ bị rò — đột biến "không nhả chỗ" từng sống sót vì thế).
    let lan = 0;
    const p = phu(ghi);
    const goc = p.planInference;
    p.planInference = vi.fn(async (req: GatewayRequest) => {
      if (lan++ === 0) {
        ghi.yeuCau.push(req);
        throw new RateLimitError("AI rate limit exceeded", 5000, 2);
      }
      return goc(req);
    });
    const ql = taoQuanLyLuotChay({ vaiTro: p });
    const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: "sửa", projectId: "vtts", cheDo: "hoi" });
    expect(kq).toMatchObject({ ok: false, ma: "AI_GIOI_HAN_TAN_SUAT", http: 429, thongDiep: "AI rate limit exceeded" });
    expect(h.soLuotGoi).toBe(0);
    expect(h.modelNhan).toHaveLength(0);
    const sau = db ? (await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid))).length : 0;
    expect(sau).toBe(truoc);
    // chỗ "1 lượt/người" đã nhả: lượt kế tạo được ngay
    h.kichBan = [{ chu: "xong." }];
    const lai = await chayHet(ql, "vtts");
    expect(lai.kq.ok, JSON.stringify(lai.kq)).toBe(true);
  }, 60_000);

  it("★★★ (iv) N lượt model ⇒ N hàng agent-luot + 1 hàng chính, CÙNG requestId = runId", async () => {
    process.env.AI_AGENT_THEO_VAI_TRO = "1";
    const ghi: Ghi = { record: [], phu: [], yeuCau: [] };
    h.kichBan = [
      { toolCalls: [tc("c1", "read_file", { path: "src/a.ts" })] },
      { toolCalls: [tc("c2", "list_dir", { path: "src" })] },
      { chu: "A = 1." },
    ];
    const { kq } = await chayHet(taoQuanLyLuotChay({ vaiTro: phu(ghi) }), "vtts");
    if (!kq.ok) throw new Error(kq.ma);
    expect(h.soLuotGoi).toBe(3);
    expect(ghi.phu).toHaveLength(3);
    for (const r of ghi.phu) {
      expect(r).toMatchObject({ luotPhu: "agent-luot", requestId: kq.luot.id, model: M35, tokensIn: 1000, tokensOut: 40, reasoningTokens: 5 });
      expect(typeof r.latencyMs).toBe("number");
    }
    expect(ghi.record).toHaveLength(1);
    expect(ghi.record[0]).toMatchObject({ requestId: kq.luot.id, model: M35, tokensIn: 3000, tokensOut: 120, reasoningTokens: 15, outcome: "ok" });
    expect((await docHangLuotChay(uid, kq.luot.id))?.trangThai).toBe("xong");
    // model nhận câu ĐÃ CHE của aiGateway; sổ giữ câu gốc
    expect(h.cauNguoiDung[0]).toBe("[che] đọc tệp rồi trả lời");
    expect((await docHangLuotChay(uid, kq.luot.id))?.cauHoi).toBe("đọc tệp rồi trả lời");
  }, 60_000);
});
