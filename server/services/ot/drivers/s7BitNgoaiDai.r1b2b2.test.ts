/**
 * SCADA R1b-2b-2a T3C (backlog 87, AN TOÀN) — địa chỉ bit S7 ngoài 0..7 không bao giờ tới nodes7; nodes7 không bao giờ phát lại gói ghi cũ.
 *
 * Phát hiện (rà T3): `parseS7Address` nhận bit > 7. nodes7 0.3.18 (`stringToS7Addr`, nodeS7.js:2361-2364) trả `undefined` cho "DB<n>,X<o>.<b>" khi
 * b > 7 ⇒ `writeItems` (:483-488) lặng lẽ BỎ item ⇒ danh sách rỗng ⇒ `prepareWritePacket` trả sớm (:673-676) TRƯỚC khi xoá `writePacketArray`
 * (:750-751) ⇒ `sendWritePacket` (:1052) gửi LẠI gói ghi trước (cùng seqNum, giống từng byte) ⇒ `writeResponse` báo chất lượng của
 * `globalWriteBlockList` cũ ⇒ callback(false) = ok GIẢ. Địa chỉ không phải DB ("M0.8") nodes7 KHÔNG bỏ mà ghi sai bit (offset*8+bit = M1.0).
 *
 * Ba lớp (driver THẬT, nodes7 THẬT, `__s7commSim` đếm PDU ghi — không mock):
 *   1. `parseS7Address` từ chối bit ∉ 0..7 (`OT_S7_BIT_NGOAI_DAI`) — lúc lưu cấu hình VÀ lúc ghi; lô chứa địa chỉ ấy bị từ chối CẢ lô;
 *   2. dò bằng CHÍNH bộ phân tích của nodes7 (`addItemsNow` mượn, trên đối tượng tách rời) TRƯỚC `writeItems`: item nào nodes7 sẽ bỏ / hiểu
 *      khác ⇒ cả lô bị từ chối (`OT_S7_DIA_CHI_THU_VIEN_BO`);
 *   3. chốt trong phiên (`prepareWritePacket` của instance): danh sách nodes7 dựng ≠ danh sách yêu cầu (kể cả RỖNG) ⇒ ném trước khi gửi.
 * Cùng lớp phía ĐỌC (mục 4): `prepareReadPacket` trả sớm (:827-829) trước khi xoá `readPacketArray` (:932) ⇒ gói ĐỌC cũ gửi lại, giá trị địa chỉ CŨ
 * trả dưới khoá cũ ⇒ readTags dò trước (khoá bị bỏ = config_error) + chốt trong phiên xoá gói đọc cũ khi danh sách rỗng (sim trả lời read var).
 */
import { afterEach, describe, expect, it } from "vitest";
import { startS7commSim } from "./__s7commSim";
import { S7Driver } from "./s7Driver";
import { executeOtDeviceWrite } from "../otDeviceWrite";
import { LoiS7BitNgoaiDai, MA_S7_BIT_NGOAI_DAI, laLoiS7BitNgoaiDai, loiBitNgoaiDaiS7, lyDoCauHinhBitNgoaiDaiS7, parseS7Address } from "./s7Address";

const dong: Array<() => unknown> = [];
afterEach(async () => {
  while (dong.length) await dong.pop()!();
});

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Driver S7 THẬT + nodes7 THẬT trên sim; `pduGhi()` = mọi PDU "write var" (job 0x01, hàm 0x05) sim đã nhận, dạng hex. */
async function s7Sim() {
  const sim = await startS7commSim();
  const d = new S7Driver();
  dong.push(() => sim.close(), () => d.disconnect());
  await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1000 });
  const pduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).map((p) => p.bytes.toString("hex"));
  return { sim, d, pduGhi };
}

