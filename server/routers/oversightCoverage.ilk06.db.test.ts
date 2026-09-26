/**
 * Fix round 1 (doc 80 Đợt 1 Task 2, ILK-06) — code review finding #1.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `oversightRouter.posture` "độ phủ interlock" (`_internal.fetchInterlockCoverage`) PHẢI
 * khớp CHÍNH XÁC tập rule mà cổng THẬT (`evaluateInterlockGate`, `interlockGate.ts:207-215`)
 * xét: `enabled=true` + ĐÃ DUYỆT (`approvedBy IS NOT NULL`) + `action` nằm trong allowlist
 * chặn (`INTERLOCK_GATE_ACTIONS` — KHÔNG gồm `alert`, vì `alert` không chặn gì) + có đích
 * (`targetMachineId`/`targetAdapterId`).
 *
 * TRƯỚC bản vá round 1: hàm chỉ xét `enabled=true` + có đích — một rule `alert` có đích
 * (không chặn được lệnh nào) hoặc một rule `stop_line` CHƯA duyệt (chưa qua second-approver
 * — `evaluateInterlockGate` đòi `r.approvedBy != null` trước tiên) vẫn bị đếm là "có phủ" —
 * đúng hình dạng báo-xanh-giả mà ILK-06 tồn tại để ngăn (Hub nói "có N rule chặn được lệnh"
 * trong khi N rule đó, thật ra, không chặn gì).
 *
 * DB THẬT (`_test`, vitest.setup ép) — cần vì lưới phải đánh giá đúng mệnh đề WHERE; một mock
 * chuỗi drizzle giả (như `oversightRouter.test.ts`) không "chạy" SQL nên không phân biệt được
 * "SQL đúng" với "SQL sai nhưng cùng hình dạng lời gọi". Đo bằng DELTA (trước/sau khi chèn 4
 * hàng biết trước), không phải số tuyệt đối — bảng có thể mang rule của phiên/luồng việc khác
 * đang chạy song song trên CÙNG CSDL `_test`. `interlock_rules` không khai FK bắt buộc nào
 * (`machineId`/`targetMachineId`/`targetAdapterId` — đọc `drizzle/schema/interlock.ts`) nên
 * một fixture tự dựng + tự dọn là an toàn (mẫu: `interlockGate.ilk04.db.test.ts`).
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { _internal } from "./oversightRouter";
import { getDb } from "../db/connection";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILK06COV-${Date.now()}`;
const MACHINE_ID = 990_200_001;

let sql: ReturnType<typeof postgres>;
let ruleIds: number[] = [];
let beforeCount: number;

describe.skipIf(!DB_URL)("ILK-06 (Fix round 1) — fetchInterlockCoverage khớp allowlist THẬT của cổng", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const d = await getDb();
    beforeCount = (await _internal.fetchInterlockCoverage(d)).count;

    const insertRule = async (opts: {
      name: string;
      action: string;
      approved: boolean;
      enabled: boolean;
      target: boolean;
    }): Promise<number> => {
      const approvedBy = opts.approved ? 999_999 : null;
      const targetMachineId = opts.target ? MACHINE_ID : null;
      const row = await sql`
        INSERT INTO interlock_rules
          (name, scope, "sourceType", "comparisonOperator", action, enabled, "approvedBy", "targetMachineId")
        VALUES
          (${opts.name}, 'machine', 'ng_rate', 'gt', ${opts.action}, ${opts.enabled}, ${approvedBy}, ${targetMachineId})
        RETURNING id`;
      return (row[0] as unknown as { id: number }).id;
    };

    ruleIds = [
      // (1) alert, ĐÃ duyệt, BẬT, có đích — KHÔNG chặn gì (action=alert) ⇒ KHÔNG được tính.
      await insertRule({ name: `${DAU}-alert-approved-target`, action: "alert", approved: true, enabled: true, target: true }),
      // (2) stop_line, CHƯA duyệt, BẬT, có đích — cổng thật đòi approvedBy trước ⇒ KHÔNG tính.
      await insertRule({ name: `${DAU}-stopline-unapproved-target`, action: "stop_line", approved: false, enabled: true, target: true }),
      // (3) stop_line, ĐÃ duyệt, BẬT, có đích — ĐỐI CHỨNG DƯƠNG: rule thật sự chặn được ⇒ TÍNH.
      await insertRule({ name: `${DAU}-stopline-approved-target`, action: "stop_line", approved: true, enabled: true, target: true }),
      // (4) stop_line, ĐÃ duyệt, TẮT, có đích — rule tắt không chặn gì ⇒ KHÔNG tính (hành vi cũ giữ nguyên).
      await insertRule({ name: `${DAU}-stopline-approved-disabled`, action: "stop_line", approved: true, enabled: false, target: true }),
    ];
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM interlock_rules WHERE id = ANY(${ruleIds})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ đối chứng SQL thô — trong bốn rule vừa chèn, ĐÚNG MỘT khớp cả bốn điều kiện", async () => {
    const [{ count: raw }] = (await sql`
      SELECT count(*)::int AS count FROM interlock_rules
      WHERE id = ANY(${ruleIds})
        AND enabled = true
        AND "approvedBy" IS NOT NULL
        AND action IN ('block_downstream', 'stop_line', 'reduce_speed')
        AND ("targetMachineId" IS NOT NULL OR "targetAdapterId" IS NOT NULL)
    `) as unknown as [{ count: number }];
    expect(raw).toBe(1);
  });

  it("★★★ fetchInterlockCoverage: DELTA sau khi chèn bốn rule = ĐÚNG +1 (chỉ rule #3)", async () => {
    const d = await getDb();
    const afterInsert = await _internal.fetchInterlockCoverage(d);
    expect(afterInsert.degraded).toBe(false);
    expect(
      afterInsert.count - beforeCount,
      "alert (dù có đích+đã duyệt), stop_line CHƯA duyệt, và stop_line TẮT đều không được tính — chỉ +1 (rule #3)",
    ).toBe(1);
  });
});
