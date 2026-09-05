/**
 * Lô 4 Mục 3 (BG-36) — dead-letter WAL có ĐƯỜNG ĐỌC (phạm vi ĐỌC-ONLY, không
 * resubmit/replay).
 *
 * Đo TRƯỚC (task description, không đoán): dead-letter thật trên máy này nằm ở
 * `data/inspection-store-forward.dead.jsonl` (đo bằng `ls`: 101 dòng, 7.410.317
 * byte ≈ 7,4 MB — KHỚP con số BG-36 khai "101 mục, 7,4 MB"). Mỗi dòng là MỘT JSON
 * `{key, deadAt, attempts, error, payload}` (`deadLetter()`,
 * `inspectionStoreForward.ts:800-819`) — `payload` MANG base64 ẢNH THẬT
 * (`measurements[].imageBase64`, đo trực tiếp: dòng đầu tiên trên máy này dài
 * hàng chục nghìn ký tự vì ảnh base64) — ĐÂY LÀ LÝ DO bắt buộc phải cắt gọn khi
 * đọc CHI TIẾT một mục, không được đổ nguyên payload về client.
 *
 * `inspectionStoreForward.ts` KHÔNG export hàm đọc nào cho file dead-letter (chỉ
 * ghi — `deadLetter()` là hàm nội bộ module, không export) — đây CHÍNH LÀ khoảng
 * trống BG-36 khai "chưa có giao diện". Module MỚI này (`deadLetterReader.ts`)
 * thêm đường ĐỌC, KHÔNG đụng file WAL đang chạy (`data/*.jsonl` sống), KHÔNG đổi
 * hành vi ghi/dead-letter hiện có.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";

const TMP_DIR = path.join(os.tmpdir(), `bg36-deadletter-reader-${Date.now()}`);

function walFilePath(): string {
  return path.join(TMP_DIR, "inspection-store-forward.jsonl");
}
function deadLetterFilePath(): string {
  return path.join(TMP_DIR, "inspection-store-forward.dead.jsonl");
}

function dongDeadLetter(overrides: Partial<{
  key: string; deadAt: string; attempts: number; error: string;
  machineCode: string; serialNumber: string; imageBase64: string;
}> = {}): string {
  const o = {
    key: overrides.key ?? `k-${Math.random().toString(36).slice(2)}`,
    deadAt: overrides.deadAt ?? new Date().toISOString(),
    attempts: overrides.attempts ?? 0,
    error: overrides.error ?? "UNAUTHORIZED: Invalid API key",
    machineCode: overrides.machineCode ?? "SIM-L1-SPI",
    serialNumber: overrides.serialNumber ?? "BENCH-0001",
  };
  const imageBase64 = overrides.imageBase64 ?? "A".repeat(500);
  return JSON.stringify({
    key: o.key,
    deadAt: o.deadAt,
    attempts: o.attempts,
    error: o.error,
    payload: {
      machineCode: o.machineCode,
      apiKey: "mk_should_not_leak_to_client_verbatim",
      serialNumber: o.serialNumber,
      overallResult: "OK",
      measurements: [{ pointCode: "BP001", result: "OK", imageBase64 }],
    },
  });
}

beforeEach(async () => {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  process.env.INSPECTION_STORE_FORWARD_FILE = walFilePath();
});

afterEach(async () => {
  delete process.env.INSPECTION_STORE_FORWARD_FILE;
  await fsp.rm(TMP_DIR, { recursive: true, force: true }).catch(() => undefined);
});

describe("listDeadLetterEntries — phân trang + tổng số + tổng byte, KHÔNG payload đầy đủ", () => {
  it("file không tồn tại (chưa từng dead-letter) ⇒ empty-state trung thực (total=0, entries=[])", async () => {
    const { listDeadLetterEntries } = await import("./deadLetterReader");
    const result = await listDeadLetterEntries({ offset: 0, limit: 20 });
    expect(result.total).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.totalBytes).toBe(0);
  });

  it("★★★ TRUNG TÂM — 3 dòng thật trên đĩa ⇒ total=3, totalBytes = tổng byte thật của file, entries KHÔNG mang payload đầy đủ (không có measurements/imageBase64)", async () => {
    const lines = [
      dongDeadLetter({ key: "a", machineCode: "M1", serialNumber: "SN-A" }),
      dongDeadLetter({ key: "b", machineCode: "M2", serialNumber: "SN-B" }),
      dongDeadLetter({ key: "c", machineCode: "M3", serialNumber: "SN-C" }),
    ];
    const content = lines.join("\n") + "\n";
    await fsp.writeFile(deadLetterFilePath(), content, "utf8");

    const { listDeadLetterEntries } = await import("./deadLetterReader");
    const result = await listDeadLetterEntries({ offset: 0, limit: 20 });

    expect(result.total).toBe(3);
    expect(result.totalBytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.key).toBeTruthy();
      expect(e.machineCode).toBeTruthy();
      expect(e.serialNumber).toBeTruthy();
      expect((e as any).payload).toBeUndefined();
      expect((e as any).measurements).toBeUndefined();
      expect(JSON.stringify(e)).not.toContain("imageBase64");
      expect(JSON.stringify(e)).not.toContain("mk_should_not_leak_to_client_verbatim");
    }
  });

  it("phân trang: offset/limit cắt đúng lát, total vẫn phản ánh TOÀN BỘ file (không chỉ trang hiện tại)", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => dongDeadLetter({ key: `p${i}` }));
    await fsp.writeFile(deadLetterFilePath(), lines.join("\n") + "\n", "utf8");

    const { listDeadLetterEntries } = await import("./deadLetterReader");
    const page1 = await listDeadLetterEntries({ offset: 0, limit: 2 });
    const page2 = await listDeadLetterEntries({ offset: 2, limit: 2 });

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.entries).toHaveLength(2);
    expect(page2.entries).toHaveLength(2);
    const keys1 = page1.entries.map((e) => e.key);
    const keys2 = page2.entries.map((e) => e.key);
    expect(new Set([...keys1, ...keys2]).size).toBe(4); // 2 trang không trùng nhau
  });

  it("dòng JSON hỏng (corrupt) bị BỎ QUA an toàn, không ném lỗi cho cả yêu cầu", async () => {
    await fsp.writeFile(
      deadLetterFilePath(),
      dongDeadLetter({ key: "good" }) + "\n{ this is not json\n" + dongDeadLetter({ key: "good2" }) + "\n",
      "utf8",
    );
    const { listDeadLetterEntries } = await import("./deadLetterReader");
    const result = await listDeadLetterEntries({ offset: 0, limit: 20 });
    expect(result.total).toBe(2);
    expect(result.entries.map((e) => e.key).sort()).toEqual(["good", "good2"]);
  });
});

describe("getDeadLetterDetail — payload CẮT GỌN AN TOÀN, trần kích thước", () => {
  it("key không tồn tại ⇒ null (không ném lỗi tra cứu sai)", async () => {
    await fsp.writeFile(deadLetterFilePath(), dongDeadLetter({ key: "exists" }) + "\n", "utf8");
    const { getDeadLetterDetail } = await import("./deadLetterReader");
    const result = await getDeadLetterDetail("khong-ton-tai");
    expect(result).toBeNull();
  });

  it("★★★ TRUNG TÂM — trường lớn (imageBase64) bị CẮT/LƯỢC BỎ trong chi tiết trả về, các trường mô tả khác vẫn còn", async () => {
    const bigImage = "B".repeat(50_000);
    await fsp.writeFile(
      deadLetterFilePath(),
      dongDeadLetter({ key: "big", machineCode: "M-BIG", serialNumber: "SN-BIG", imageBase64: bigImage }) + "\n",
      "utf8",
    );
    const { getDeadLetterDetail } = await import("./deadLetterReader");
    const detail = await getDeadLetterDetail("big");
    expect(detail).not.toBeNull();
    expect(detail!.key).toBe("big");
    expect(detail!.error).toContain("UNAUTHORIZED");
    const asString = JSON.stringify(detail);
    expect(asString.length, "chi tiết trả về PHẢI nhỏ hơn NHIỀU so với payload gốc (50KB ảnh)").toBeLessThan(10_000);
    expect(asString).not.toContain(bigImage);
    // apiKey THẬT không được rò xuống client dù payload gốc có field này
    expect(asString).not.toContain("mk_should_not_leak_to_client_verbatim");
  });

  it("payload không có trường lớn vẫn đọc được đầy đủ metadata mô tả (machineCode/serialNumber/attempts)", async () => {
    await fsp.writeFile(
      deadLetterFilePath(),
      dongDeadLetter({ key: "small", machineCode: "M-SMALL", serialNumber: "SN-SMALL", attempts: 4, imageBase64: "" }) + "\n",
      "utf8",
    );
    const { getDeadLetterDetail } = await import("./deadLetterReader");
    const detail = await getDeadLetterDetail("small");
    expect(detail!.attempts).toBe(4);
    expect(detail!.machineCode).toBe("M-SMALL");
    expect(detail!.serialNumber).toBe("SN-SMALL");
  });
});