/** Đường ghi THẬT của một STOP đã xác minh (executeOtDeviceWrite), tuần tự hoá tắt. */
async function stopQuaExecute(d: S7Driver, writes: Array<{ tagKey: string; address: string; value: unknown; dataType?: string }>) {
  const ds = writes.map((w) => ({ ...w, dataType: (w.dataType ?? "bool") as any }));
  return executeOtDeviceWrite({
    input: { adapterId: 993_000 + Math.floor(Math.random() * 1000), machineId: null, commandType: "stop", idempotencyKey: `t3c-${Math.random()}`, writes: ds.map((w) => ({ tagKey: w.tagKey, value: w.value })) } as any,
    driver: d,
    resolved: ds.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
    driverWrites: ds.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
    timeoutMs: 2000,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: [1], confirmedBy: 1 },
  });
}

/** Lời ghi trước: DB1,INT2 = 1234 (giống tái hiện của phát hiện) — 1 PDU, ok. */
async function ghiTruoc(d: S7Driver, pduGhi: () => string[]) {
  const out = await d.writeTags([{ tagKey: "sp", address: "DB1,INT2", value: 1234, dataType: "int" }]);
  expect(out).toEqual([{ tagKey: "sp", ok: true }]);
  expect(pduGhi()).toHaveLength(1);
}

describe("T3C lớp 1 — bit ∉ 0..7 bị từ chối, 0 gói, không phát lại gói cũ (nodes7 THẬT + sim)", () => {
  it("★ STOP DB1,X0.9 sau lời ghi DB1,INT2=1234 ⇒ 'failed' OT_S7_BIT_NGOAI_DAI, KHÔNG PDU ghi mới (trước bản vá: gói INT2 phát lại y từng byte + ack)", async () => {
    const { d, pduGhi } = await s7Sim();
    await ghiTruoc(d, pduGhi);
    const o = await stopQuaExecute(d, [{ tagKey: "stop", address: "DB1,X0.9", value: true }]);
    await cho(200);
    expect(pduGhi(), "không gói nào được gửi — nhất là không gửi lại gói INT2=1234").toHaveLength(1);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed" });
    expect(String(o.outcomes[0].errorText)).toMatch(/^OT_S7_BIT_NGOAI_DAI: /);
  }, 15_000);

  it("★ M0.8 (không phải DB: nodes7 KHÔNG bỏ mà ghi bit 8 = M1.0) ⇒ 'failed' OT_S7_BIT_NGOAI_DAI, 0 PDU", async () => {
    const { d, pduGhi } = await s7Sim();
    const o = await stopQuaExecute(d, [{ tagKey: "stop", address: "M0.8", value: true }]);
    await cho(200);
    expect(pduGhi()).toHaveLength(0);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed" });
    expect(String(o.outcomes[0].errorText)).toMatch(/^OT_S7_BIT_NGOAI_DAI: /);
  }, 15_000);

  it("★ lô [DB1,X0.9 ; DB1,INT4] ⇒ CẢ lô bị từ chối, 0 PDU (trước bản vá: INT4 được ghi một mình, callback ok)", async () => {
    const { d, pduGhi } = await s7Sim();
    await ghiTruoc(d, pduGhi);
    const out = await d.writeTags([
      { tagKey: "b", address: "DB1,X0.9", value: true, dataType: "bool" },
      { tagKey: "n", address: "DB1,INT4", value: 5, dataType: "int" },
    ]);
    await cho(200);
    expect(pduGhi()).toHaveLength(1);
    expect(out.map((r) => r.ok)).toEqual([false, false]);
    for (const r of out) expect(String(r.error)).toMatch(/^OT_S7_BIT_NGOAI_DAI: /);
    expect(out.every((r) => r.ketCucKhongRo === undefined)).toBe(true); // không gửi gì ⇒ kết cục RÕ ('failed'), không 'timeout'
  }, 15_000);
});

