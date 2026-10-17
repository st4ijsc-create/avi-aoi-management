/**
 * ★★★ Đợt 4A — THÂN các thủ tục tRPC `aiGatewayToken.*` trên CSDL `_test` THẬT.
 *
 * Canh: (1) tạo token CHỈ từ phiên web (cookie) + quyền `ai_repo_read`; (2) bản rõ trả ĐÚNG một lần — danh sách và sổ
 * audit KHÔNG chứa nó; (3) mỗi lần tạo/thu hồi/duyệt thiết bị có MỘT hàng audit; (4) thu hồi chỉ token của mình;
 * (5) xác nhận mã thiết bị có trần lượt thử.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { createLocalUser } from "../../../db/auth";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { aiGatewayTokens, aiGatewayDeviceCodes, auditLogs } from "../../../../drizzle/schema";
import { batDauThietBi } from "../../../db/aiGatewayTokens";
import {
  thuTucTao,
  thuTucDanhSach,
  thuTucThuHoi,
  thuTucXemThietBi,
  thuTucQuyetThietBi,
  ENTITY_AI_GATEWAY_TOKEN,
  type NguoiPhienToken,
} from "./thuTucToken";

let uid = 0;
let uidKhac = 0;
const NGUOI = (): NguoiPhienToken => ({ id: uid, role: "engineer", name: "KS token" });
const PHIEN = "cookie-phien-gia-cho-luoi";
const coQuyen = async () => true;
const khongQuyen = async () => false;

async function taoNguoi(ten: string): Promise<number> {
  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `gw-thutuc-${ten}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    passwordHash: await bcrypt.hash("Mk-gw-thutuc!1", 4),
    name: `GW thu tuc ${ten}`,
    role: "engineer",
  });
  return kq.id;
}

beforeAll(async () => {
  uid = await taoNguoi("a");
  uidKhac = await taoNguoi("b");
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const id of [uid, uidKhac]) {
    // ⚠ `audit_logs` là WORM (avi_app không DELETE được) — hàng audit của lưới ở lại, đúng như sản phẩm.
    await db.delete(aiGatewayDeviceCodes).where(eq(aiGatewayDeviceCodes.userId, id));
    await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, id));
    await db.delete(userSecrets).where(eq(userSecrets.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

async function auditCua(entityId: number) {
  const db = (await getDb())!;
  const hang = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, ENTITY_AI_GATEWAY_TOKEN), eq(auditLogs.entityId, entityId)));
  // `details` là chuỗi JSON (cột text) — giữ chuỗi thô để soát bản rõ, kèm bản đã parse để đọc `operation`.
  return hang.map((h) => ({ ...h, details: JSON.parse(String(h.details ?? "{}")) as { operation?: string }, tho: JSON.stringify(h) }));
}

describe("tao — chỉ phiên web + quyền AI", () => {
  it("không cookie phiên ⇒ CAN_PHIEN_WEB (không tạo gì)", async () => {
    const kq = await thuTucTao(NGUOI(), null, { ten: "x" }, undefined, coQuyen);
    expect(kq).toMatchObject({ ok: false, note: "CAN_PHIEN_WEB" });
  });
  it("không quyền `ai_repo_read` ⇒ PERMISSION_DENIED", async () => {
    const kq = await thuTucTao(NGUOI(), PHIEN, { ten: "x" }, undefined, khongQuyen);
    expect(kq).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
  });
  it("hợp lệ ⇒ token rõ MỘT lần; danh sách + audit không chứa bản rõ; audit đúng một hàng", async () => {
    const kq = await thuTucTao(NGUOI(), PHIEN, { ten: "VSCode laptop", phamVi: ["chat", "fim", "embed"], soNgay: 30 }, undefined, coQuyen);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.token).toMatch(/^avgw_/);
    expect(kq.phamVi).toEqual(["chat", "fim", "embed"]);

    const ds = await thuTucDanhSach(NGUOI(), coQuyen);
    expect(ds.ok).toBe(true);
    expect(JSON.stringify(ds)).not.toContain(kq.token);
    expect(ds.ok && ds.tokens.some((t) => t.id === kq.id)).toBe(true);

    const au = await auditCua(kq.id);
    expect(au).toHaveLength(1);
    expect(au[0].userId).toBe(uid);
    expect(au[0].tho).not.toContain(kq.token);
    expect(au[0].details.operation).toBe("AI_GATEWAY_TOKEN_CREATED");
  });
});

describe("thuHoi — chỉ của mình, có audit", () => {
  it("người khác thu hồi ⇒ NOT_FOUND, token vẫn hiệu lực; chủ thu hồi ⇒ audit REVOKED; lần hai ⇒ NOT_FOUND", async () => {
    const kq = await thuTucTao(NGUOI(), PHIEN, { ten: "se thu hoi" }, undefined, coQuyen);
    if (!kq.ok) throw new Error("tạo hỏng");
    const khac = await thuTucThuHoi({ id: uidKhac, role: "engineer" }, kq.id, undefined, coQuyen);
    expect(khac).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await thuTucThuHoi(NGUOI(), kq.id, undefined, coQuyen)).toMatchObject({ ok: true });
    const au = await auditCua(kq.id);
    expect(au.map((a) => a.details.operation).sort()).toEqual([
      "AI_GATEWAY_TOKEN_CREATED",
      "AI_GATEWAY_TOKEN_REVOKED",
    ]);
    expect(await thuTucThuHoi(NGUOI(), kq.id, undefined, coQuyen)).toMatchObject({ ok: false, note: "NOT_FOUND" });
  });
});

describe("thiết bị — xem + quyết, trần lượt thử", () => {
  it("xem ⇒ tên + phạm vi; duyệt ⇒ audit DEVICE_APPROVED; không phiên ⇒ CAN_PHIEN_WEB", async () => {
    const bd = await batDauThietBi({ ten: "luoi-thutuc VSCode", phamVi: ["chat"] });
    if (!bd.ok) throw new Error("bắt đầu hỏng");
    const xem = await thuTucXemThietBi(NGUOI(), bd.maNguoiDung, coQuyen);
    expect(xem).toMatchObject({ ok: true, ten: "luoi-thutuc VSCode", phamVi: ["chat"] });
    expect(await thuTucQuyetThietBi(NGUOI(), null, { maNguoiDung: bd.maNguoiDung, dongY: true }, undefined, coQuyen)).toMatchObject({
      ok: false,
      note: "CAN_PHIEN_WEB",
    });
    const q = await thuTucQuyetThietBi(NGUOI(), PHIEN, { maNguoiDung: bd.maNguoiDung, dongY: true, xacNhanTuKhoiTao: true }, undefined, coQuyen);
    expect(q).toMatchObject({ ok: true, trangThai: "da-duyet" });
    const db = (await getDb())!;
    const [h] = await db.select().from(aiGatewayDeviceCodes).where(eq(aiGatewayDeviceCodes.maNguoiDung, bd.maNguoiDung));
    const au = await auditCua(h.id);
    expect(au.map((a) => a.details.operation)).toContain("AI_GATEWAY_DEVICE_APPROVED");
  });

  it("đoán mã liên tục ⇒ RATE_LIMITED sau trần (đếm cả lượt xem lẫn lượt quyết)", async () => {
    const nguoi = { id: uidKhac, role: "engineer" };
    const kq: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await thuTucXemThietBi(nguoi, "BCDF-GHJK", coQuyen);
      kq.push(r.ok ? "ok" : r.note);
    }
    expect(kq.slice(0, 10).every((x) => x !== "RATE_LIMITED")).toBe(true);
    expect(kq[10]).toBe("RATE_LIMITED");
    const q = await thuTucQuyetThietBi(nguoi, PHIEN, { maNguoiDung: "BCDF-GHJK", dongY: true, xacNhanTuKhoiTao: true }, undefined, coQuyen);
    expect(q).toMatchObject({ ok: false, note: "RATE_LIMITED" });
  });
});

/**
 * ★★★ Rà bảo mật de591c868 #3 — device-code phishing ở bước DUYỆT:
 *   • Cho phép đòi xác nhận TƯỜNG MINH "chính tôi vừa bấm đăng nhập trong VSCode" (`xacNhanTuKhoiTao: true`) — máy chủ
 *     cưỡng chế, không chỉ giao diện; Từ chối thì không cần (thu hẹp quyền luôn được);
 *   • xem mã trả NGUỒN GỐC (IP + User-Agent + lúc tạo) và cờ `khacIp` khi IP khởi tạo ≠ IP trình duyệt đang duyệt;
 *   • audit duyệt mang nguồn gốc lượt khởi tạo + IP người duyệt (truy vết được ai đã khởi tạo mã bị lừa duyệt).
 */
