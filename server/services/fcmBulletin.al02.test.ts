/**
 * ★ Pha 0 AL0-2 (2026-11-06) — `publishBulletin(sendFcm)` import `sendBulletinPushNotification` từ fcmService, hàm chưa từng tồn tại
 * (`as any` + `typeof === 'function'` nuốt im lặng ⇒ cờ "Gửi FCM Push" trên màn Bản tin không gửi gì). Đo qua đường gửi THẬT của fcmService;
 * chỉ giả `fetch` (Google OAuth + FCM) và sổ client.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const may = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", project_id: "p-test", private_key: privateKey, client_email: "t@p-test.iam.gserviceaccount.com" });
  return { clients: [] as Array<{ fcmToken: string | null }>, goi: [] as Array<{ url: string; body: any }>, fcmLoi: false };
});
vi.mock("../db", async (orig) => ({ ...(await orig<typeof import("../db")>()), getOfflineMqttClientsWithFcmToken: async () => may.clients }));

import { sendBulletinPushNotification } from "./fcmService";

const fetchGoc = globalThis.fetch;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "tok-gia", expires_in: 3600 }), { status: 200 });
  may.goi.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return may.fcmLoi ? new Response(JSON.stringify({ error: { message: "x" } }), { status: 400 }) : new Response(JSON.stringify({ name: "m/1" }), { status: 200 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = fetchGoc;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

// đúng hình `payload` mà mqttBulletinService.ts / mqttBulletinRouter.ts dựng
const banTin = {
  stationId: 7,
  stationName: "Trạm A",
  totalCount: 100,
  okCount: 90,
  ngCount: 8,
  ntfCount: 2,
  yieldRate: 92,
  failPointsCount: 3,
  period: { start: "2026-11-06T01:00:00.000Z", end: "2026-11-06T02:00:00.000Z", intervalMinutes: 60 },
};

beforeEach(() => {
  may.clients = [];
  may.goi = [];
  may.fcmLoi = false;
});

describe("AL0-2 — push bản tin định kỳ", () => {
  it("★★★ gửi THẬT tới từng token client offline, đúng nội dung và ĐÚNG từng trường data", async () => {
    may.clients = [{ fcmToken: "t1" }, { fcmToken: null }, { fcmToken: "t2" }];
    expect(await sendBulletinPushNotification(banTin)).toEqual({ sent: 2, failed: 0 });
    expect(may.goi.map((g) => g.body.message.token)).toEqual(["t1", "t2"]);
    const m = may.goi[0]!.body.message;
    expect(m.notification.title).toContain("Trạm A");
    expect(m.notification.body).toContain("100 kiểm tra: 90 OK, 8 NG, 2 NTF");
    expect(m.notification.body).toContain("3 điểm lỗi");
    // kiểu chuỗi do sendFCMv1Notification ép (String(v)); ở đây ghim GIÁ TRỊ — period là object nên ép mù sẽ thành "[object Object]"
    expect(m.data).toEqual({ type: "PERIODIC_BULLETIN", stationId: "7", totalCount: "100", ngCount: "8", yieldRate: "92", periodStart: banTin.period.start, periodEnd: banTin.period.end, timestamp: expect.any(String) });
  });
  it("★★ không có token ⇒ {0,0}, 0 lượt gọi mạng; FCM từ chối ⇒ đếm failed, không ném", async () => {
    expect(await sendBulletinPushNotification(banTin)).toEqual({ sent: 0, failed: 0 });
    expect(may.goi).toEqual([]);
    may.clients = [{ fcmToken: "t1" }];
    may.fcmLoi = true;
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await sendBulletinPushNotification(banTin)).toEqual({ sent: 0, failed: 1 });
    } finally {
      loi.mockRestore();
    }
  });
  it("★★★ ghim nối dây: publishBulletin import CÓ KIỂU (không `as any`, không rào typeof) và truyền nguyên `payload.period`", () => {
    const src = readFileSync(join(__dirname, "mqttService.ts"), "utf8");
    expect(src).toContain("const { sendBulletinPushNotification } = await import('./fcmService');");
    expect(src).not.toMatch(/import\('\.\/fcmService'\)\s*as any/);
    expect(src).not.toContain("typeof sendBulletinPushNotification");
    expect(src).toContain("period: payload.period,");
  });
});