describe("T3C lớp 2 — dò bằng bộ phân tích của nodes7 TRƯỚC writeItems: item nào nodes7 sẽ bỏ ⇒ cả lô, 0 gói", () => {
  it("★ 'MX0.1' (parseS7Address nhận, nodes7 bỏ: không có vùng 'MX') sau lời ghi INT2 ⇒ 'failed' OT_S7_DIA_CHI_THU_VIEN_BO, KHÔNG phát lại", async () => {
    const { d, pduGhi } = await s7Sim();
    await ghiTruoc(d, pduGhi);
    const o = await stopQuaExecute(d, [{ tagKey: "stop", address: "MX0.1", value: true }]);
    await cho(200);
    expect(pduGhi()).toHaveLength(1);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed" });
    expect(String(o.outcomes[0].errorText)).toMatch(/^OT_S7_DIA_CHI_THU_VIEN_BO: .*nodes7 address parser/);
  }, 15_000);

  it("★ lô [MX0.1 ; DB1,INT4] ⇒ cả lô bị từ chối TRƯỚC writeItems, 0 PDU (ghi một phần cũng là kết cục sai)", async () => {
    const { d, pduGhi } = await s7Sim();
    const out = await d.writeTags([
      { tagKey: "m", address: "MX0.1", value: true, dataType: "bool" },
      { tagKey: "n", address: "DB1,INT4", value: 5, dataType: "int" },
    ]);
    await cho(200);
    expect(pduGhi()).toHaveLength(0);
    expect(out.map((r) => r.ok)).toEqual([false, false]);
    for (const r of out) expect(String(r.error)).toMatch(/^OT_S7_DIA_CHI_THU_VIEN_BO: .*nodes7 address parser/);
  }, 15_000);
});

describe("T3C lớp 3 — chốt trong phiên: nodes7 dựng danh sách khác yêu cầu (kể cả rỗng) ⇒ ném TRƯỚC khi gửi", () => {
  it("★ gọi thẳng writeItems của instance (bỏ qua writeTags) với khoá nodes7 bỏ, sau một lời ghi ⇒ ném, KHÔNG phát lại", async () => {
    const { d, pduGhi } = await s7Sim();
    await ghiTruoc(d, pduGhi);
    const conn = (d as any).conn;
    conn.setTranslationCB((t: string) => ({ x: "DB1,X0.9", m: "MX0.1", n: "DB1,INT4" })[t]);
    let goiLai = false;
    expect(() => conn.writeItems(["x"], [true], () => (goiLai = true))).toThrow(/^OT_S7_DIA_CHI_THU_VIEN_BO: /);
    expect(() => conn.writeItems(["m", "n"], [true, 5], () => (goiLai = true))).toThrow(/^OT_S7_DIA_CHI_THU_VIEN_BO: /);
    expect(() => conn.writeItems([], [], () => (goiLai = true))).toThrow(/^OT_S7_DIA_CHI_THU_VIEN_BO: /);
    expect(() => conn.writeItems(["n"], [5, 6], () => (goiLai = true))).toThrow(/^OT_S7_DIA_CHI_THU_VIEN_BO: /);
    await cho(200);
    expect(pduGhi()).toHaveLength(1);
    expect(goiLai).toBe(false);
    // phiên vẫn dùng được sau khi chốt ném
    expect(await d.writeTags([{ tagKey: "n", address: "DB1,INT4", value: 5, dataType: "int" }])).toEqual([{ tagKey: "n", ok: true }]);
    expect(pduGhi()).toHaveLength(2);
  }, 15_000);
});

