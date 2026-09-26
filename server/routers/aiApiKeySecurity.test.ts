/**
 * Doc 69 W0-4 (doc-51 P0 follow-up) — `aiApiKeys` store security.
 *
 * Pre-task behaviour being regression-tested:
 *   - createApiKey persisted `Buffer.from(apiKey).toString("base64")` — reversible
 *     ENCODING, not encryption. Assertion (a) below is written as the exact negation
 *     of that: it would FAIL against the pre-task code (the stored value WAS that
 *     base64 string), and passes now because the stored value is a secretBox
 *     `enc:v1:...` ciphertext instead.
 *   - listApiKeys already omitted `encryptedKey` from its select, but returned no
 *     masked preview either — assertion (b) locks in "no raw/base64 secret anywhere
 *     in the response" going forward.
 *   - testApiKey always returned `{ success: true }` whenever `encryptedKey.length > 0`
 *     (i.e. always, since the column is NOT NULL) — a FABRICATED pass. Assertion (c)
 *     proves it is now an honest "not supported" result.
 *   - a legacy base64 row (simulating data written before this fix shipped) must be
 *     read without crashing and self-heals to `enc:v1:` ciphertext on read.
 *
 * Real-DB integration (isolated <db>_test, per vitest.setup.ts). Honest skip when the
 * test DB isn't provisioned in this environment.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { eq, like } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiApiKeys } from "../../drizzle/schema/ai";
import { decryptSecret, isEncrypted } from "../services/security/secretBox";

// secretBox derives its key from SECRET_ENCRYPTION_KEY (else JWT_SECRET) — vitest.setup.ts
// deliberately does NOT load the full .env, so set a deterministic test-only key here
// (mirrors server/sdk.authCache.test.ts's own process.env.JWT_SECRET assignment).
process.env.SECRET_ENCRYPTION_KEY ??= "w0-4-test-secret-encryption-key-0123456789abcdef";

const PREFIX = `AIKEY-SEC-${Date.now()}`;
const ADMIN_ID = 990_401;
const admin = { user: { id: ADMIN_ID, role: "admin", name: "W0-4 Tester" } } as any;

const db = await getDb();
if (!db) {
  // eslint-disable-next-line no-console
  console.warn("[aiApiKeySecurity.test] SKIP — test DB unreachable (run `npm run test:db:setup`).");
}

describe.skipIf(!db)("aiSettingsRouter — aiApiKeys security (doc 69 W0-4, integration)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.delete(aiApiKeys).where(like(aiApiKeys.name, `${PREFIX}%`));
  });

  it("(a) createApiKey stores a secretBox ciphertext — NOT base64(plaintext) — and it round-trips", async () => {
    const { aiSettingsRouter } = await import("./aiSettingsRouter");
    const caller = aiSettingsRouter.createCaller(admin);
    const plaintext = "sk-super-secret-value-abcd";

    const created = await caller.createApiKey({
      name: `${PREFIX}-roundtrip`,
      provider: "openai",
      apiKey: plaintext,
    });
    expect(created?.id).toBeTruthy();

    const [row] = await db!.select().from(aiApiKeys).where(eq(aiApiKeys.id, created!.id));
    expect(row).toBeTruthy();

    // The negation of the pre-task behaviour — this is exactly what the OLD code produced,
    // so this expectation would have FAILED before the fix.
    const oldStyleBase64 = Buffer.from(plaintext).toString("base64");
    expect(row.encryptedKey).not.toBe(oldStyleBase64);
    expect(row.encryptedKey).not.toContain(plaintext);

    // It's a real secretBox ciphertext, not merely "some other string" — prove it via
    // the secretBox API itself, not a hand-rolled base64 decode.
    expect(isEncrypted(row.encryptedKey)).toBe(true);
    expect(decryptSecret(row.encryptedKey)).toBe(plaintext);
  });

  it("(b) listApiKeys never returns the raw or base64 secret — only a last-4 mask", async () => {
    const { aiSettingsRouter } = await import("./aiSettingsRouter");
    const caller = aiSettingsRouter.createCaller(admin);
    const plaintext = "hf_anotherSecretValue9999";

    const created = await caller.createApiKey({
      name: `${PREFIX}-mask`,
      provider: "huggingface",
      apiKey: plaintext,
    });

    const list = await caller.listApiKeys();
    const mine = list.find((k: any) => k.id === created!.id);
    expect(mine).toBeTruthy();

    // No plaintext or base64-of-plaintext anywhere in the payload.
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain(Buffer.from(plaintext).toString("base64"));
    expect(mine).not.toHaveProperty("encryptedKey");

    // Masked preview is last-4 only, never the full secret.
    expect(mine!.maskedKey).toBe(plaintext.slice(-4));
    expect(mine!.maskedKey).not.toBe(plaintext);
  });

  it("(c) testApiKey no longer fabricates a passing connectivity result", async () => {
    const { aiSettingsRouter } = await import("./aiSettingsRouter");
    const caller = aiSettingsRouter.createCaller(admin);

    const created = await caller.createApiKey({
      name: `${PREFIX}-test`,
      provider: "custom",
      apiKey: "any-value-at-all",
    });

    const result = await caller.testApiKey({ id: created!.id });
    // Pre-task code returned { success: true } unconditionally (encryptedKey.length > 0
    // is always true for a NOT NULL column) — this MUST NOT be a fabricated pass.
    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/local-only|not (available|supported)/);
    expect(result.testedAt).toBeInstanceOf(Date);

    // lastTestedAt is still honestly recorded even though no real test ran.
    const [row] = await db!.select().from(aiApiKeys).where(eq(aiApiKeys.id, created!.id));
    expect(row.lastTestedAt).toBeInstanceOf(Date);
    // status is NOT overwritten with a fabricated verdict — stays whatever it was (active).
    expect(row.status).toBe("active");
  });

  it("(d) a legacy base64 row (pre-fix data) reads without crashing and self-heals to secretBox ciphertext", async () => {
    const legacyPlaintext = "legacy-plaintext-secret-42";
    const legacyBase64 = Buffer.from(legacyPlaintext).toString("base64");

    const [inserted] = await db!
      .insert(aiApiKeys)
      .values({
        name: `${PREFIX}-legacy`,
        provider: "openai",
        encryptedKey: legacyBase64,
        status: "active",
        createdBy: ADMIN_ID,
      })
      .returning({ id: aiApiKeys.id });

    const { aiSettingsRouter } = await import("./aiSettingsRouter");
    const caller = aiSettingsRouter.createCaller(admin);

    // Must not throw despite the row predating secretBox.
    const list = await caller.listApiKeys();
    const mine = list.find((k: any) => k.id === inserted.id);
    expect(mine).toBeTruthy();
    expect(mine!.maskedKey).toBe(legacyPlaintext.slice(-4));

    // Self-heal: the DB row itself is now a secretBox ciphertext, not the legacy base64.
    const [row] = await db!.select().from(aiApiKeys).where(eq(aiApiKeys.id, inserted.id));
    expect(row.encryptedKey).not.toBe(legacyBase64);
    expect(isEncrypted(row.encryptedKey)).toBe(true);
    expect(decryptSecret(row.encryptedKey)).toBe(legacyPlaintext);
  });
});
