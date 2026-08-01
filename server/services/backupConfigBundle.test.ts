/**
 * W0-I (doc 44 G5.8) — config/secrets bundle trong backupService:
 *   - flag BACKUP_INCLUDE_SECRETS default OFF → skip
 *   - bật flag nhưng thiếu BACKUP_ENCRYPTION_KEY → skip trung thực, KHÔNG ghi plaintext
 *   - đủ key → ciphertext AES-256-GCM + sha256, plaintext KHÔNG xuất hiện trên đĩa,
 *     round-trip decrypt trả đúng nội dung, sai key → GCM auth fail
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectConfigBundleSources,
  createConfigBundle,
  decryptConfigBundle,
} from "./backupService";

let tmpDir: string;
let outDir: string;
let envFile: string;
let pemFile: string;

const SECRET_LINE = "SUPER_SECRET_DB_PASSWORD=hunter2-do-not-leak";
const PEM_BODY = "-----BEGIN PRIVATE KEY-----\nMIIfaketestkey\n-----END PRIVATE KEY-----\n";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfgb-test-"));
  outDir = path.join(tmpDir, "out");
  envFile = path.join(tmpDir, ".env");
  pemFile = path.join(tmpDir, "private.pem");
  fs.writeFileSync(envFile, SECRET_LINE + "\n", "utf8");
  fs.writeFileSync(pemFile, PEM_BODY, "utf8");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function baseOpts(env: Record<string, string>) {
  return {
    label: "unit",
    sources: [envFile, pemFile],
    outDir,
    env: env as any,
    replicateOffsite: false as const,
  };
}

describe("createConfigBundle — flag & key gating", () => {
  it("BACKUP_INCLUDE_SECRETS chưa bật (default) → skip, không tạo file", async () => {
    const r = await createConfigBundle(baseOpts({}));
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain("BACKUP_INCLUDE_SECRETS");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("bật flag nhưng THIẾU BACKUP_ENCRYPTION_KEY → skip trung thực, KHÔNG ghi plaintext", async () => {
    const r = await createConfigBundle(baseOpts({ BACKUP_INCLUDE_SECRETS: "true" }));
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain("BACKUP_ENCRYPTION_KEY");
    expect(r.reason).toContain("plaintext");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("không có file nguồn nào → skip", async () => {
    const r = await createConfigBundle({
      ...baseOpts({ BACKUP_INCLUDE_SECRETS: "true", BACKUP_ENCRYPTION_KEY: "k" }),
      sources: [path.join(tmpDir, "does-not-exist")],
    });
    expect(r.skipped).toBe(true);
  });
});

describe("createConfigBundle — mã hoá + round-trip", () => {
  const KEY = "test-passphrase-🔑";

  it("tạo ciphertext: sha256 khớp file, size đúng, plaintext KHÔNG nằm trên đĩa", async () => {
    const r = await createConfigBundle(
      baseOpts({ BACKUP_INCLUDE_SECRETS: "true", BACKUP_ENCRYPTION_KEY: KEY }),
    );
    expect(r.skipped).toBe(false);
    expect(r.fileName).toMatch(/^config_bundle_unit_.*\.cfgb\.enc$/);
    expect(r.fileCount).toBe(2);
    // files: chỉ tên + size — không có nội dung
    expect(r.files?.map((f) => path.basename(f.path)).sort()).toEqual([".env", "private.pem"]);
    for (const f of r.files ?? []) expect(JSON.stringify(f)).not.toContain("hunter2");

    const raw = fs.readFileSync(r.filePath!);
    expect(raw.length).toBe(r.fileSizeBytes);
    expect(crypto.createHash("sha256").update(raw).digest("hex")).toBe(r.sha256);
    // secrets không được xuất hiện dạng plaintext trong ciphertext
    expect(raw.includes(Buffer.from("hunter2"))).toBe(false);
    expect(raw.includes(Buffer.from("BEGIN PRIVATE KEY"))).toBe(false);
  });

  it("decryptConfigBundle round-trip trả đúng nội dung + per-file sha256", async () => {
    const r = await createConfigBundle(
      baseOpts({ BACKUP_INCLUDE_SECRETS: "true", BACKUP_ENCRYPTION_KEY: KEY }),
    );
    const bundle = decryptConfigBundle(r.filePath!, KEY);
    expect(bundle.v).toBe(1);
    expect(bundle.files).toHaveLength(2);
    const envEntry = bundle.files.find((f) => f.path.endsWith(".env"))!;
    const content = Buffer.from(envEntry.contentBase64, "base64").toString("utf8");
    expect(content).toContain(SECRET_LINE);
    expect(crypto.createHash("sha256").update(Buffer.from(envEntry.contentBase64, "base64")).digest("hex"))
      .toBe(envEntry.sha256);
  });

  it("sai key → GCM auth fail (throw), không trả dữ liệu rác", async () => {
    const r = await createConfigBundle(
      baseOpts({ BACKUP_INCLUDE_SECRETS: "true", BACKUP_ENCRYPTION_KEY: KEY }),
    );
    expect(() => decryptConfigBundle(r.filePath!, "wrong-key")).toThrow();
  });

  it("key 64-hex được dùng thô (32 byte) — round-trip vẫn đúng", async () => {
    const hexKey = crypto.randomBytes(32).toString("hex");
    const r = await createConfigBundle(
      baseOpts({ BACKUP_INCLUDE_SECRETS: "true", BACKUP_ENCRYPTION_KEY: hexKey }),
    );
    expect(r.skipped).toBe(false);
    expect(decryptConfigBundle(r.filePath!, hexKey).files).toHaveLength(2);
  });

  it("retention: giữ tối đa BACKUP_CONFIG_BUNDLE_RETENTION bundle mới nhất", async () => {
    const env = {
      BACKUP_INCLUDE_SECRETS: "true",
      BACKUP_ENCRYPTION_KEY: KEY,
      BACKUP_CONFIG_BUNDLE_RETENTION: "2",
    };
    for (let i = 0; i < 4; i++) {
      // label khác nhau để tên file không trùng trong cùng 1 ms
      await createConfigBundle({ ...baseOpts(env), label: `unit${i}` });
    }
    const bundles = fs.readdirSync(outDir).filter((f) => f.endsWith(".cfgb.enc"));
    expect(bundles.length).toBeLessThanOrEqual(2);
  });
});

describe("collectConfigBundleSources", () => {
  it("chỉ trả về file tồn tại; cwd rỗng → []", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cfgb-empty-"));
    try {
      expect(collectConfigBundleSources(empty)).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("nhặt .env + license keys + contracts/canonical khi có", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cfgb-root-"));
    try {
      fs.writeFileSync(path.join(root, ".env"), "A=1\n");
      fs.mkdirSync(path.join(root, "server", "license", "keys"), { recursive: true });
      fs.writeFileSync(path.join(root, "server", "license", "keys", "private.pem"), "x");
      fs.writeFileSync(path.join(root, "server", "license", "keys", "note.txt"), "x"); // không .pem → bỏ
      fs.mkdirSync(path.join(root, "contracts", "canonical"), { recursive: true });
      fs.writeFileSync(path.join(root, "contracts", "canonical", "command.schema.json"), "{}");
      const got = collectConfigBundleSources(root).map((p) => path.basename(p)).sort();
      expect(got).toEqual([".env", "command.schema.json", "private.pem"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