describe("T3C đối chứng — địa chỉ hợp lệ vẫn ghi", () => {
  it("DB1,X0.7 / M0.7 / DB1,INT2 ⇒ ok, đúng một PDU mỗi lời ghi, con trỏ bit đúng (byte*8 + bit)", async () => {
    const { d, pduGhi } = await s7Sim();
    const o = await stopQuaExecute(d, [{ tagKey: "stop", address: "DB1,X0.7", value: true }]);
    expect(o.outcomes[0]).toMatchObject({ ok: true });
    expect(pduGhi()).toHaveLength(1);
    expect(await d.writeTags([{ tagKey: "m", address: "M0.7", value: false, dataType: "bool" }])).toEqual([{ tagKey: "m", ok: true }]);
    expect(await d.writeTags([{ tagKey: "sp", address: "DB1,INT2", value: 1234, dataType: "int" }])).toEqual([{ tagKey: "sp", ok: true }]);
    const p = pduGhi().map((h) => Buffer.from(h, "hex"));
    expect(p).toHaveLength(3);
    // item 1 bắt đầu ở byte 12 của tham số (10 + 2): 12 0a 10 <ts> <len16> <db16> <area> <addr24>
    const conTro = (b: Buffer) => ({ area: b[10 + 2 + 8], addr: b.readUIntBE(10 + 2 + 9, 3) });
    expect(conTro(p[0])).toEqual({ area: 0x84, addr: 7 });
    expect(conTro(p[1])).toEqual({ area: 0x83, addr: 7 });
    expect(conTro(p[2])).toEqual({ area: 0x84, addr: 16 });
  }, 15_000);
});

describe("T3C lớp 1 — parseS7Address: bit ∉ 0..7 ⇒ LoiS7BitNgoaiDai (mã ổn định); 0..7 vẫn nhận", () => {
  it("từ chối DB1,X0.8 / DB1,X0.9 / DB1,X3.10 / DB1,X0.08 / M0.8 / MX1.9 / Q2.8 / I0.8 / E1.12 — mã đứng đầu, nêu số bit", () => {
    for (const [a, bit] of [["DB1,X0.8", 8], ["db1,x0.9", 9], ["DB1,X3.10", 10], ["DB1,X0.08", 8], ["M0.8", 8], ["MX1.9", 9], ["Q2.8", 8], ["I0.8", 8], ["E1.12", 12]] as const) {
      let loi: unknown;
      try {
        parseS7Address(a);
      } catch (e) {
        loi = e;
      }
      expect(laLoiS7BitNgoaiDai(loi), a).toBe(true);
      expect((loi as LoiS7BitNgoaiDai).bit, a).toBe(bit);
      expect(String((loi as Error).message), a).toMatch(new RegExp(`^${MA_S7_BIT_NGOAI_DAI}: S7 bit address ".*" names bit ${bit} `));
      expect(loiBitNgoaiDaiS7(a), a).not.toBeNull();
    }
  });

  it("nhận bit 0..7 (DB / M / MX / Q / I) và địa chỉ không phải bit (DB1,INT2, MW0); lỗi dạng khác KHÔNG phải lớp bit ngoài dải", () => {
    for (const a of ["DB1,X0.0", "DB1,X14.7", "M0.7", "MX3.1", "Q0.0", "I1.7", "DB1,INT2", "MW0", "MD4"]) {
      expect(() => parseS7Address(a), a).not.toThrow();
      expect(loiBitNgoaiDaiS7(a), a).toBeNull();
    }
    for (const a of ["DB1,FOO0", "", "DB1,X0"]) {
      expect(() => parseS7Address(a), a).toThrow();
      expect(loiBitNgoaiDaiS7(a), a).toBeNull();
    }
  });

  it("lyDoCauHinhBitNgoaiDaiS7: chỉ tag hỏng, có mã, nêu tagKey=địa chỉ; sạch ⇒ null", () => {
    expect(lyDoCauHinhBitNgoaiDaiS7([{ tagKey: "a", address: "DB1,X0.0" }])).toBeNull();
    const ly = lyDoCauHinhBitNgoaiDaiS7([
      { tagKey: "a", address: "DB1,X0.0" },
      { tagKey: "stop", address: "DB1,X0.9" },
      { tagKey: "m", address: "M2.8" },
    ]);
    expect(ly?.startsWith(`${MA_S7_BIT_NGOAI_DAI}: 2 tag(s) name a bit outside 0..7 (stop=DB1,X0.9, m=M2.8) - writes`), String(ly)).toBe(true);
  });
});

