/**
 * doc 81 Đợt 1B Task 4 — Techman Listen Node: phản hồi được PHÂN LOẠI, không còn "mọi reply ⇒ done".
 *
 * BE2 §2 (Techman) / §3 S6 / T1 B-C-D: trước đây `$CPERR`, `ERROR`, đóng kết nối… đều thành `done`.
 * Ở đây chạy `TechmanDriver` THẬT (lib `modbus-serial` thật, socket `node:net` thật) nói chuyện với
 * một Listen Node GIẢ trong tiến trình (127.0.0.1, cổng 0). Server giả trả CHUỖI GIAO THỨC VIẾT SẴN;
 * checksum trong mỗi chuỗi đã được tính ĐỘC LẬP, ngoài mã sản phẩm (Python một dòng, XOR mọi byte
 * GIỮA `$` và `*` — phép tính ghi trong task-4-report.md):
 *
 *   $TMSCT,4,1,OK,*5C          $TMSCT,9,1,ERROR;1,*07      $CPERR,2,02,*4A
 *   $TMSCT,4,2,OK,*5F          $TMSCT,6,1,OK;2,*57         $TMSTA,8,00,false,*1A
 *   Lệnh home id 1:  $TMSCT,39,1,PTP("JPP",0,0,0,0,0,0,35,200,0,false),*00
 *   Lệnh custom id 1: $TMSCT,14,1,ScriptExit(),*67
 *
 * Treo được đo bằng hạn giờ tường minh (`settleWithin`), không dựa vào timeout của vitest.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { TechmanDriver } from "./techmanDriver";
import {
  startFakeListenNode,
  startFakeTmModbus,
  type FakeListenNode,
  type FakeListenNodeBehaviour,
  type FakeTmModbus,
} from "./__fakeTechman";

const HOME_ID1 = '$TMSCT,39,1,PTP("JPP",0,0,0,0,0,0,35,200,0,false),*00\r\n';
const SCRIPT_EXIT_ID1 = "$TMSCT,14,1,ScriptExit(),*67\r\n";

async function settleWithin<T>(p: Promise<T>, ms: number): Promise<{ settled: boolean; value?: T; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__pending__">((r) => {
    timer = setTimeout(() => r("__pending__"), ms);
  });
  try {
    const out = await Promise.race([p, guard]);
    if (out === "__pending__") return { settled: false, elapsed: Date.now() - t0 };
    return { settled: true, value: out as T, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

let modbus: FakeTmModbus;
const nodes: FakeListenNode[] = [];
const drivers: TechmanDriver[] = [];
const savedEnv = process.env.ROBOT_CONTROL_ENABLED;

beforeAll(async () => {
  modbus = await startFakeTmModbus();
});
afterAll(async () => {
  await modbus.close();
});
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect()));
  await Promise.all(nodes.splice(0).map((n) => n.close()));
  if (savedEnv === undefined) delete process.env.ROBOT_CONTROL_ENABLED;
  else process.env.ROBOT_CONTROL_ENABLED = savedEnv;
});

async function rig(behaviour: FakeListenNodeBehaviour): Promise<{ d: TechmanDriver; node: FakeListenNode }> {
  const node = await startFakeListenNode(behaviour);
  nodes.push(node);
  const d = new TechmanDriver();
  drivers.push(d);
  await d.connect({
    endpoint: `tcp://127.0.0.1:${modbus.port}`,
    timeoutMs: 1000,
    options: { listenHost: "127.0.0.1", listenPort: node.port },
  });
  expect(d.isConnected()).toBe(true);
  process.env.ROBOT_CONTROL_ENABLED = "true";
  return { d, node };
}

describe("Techman Listen Node × server giả — phân loại phản hồi (doc 81 Đợt 1B Task 4)", () => {
  it("OK khớp id ⇒ done; khung gửi đi đúng từng byte theo vector độc lập", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.settled).toBe(true);
    expect(r.value?.ok).toBe(true);
    expect(r.value?.status).toBe("done");
    expect(node.received).toEqual([HOME_ID1]);
  });

  it("OK bị TCP xé thành 3 mảnh ⇒ vẫn ghép đúng khung ⇒ done", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSC", "T,4,1,O", "K,*5C\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.settled).toBe(true);
    expect(r.value?.status).toBe("done");
  });

  it("OK;<dòng> (chấp nhận kèm cảnh báo) ⇒ done, cảnh báo được ghi lại", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSCT,6,1,OK;2,*57\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.status).toBe("done");
    expect(r.value?.detail?.warnings).toEqual([2]);
  });

  it("ERROR ⇒ failed + mã tm_script_error (không bao giờ done)", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSCT,9,1,ERROR;1,*07\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.ok).toBe(false);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_script_error");
    expect(r.value?.error).toMatch(/tm_script_error/);
  });

  it("$CPERR ⇒ failed + mã tm_cperr kèm mã lỗi thiết bị", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$CPERR,2,02,*4A\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_cperr");
    expect(r.value?.detail?.deviceErrorCode).toBe("02");
  });

  it("checksum sai ⇒ failed + tm_reply_bad_checksum (dù nội dung nói OK)", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*00\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_reply_bad_checksum");
  });

  it("OK nhưng của id KHÁC ⇒ failed + tm_reply_id_mismatch", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSCT,4,2,OK,*5F\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_reply_id_mismatch");
  });

  it("khung khác loại ($TMSTA) ⇒ failed + tm_reply_unexpected", async () => {
    const { d } = await rig({ kind: "reply", chunks: ["$TMSTA,8,00,false,*1A\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_reply_unexpected");
  });

  it("server ĐÓNG kết nối trước khi trả lời ⇒ failed + tm_connection_closed, trong hạn", async () => {
    const { d, node } = await rig({ kind: "close" });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 3000);
    expect(r.settled, `runJob treo > 3000 ms (đo ${r.elapsed})`).toBe(true);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_connection_closed");
    expect(node.received).toEqual([HOME_ID1]);
  });

  it("server IM LẶNG ⇒ failed + tm_reply_timeout trong timeoutMs + 1 s", async () => {
    const { d } = await rig({ kind: "silent" });
    const r = await settleWithin(d.runJob({ jobType: "home" }), 2000);
    expect(r.settled, `runJob treo > 2000 ms (đo ${r.elapsed})`).toBe(true);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_reply_timeout");
  });
});

describe("Techman — danh sách trắng script ở tầng driver (doc 81 Đợt 1B Task 4)", () => {
  it("custom với script NGOÀI danh sách ⇒ failed tm_script_not_allowlisted, KHÔNG một kết nối/byte nào", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(
      d.runJob({ jobType: "custom", params: { script: 'ChangeBase("RobotBase")' } }),
      3000,
    );
    expect(r.value?.ok).toBe(false);
    expect(r.value?.status).toBe("failed");
    expect(r.value?.detail?.reasonCode).toBe("tm_script_not_allowlisted");
    expect(node.connections()).toBe(0);
    expect(node.received).toEqual([]);
  });

  it("custom với script TRONG danh sách (ScriptExit()) vẫn đi qua ⇒ gửi đúng khung, OK ⇒ done", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "custom", params: { script: "ScriptExit()" } }), 3000);
    expect(r.value?.status).toBe("done");
    expect(node.received).toEqual([SCRIPT_EXIT_ID1]);
  });
});

/**
 * doc 81 Đợt 1B Task 5 (R10a + R10c).
 * Khung abort id 1 tính ĐỘC LẬP (Python một dòng, XOR mọi byte giữa `$` và `*`, cùng phép đã tái
 * tạo đúng vector tài liệu `*61` cho id 7): `$TMSCT,22,1,StopAndClearBuffer(),*67`.
 */
