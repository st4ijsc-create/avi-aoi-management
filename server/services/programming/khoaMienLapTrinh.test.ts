/**
 * SCADA R1b-2b-2a T6d — HÀM ĐẶT MIỀN khoá lập trình (thuần) + điểm DUY NHẤT đường lập trình gọi `dispatch()` (adapter Mitsubishi) luôn gửi khoá ở miền
 * `pd:u<người yêu cầu>:` — kể cả khoá THÔ của một hàng `program_deployments` ghi TRƯỚC T6d (duyệt sau nâng cấp). `dispatch()` là mock (không DB, không
 * thiết bị); không cờ nào được bật.
 * C0-7: adapter tra `device_adapters.machineId` trước dispatch() ⇒ `getDb` được MOCK ở đây (một hàng machineId 7) để các ca không phụ thuộc DB ngầm.
 */
import { describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ khoa: [] as string[] }));
vi.mock("../../db/connection", () => ({
  getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ machineId: 7 }] }) }) }) }),
}));
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: async (input: { idempotencyKey: string }) => {
    H.khoa.push(input.idempotencyKey);
    return { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] };
  },
}));

import { khoaDispatchLapTrinh, khoaMienLapTrinh, laKhoaMienLapTrinh, tienToMienLapTrinh } from "./khoaMienLapTrinh";
import { MitsubishiEngineeringAdapter } from "./mitsubishi/mitsubishiEngineeringAdapter";

describe("T6d — miền khoá lập trình (thuần)", () => {
  it("khoá miền không bao giờ trùng khoá hệ con khác (`hmi:` / `hmistop:` / `il-` / `run…` / `edge:`) hay khoá của người dùng khác", () => {
    for (const k of ["hmi:abc", "hmistop:abc", "il-1-2", "run7-main-a1", "edge:jti", "x"]) {
      expect(khoaMienLapTrinh(5, k)).not.toBe(k);
      expect(khoaMienLapTrinh(5, k).startsWith("pd:u5:")).toBe(true);
    }
    expect(khoaMienLapTrinh(1, "2:K")).not.toBe(khoaMienLapTrinh(12, "K")); // userId chỉ chữ số, kết thúc ở ':' đầu tiên
    expect(khoaMienLapTrinh(1, "K")).not.toBe(khoaMienLapTrinh(2, "K"));
    expect(khoaMienLapTrinh(7, "x".repeat(128)).length).toBeLessThanOrEqual(128);
    expect(khoaMienLapTrinh(7, "x".repeat(128))).not.toBe(khoaMienLapTrinh(7, `${"x".repeat(127)}y`)); // boundedKey giữ băm của CẢ chuỗi
    expect(`${tienToMienLapTrinh(7, "y".repeat(96))}-rollback-dev${2 ** 31}`.length).toBeLessThanOrEqual(128);
  });

  it("khoaDispatchLapTrinh: khoá đã ở miền ⇒ giữ nguyên; khoá thô (hàng trước T6d) ⇒ miền của người yêu cầu", () => {
    const m = khoaMienLapTrinh(9, "K");
    expect(laKhoaMienLapTrinh(m)).toBe(true);
    expect(khoaDispatchLapTrinh(m, 9)).toBe(m); // đúng người yêu cầu ⇒ giữ (người KHÁC ⇒ ca M2 bên dưới)
    expect(laKhoaMienLapTrinh("hmi:abc")).toBe(false);
    expect(khoaDispatchLapTrinh("hmi:abc", 3)).toBe(khoaMienLapTrinh(3, "hmi:abc"));
    expect(khoaDispatchLapTrinh("progdeploy-12", 3)).toBe("pd:u3:progdeploy-12");
  });

  it("T6d fix 1 (M2): khoá `pd:u<N>:` với N KHÁC người yêu cầu (khoá thô trước T6d của A viết đúng chữ `pd:u<B>:K`) ⇒ ĐẶT LẠI vào miền người yêu cầu, không giữ", () => {
    const cuaB = khoaMienLapTrinh(12, "K"); // "pd:u12:K"
    expect(khoaDispatchLapTrinh(cuaB, 12)).toBe(cuaB); // đúng người ⇒ giữ
    expect(khoaDispatchLapTrinh(cuaB, 3)).toBe(khoaMienLapTrinh(3, cuaB)); // người khác ⇒ miền của người yêu cầu
    expect(khoaDispatchLapTrinh(cuaB, 3)?.startsWith("pd:u3:")).toBe(true); // A2(a): kiểu trả string | null (null = phần bên gọi rỗng)
    expect(khoaDispatchLapTrinh(cuaB, 1)).toBe(khoaMienLapTrinh(1, cuaB)); // "pd:u12:" KHÔNG phải miền của u1 (tiền tố số)
    expect(khoaDispatchLapTrinh("pd:u1:K", 12)).toBe(khoaMienLapTrinh(12, "pd:u1:K"));
  });
});

describe("T6d — adapter Mitsubishi (điểm duy nhất của đường lập trình tới dispatch())", () => {
  const build = { ok: true, diagnostics: [], meta: { paramMap: { D100: "1" } } } as never;
  const opts = (idempotencyKey: string) => ({ stage: "staging" as const, idempotencyKey, deviceId: 41, hitl: { actionId: "act", requestedBy: 6, confirmedBy: 8 } });

  it("khoá thô (hàng deploy trước T6d, vd `hmi:<uuid>`) ⇒ dispatch() nhận khoá ở miền `pd:u<người yêu cầu>:`, không bao giờ khoá thô", async () => {
    H.khoa.length = 0;
    await new MitsubishiEngineeringAdapter().deploy(build, opts("hmi:3f2a"));
    expect(H.khoa).toEqual([khoaMienLapTrinh(6, "hmi:3f2a")]);
  });

  it("khoá đã ở miền (hàng deploy từ T6d) ⇒ dispatch() nhận đúng khoá ấy (phát lại theo khoá giữ nguyên)", async () => {
    H.khoa.length = 0;
    const m = khoaMienLapTrinh(6, "K");
    await new MitsubishiEngineeringAdapter().deploy(build, opts(m));
    expect(H.khoa).toEqual([m]);
  });

  it("T6d fix 1 (M2): khoá ở miền của NGƯỜI KHÁC ⇒ dispatch() nhận khoá ở miền người yêu cầu (6), không bao giờ `pd:u<người khác>:` nguyên dạng", async () => {
    H.khoa.length = 0;
    const cuaNguoiKhac = khoaMienLapTrinh(60, "K");
    await new MitsubishiEngineeringAdapter().deploy(build, opts(cuaNguoiKhac));
    expect(H.khoa).toEqual([khoaMienLapTrinh(6, cuaNguoiKhac)]);
  });
});