describe("T3C mục 5 — khởi động / nạp cấu hình: tag S7 đã lưu có bit ∉ 0..7 ⇒ lý do có mã ở health().lastError (không im lặng)", () => {
  it("★ subscribe [tốt, DB1,X0.9] ⇒ health.lastError mang OT_S7_BIT_NGOAI_DAI + tag; GIỮ qua connect() lại; nạp lại cấu hình sạch ⇒ hết", async () => {
    const { sim, d } = await s7Sim();
    expect((await d.health()).lastError).toBeUndefined();
    const h1 = await d.subscribe(
      [
        { tagKey: "sp", address: "DB1,INT2", dataType: "int" },
        { tagKey: "stop", address: "DB1,X0.9", dataType: "bool" },
      ],
      () => undefined,
      60_000,
    );
    await h1.close();
    const sk1 = await d.health();
    expect(sk1.lastError?.startsWith(`${MA_S7_BIT_NGOAI_DAI}: 1 tag(s) name a bit outside 0..7 (stop=DB1,X0.9)`), String(sk1.lastError)).toBe(true);
    expect(sk1.connected).toBe(true);
    await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1000 }); // supervisor nối lại: connect() xoá lastError — cấu hình vẫn sai
    expect((await d.health()).lastError).toMatch(new RegExp(`^${MA_S7_BIT_NGOAI_DAI}: `));
    const h2 = await d.subscribe([{ tagKey: "sp", address: "DB1,INT2", dataType: "int" }], () => undefined, 60_000);
    await h2.close();
    expect((await d.health()).lastError ?? "").not.toContain(MA_S7_BIT_NGOAI_DAI);
  }, 15_000);
});