const ABORT_ID1 = "$TMSCT,22,1,StopAndClearBuffer(),*67\r\n";

describe("Techman — abort() NÊU thất bại thay vì nuốt (doc 81 Đợt 1B Task 5, R10c)", () => {
  it("OK khớp id ⇒ abort() resolve; khung StopAndClearBuffer() đúng từng byte", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(d.abort().then(() => "resolved"), 3000);
    expect(r.settled).toBe(true);
    expect(r.value).toBe("resolved");
    expect(node.received).toEqual([ABORT_ID1]);
  });

  it.each([
    ["silent", { kind: "silent" } as FakeListenNodeBehaviour, /tm_reply_timeout/],
    ["close", { kind: "close" } as FakeListenNodeBehaviour, /tm_connection_closed/],
    ["ERROR", { kind: "reply", chunks: ["$TMSCT,9,1,ERROR;1,*07\r\n"] } as FakeListenNodeBehaviour, /tm_script_error/],
  ])("Listen Node %s ⇒ abort() REJECT kèm lý do (không còn im lặng như đã dừng)", async (_l, behaviour, re) => {
    const { d } = await rig(behaviour);
    const r = await settleWithin(
      d.abort().then(
        () => "resolved",
        (e: Error) => e,
      ),
      3000,
    );
    expect(r.settled).toBe(true);
    expect(r.value).toBeInstanceOf(Error);
    expect((r.value as Error).message).toMatch(/Techman abort failed/);
    expect((r.value as Error).message).toMatch(re);
  });
});