describe("thiết bị — chống lừa đảo mã (rà bảo mật de591c868 #3)", () => {
  const REQ = { ip: "10.250.1.9", headers: {} as Record<string, unknown> };

  it("Cho phép KHÔNG có xacNhanTuKhoiTao ⇒ CAN_XAC_NHAN, mã vẫn đang chờ; Từ chối không cần xác nhận", async () => {
    const bd = await batDauThietBi({ ten: "luoi-thutuc-xn", phamVi: ["chat"], ip: "10.250.1.1" });
    if (!bd.ok) throw new Error("bắt đầu hỏng");
    const q = await thuTucQuyetThietBi(NGUOI(), PHIEN, { maNguoiDung: bd.maNguoiDung, dongY: true }, REQ, coQuyen);
    expect(q).toMatchObject({ ok: false, note: "CAN_XAC_NHAN" });
    expect(await thuTucXemThietBi(NGUOI(), bd.maNguoiDung, coQuyen, REQ)).toMatchObject({ ok: true });
    const tc = await thuTucQuyetThietBi(NGUOI(), PHIEN, { maNguoiDung: bd.maNguoiDung, dongY: false }, REQ, coQuyen);
    expect(tc).toMatchObject({ ok: true, trangThai: "tu-choi" });
  });

  it("xem ⇒ IP/User-Agent/lúc tạo + khacIp; duyệt ⇒ audit mang nguồn gốc + IP người duyệt", async () => {
    const bd = await batDauThietBi({ ten: "luoi-thutuc-ng", phamVi: ["chat"], ip: "10.250.1.2", tacNhan: "ua-ke-la/1" });
    if (!bd.ok) throw new Error("bắt đầu hỏng");
    const xem = await thuTucXemThietBi(NGUOI(), bd.maNguoiDung, coQuyen, REQ);
    expect(xem).toMatchObject({ ok: true, ipKhoiTao: "10.250.1.2", tacNhanKhoiTao: "ua-ke-la/1", ipCuaBan: "10.250.1.9", khacIp: true });
    const q = await thuTucQuyetThietBi(NGUOI(), PHIEN, { maNguoiDung: bd.maNguoiDung, dongY: true, xacNhanTuKhoiTao: true }, REQ, coQuyen);
    expect(q).toMatchObject({ ok: true });
    const db = (await getDb())!;
    const [h] = await db.select().from(aiGatewayDeviceCodes).where(eq(aiGatewayDeviceCodes.maNguoiDung, bd.maNguoiDung));
    const au = (await auditCua(h.id)).find((a) => a.details.operation === "AI_GATEWAY_DEVICE_APPROVED")!;
    expect(au.tho).toContain("10.250.1.2");
    expect(au.tho).toContain("ua-ke-la/1");
    expect(au.tho).toContain("10.250.1.9");
  });
});