describe("T3C mục 4 — cùng lớp phía ĐỌC: prepareReadPacket trả sớm (nodeS7.js:827-829) trước khi xoá readPacketArray (:932) ⇒ gửi lại gói ĐỌC cũ", () => {
  const cuV2 = process.env.OT_CHAT_LUONG_V2_ENABLED;
  afterEach(() => {
    if (cuV2 === undefined) delete process.env.OT_CHAT_LUONG_V2_ENABLED;
    else process.env.OT_CHAT_LUONG_V2_ENABLED = cuV2;
  });

  it("★ đọc 'sp' DB1,INT2 (=1234) rồi 'sp' đổi sang MX0.1 (nodes7 bỏ) ⇒ config_error, KHÔNG gói đọc mới (trước bản vá: gói đọc DB1,INT2 gửi lại ⇒ 'sp' = 1234 good — giá trị của địa chỉ CŨ)", async () => {
    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const { sim, d } = await s7Sim();
    sim.setBytes(0x84, 1, 2, [0x04, 0xd2]);
    const pduDoc = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x04).length;
    const s1 = await d.readTags([{ tagKey: "sp", address: "DB1,INT2", dataType: "int" }]);
    expect(s1[0]).toMatchObject({ tagKey: "sp", quality: "good", value: 1234 });
    expect(pduDoc()).toBe(1);
    const s2 = await d.readTags([{ tagKey: "sp", address: "MX0.1", dataType: "int" }]);
    expect(pduDoc(), "không gửi lại gói đọc cũ").toBe(1);
    expect(s2[0]).toMatchObject({ tagKey: "sp", quality: "bad", value: null, statusCode: "invalid_address", reason: "config_error" });
    // lô trộn: tag tốt vẫn đọc, tag nodes7 bỏ ⇒ config_error
    const s3 = await d.readTags([
      { tagKey: "sp", address: "DB1,INT2", dataType: "int" },
      { tagKey: "m", address: "MX0.1", dataType: "bool" },
    ]);
    expect(s3.map((x) => [x.tagKey, x.quality, x.value, x.reason])).toEqual([
      ["sp", "good", 1234, undefined],
      ["m", "bad", null, "config_error"],
    ]);
  }, 15_000);

  it("đối chứng đọc: địa chỉ MẢNG (DB1,INT2.2, json) vẫn đọc qua lớp dò (chỉ phía ghi từ chối mảng)", async () => {
    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const { sim, d } = await s7Sim();
    sim.setBytes(0x84, 1, 2, [0x00, 0x07, 0x00, 0x09]);
    const s1 = await d.readTags([{ tagKey: "arr", address: "DB1,INT2.2", dataType: "json" }]);
    expect(s1[0]).toMatchObject({ tagKey: "arr", quality: "good", value: "[7,9]" });
  }, 15_000);

  it("vòng poll: lớp dò phía đọc chạy MỘT lần mỗi (tag, địa chỉ) — không thêm log addItemsNow mỗi tick; đổi địa chỉ ⇒ dò lại", async () => {
    const { d } = await s7Sim();
    const conn = (d as any).conn;
    const proto = Object.getPrototypeOf(conn);
    const goc = proto.addItemsNow;
    let lanDo = 0;
    proto.addItemsNow = function (this: unknown, ...a: unknown[]) {
      if (this !== conn) lanDo += 1; // lời dò chạy trên đối tượng TÁCH RỜI
      return goc.apply(this, a);
    };
    try {
      for (let i = 0; i < 3; i++) await d.readTags([{ tagKey: "sp", address: "DB1,INT2", dataType: "int" }]);
      expect(lanDo).toBe(1);
      await d.readTags([{ tagKey: "sp", address: "DB1,INT4", dataType: "int" }]);
      expect(lanDo).toBe(2);
    } finally {
      proto.addItemsNow = goc;
    }
  }, 15_000);

  it("cờ V2 TẮT: đọc chỉ gồm địa chỉ nodes7 bỏ ⇒ bad trần (như trước khi nodes7 tự bỏ), KHÔNG gói đọc mới, không giá trị địa chỉ CŨ; lô trộn: tag tốt vẫn đọc", async () => {
    delete process.env.OT_CHAT_LUONG_V2_ENABLED;
    const { sim, d } = await s7Sim();
    sim.setBytes(0x84, 1, 2, [0x04, 0xd2]);
    const pduDoc = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x04).length;
    await d.readTags([{ tagKey: "sp", address: "DB1,INT2", dataType: "int" }]);
    const s2 = await d.readTags([{ tagKey: "sp", address: "MX0.1", dataType: "int" }]);
    expect(pduDoc(), "không gửi lại gói đọc cũ").toBe(1);
    expect(s2[0]).toMatchObject({ tagKey: "sp", quality: "bad", value: null });
    const s3 = await d.readTags([
      { tagKey: "sp", address: "DB1,INT2", dataType: "int" },
      { tagKey: "m", address: "MX0.1", dataType: "bool" },
    ]);
    expect(s3.map((x) => [x.tagKey, x.quality, x.value])).toEqual([
      ["sp", "good", 1234],
      ["m", "bad", null],
    ]);
  }, 15_000);

  it("★ chốt trong phiên (đọc): danh sách đọc nodes7 dựng RỖNG ⇒ gói đọc cũ bị xoá trước khi gửi; callback 'zero tags' (false, {}) — không giá trị địa chỉ cũ (gọi thẳng instance, bỏ qua readTags)", async () => {
    const { sim, d } = await s7Sim();
    const pduDoc = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x04).length;
    await d.readTags([{ tagKey: "sp", address: "DB1,INT2", dataType: "int" }]);
    expect(pduDoc()).toBe(1);
    const conn = (d as any).conn;
    conn.setTranslationCB((t: string) => ({ sp: "MX0.1" })[t]);
    conn.removeItems();
    conn.addItems(["sp"]);
    const goiLai: unknown[][] = [];
    conn.readAllItems((...a: unknown[]) => goiLai.push(a));
    await cho(300);
    expect(pduDoc(), "không gửi lại gói đọc cũ").toBe(1);
    expect(goiLai).toEqual([[false, {}]]); // không có giá trị nào — trước bản vá gói đọc DB1,INT2 được gửi lại (2 PDU đọc, đột biến M13)
  }, 15_000);
});
