/**
 * doc 81 Đợt 1B Task 3 — HARNESS URSim TRUNG THỰC (BE2 §L3 T2).
 *
 * Lỗi đo được: `accepted = running OR robotmode~RUNNING OR programState~PLAYING`. Sau
 * `power on` + `brake release`, tài liệu UR nói `robotmode` là RUNNING NGAY CẢ KHI KHÔNG CÓ
 * chương trình nào chạy ⇒ một URScript HỎNG (lỗi cú pháp, bộ điều khiển không biên dịch)
 * vẫn được "accepted".
 *
 * Oracle: bộ điều khiển UR GIẢ (`__fakeUrController.ts`) viết theo văn bản giao thức
 * Dashboard của hãng, chạy trên 127.0.0.1 cổng 0 — không suy ra từ mã sản phẩm.
 */
import { describe, it, expect, afterEach } from "vitest";
import { FakeUrController } from "./__fakeUrController";
import { validateUrscriptOnUrsim, type UrsimValidationResult } from "./ursimHarness";

const GOOD = "def prog():\n  set_standard_digital_out(1, True)\n  sleep(0.5)\nend";
// Lỗi cú pháp: thiếu ngoặc đóng ⇒ bộ điều khiển thật báo compile error, không chạy.
const BROKEN = "def prog():\n  movej([0, -1.57, 1.57, 0, 0, 0], a=1.2, v=0.25\nend";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`bounded timeout ${ms}ms`)), ms).unref?.()),
  ]);
}

const fakes: FakeUrController[] = [];
afterEach(async () => {
  while (fakes.length) await fakes.pop()!.close();
});

async function run(fake: FakeUrController, script: string): Promise<UrsimValidationResult> {
  const { dashboardPort, primaryPort } = await fake.start();
  fakes.push(fake);
  return withTimeout(
    validateUrscriptOnUrsim(
      script,
      { host: "127.0.0.1", dashboardPort, scriptPort: primaryPort, timeoutMs: 2000 },
      { pollIntervalMs: 50, runWaitMs: 600 },
    ),
    8000,
  );
}

describe("validateUrscriptOnUrsim — accepted chỉ khi chương trình THẬT SỰ chạy", () => {
  it("script HỎNG: robotmode RUNNING nhưng 'Program running: false' ⇒ accepted=false", async () => {
    const fake = new FakeUrController();
    const r = await run(fake, BROKEN);
    // Tiền đề của kịch bản: bộ điều khiển giả đã ở RUNNING và KHÔNG chạy gì.
    expect(fake.robotMode).toBe("RUNNING");
    expect(fake.compileErrors.length).toBe(1);
    expect(fake.programs).toEqual([]);
    expect(r.sent).toBe(true);
    expect(r.robotMode).toBe("Robotmode: RUNNING");
    expect(r.running).toBe(false);
    expect(r.accepted).toBe(false);
  });

  it("script HỢP LỆ chạy thật ('Program running: true', an toàn NORMAL) ⇒ accepted=true", async () => {
    const fake = new FakeUrController();
    const r = await run(fake, GOOD);
    expect(fake.programs.length).toBe(1);
    expect(r.error).toBeUndefined();
    expect(r.sent).toBe(true);
    expect(r.running).toBe(true);
    expect(r.accepted).toBe(true);
    expect(r.safetyStatus).toBe("NORMAL");
  });

  it("chương trình chạy nhưng safetystatus chuyển PROTECTIVE_STOP trong cửa sổ quan sát ⇒ accepted=false", async () => {
    const fake = new FakeUrController({ safetyOnProgramStart: "PROTECTIVE_STOP" });
    const r = await run(fake, GOOD);
    expect(fake.programRunning).toBe(true); // chương trình VẪN báo đang chạy — chỉ an toàn bất thường
    expect(r.accepted).toBe(false);
    expect(r.safetyStatus).toBe("PROTECTIVE_STOP");
    expect(r.error).toMatch(/PROTECTIVE_STOP/);
  });

  it("sự cố an toàn THOÁNG QUA ở lượt hỏi đầu (PROTECTIVE_STOP rồi NORMAL) trong cửa sổ quan sát ⇒ accepted=false", async () => {
    const fake = new FakeUrController({ safetyRepliesAfterStart: ["PROTECTIVE_STOP", "NORMAL", "NORMAL", "NORMAL"] });
    const r = await run(fake, GOOD);
    expect(r.accepted).toBe(false);
    expect(r.error).toMatch(/PROTECTIVE_STOP/);
  });

  it("an toàn NORMAL lúc thấy chương trình chạy nhưng lượt đọc XÁC NHẬN ngay sau là PROTECTIVE_STOP ⇒ accepted=false", async () => {
    const fake = new FakeUrController({ safetyRepliesAfterStart: ["NORMAL", "PROTECTIVE_STOP"] });
    const r = await run(fake, GOOD);
    expect(r.accepted).toBe(false);
    expect(r.safetyStatus).toBe("PROTECTIVE_STOP");
  });

  it("bộ điều khiển đời cũ chỉ hiểu `safetymode` ⇒ vẫn đọc được, script hợp lệ ⇒ accepted=true", async () => {
    const fake = new FakeUrController({ legacySafetyOnly: true });
    const r = await run(fake, GOOD);
    expect(r.accepted).toBe(true);
    expect(r.safetyStatus).toBe("NORMAL");
  });

  it("không đọc được trạng thái an toàn ⇒ fail-closed (accepted=false, có lỗi)", async () => {
    const fake = new FakeUrController({ noSafetyQuery: true });
    const r = await run(fake, GOOD);
    expect(r.accepted).toBe(false);
    expect(r.error).toMatch(/safety/i);
  });
});