describe("Techman — verb console start/reset/pause bị từ chối ở driver (doc 81 Đợt 1B Task 5, R10a)", () => {
  it.each(["start", "reset", "pause"])(
    "custom {command:%s} ⇒ failed techman_console_verb_unvalidated, KHÔNG kết nối/byte nào (không gửi ScriptExit())",
    async (command) => {
      const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
      const r = await settleWithin(d.runJob({ jobType: "custom", params: { command } }), 3000);
      expect(r.value?.ok).toBe(false);
      expect(r.value?.detail?.reasonCode).toBe("techman_console_verb_unvalidated");
      expect(node.connections()).toBe(0);
      expect(node.received).toEqual([]);
    },
  );

  it("kèm script trong danh sách vẫn bị từ chối (ScriptExit() chính là hành vi bị cấm)", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "custom", params: { command: "start", script: "ScriptExit()" } }), 3000);
    expect(r.value?.detail?.reasonCode).toBe("techman_console_verb_unvalidated");
    expect(node.connections()).toBe(0);
  });

  it("custom KHÔNG có command console (đường khác) ⇒ không bị cổng verb chặn", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
    const r = await settleWithin(d.runJob({ jobType: "custom", params: { script: "ScriptExit()" } }), 3000);
    expect(r.value?.status).toBe("done");
    expect(node.received).toEqual([SCRIPT_EXIT_ID1]);
  });
});

/**
 * doc 81 Đợt 1B Task 5 fix round 1 — hàng rào abort. Job `home` (id 1) vừa mở socket tới Listen
 * Node (đang ở pha connect) thì abort() được gọi ⇒ khung PTP của job đó KHÔNG BAO GIỜ được ghi; chỉ
 * khung abort id 2 tới robot. Literal độc lập: `$TMSCT,22,2,StopAndClearBuffer(),*64`, `$TMSCT,4,2,OK,*5F`.
 */
describe("Techman — hàng rào abort: không byte chuyển động nào sau/đồng thời với STOP (fix round 1)", () => {
  it("runJob(home) đang kết nối + abort() ⇒ chỉ khung abort id 2 tới Listen Node, job home trả job_fenced_by_abort", async () => {
    const { d, node } = await rig({ kind: "reply", chunks: ["$TMSCT,4,2,OK,*5F\r\n"] });
    const job = d.runJob({ jobType: "home" });
    const stop = settleWithin(d.abort().then(() => "resolved"), 3000);
    const j = await settleWithin(job, 3000);
    expect((await stop).value).toBe("resolved");
    expect(j.value?.ok).toBe(false);
    expect(j.value?.detail?.reasonCode).toBe("job_fenced_by_abort");
    expect(j.value?.detail?.sent).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    const all = node.received.join("");
    expect(all).not.toContain("PTP(");
    expect(node.received.filter((x) => x.length > 0)).toEqual(["$TMSCT,22,2,StopAndClearBuffer(),*64\r\n"]);
  });
});

