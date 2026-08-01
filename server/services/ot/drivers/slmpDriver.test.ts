/**
 * doc 40 Wave 5 — OT-F8 SLMP driver + encoder tests. MOCK TCP SERVER (node:net) trả
 * frame SLMP hợp lệ theo spec → encode/decode round-trip + read/write + end-code path
 * + link-loss. KHÔNG cần phần cứng (sẵn sàng HW-FAT, KHÔNG tuyên bố đã-validate HW).
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { SlmpDriver } from "./slmpDriver";
import {
  buildBatchReadWord,
  buildBatchWriteWord,
  buildBatchReadBit,
  parseResponse,
  decodeWordsUnsigned,
  decodeInt16,
  decodeFloat32,
  encodeFloat32,
  decodeBits,
  packBits,
  parseSlmpDevice,
  expectedFrameLength,
  type SlmpFrame,
} from "./slmpEncoder";

// ── MOCK SERVER ────────────────────────────────────────────────────────────────
interface MockOpts {
  frame?: SlmpFrame;
  words?: number[]; // word-read data
  bits?: boolean[]; // bit-read data
  endCode?: number; // ép end-code cho mọi response
}
interface MockServer {
  port: number;
  requests: Buffer[];
  kill: () => void; // huỷ socket phía server → mô phỏng rớt link
  close: () => Promise<void>;
}

function buildResponse(frame: SlmpFrame, endCode: number, data: Buffer, serial: number): Buffer {
  const dataLen = 2 + data.length; // endCode(2) + data
  if (frame === "4E") {
    const head = Buffer.alloc(13);
    head[0] = 0xd4;
    head[1] = 0x00;
    head.writeUInt16LE(serial, 2);
    head.writeUInt16LE(0, 4);
    head[6] = 0x00; // netNo
    head[7] = 0xff; // pcNo
    head.writeUInt16LE(0x03ff, 8);
    head[10] = 0x00;
    head.writeUInt16LE(dataLen, 11);
    const ec = Buffer.alloc(2);
    ec.writeUInt16LE(endCode, 0);
    return Buffer.concat([head, ec, data]);
  }
  const head = Buffer.alloc(9);
  head[0] = 0xd0;
  head[1] = 0x00;
  head[2] = 0x00;
  head[3] = 0xff;
  head.writeUInt16LE(0x03ff, 4);
  head[6] = 0x00;
  head.writeUInt16LE(dataLen, 7);
  const ec = Buffer.alloc(2);
  ec.writeUInt16LE(endCode, 0);
  return Buffer.concat([head, ec, data]);
}

async function startMock(opts: MockOpts = {}): Promise<MockServer> {
  const frame = opts.frame ?? "3E";
  const endCode = opts.endCode ?? 0;
  const requests: Buffer[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // expectedFrameLength dùng chung offset dataLen cho request (subheader khác giá trị,
      // cùng vị trí trường độ dài) nên gộp được request y như response.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const need = expectedFrameLength(buf, frame);
        if (need < 0 || buf.length < need) break;
        const req = Buffer.from(buf.subarray(0, need));
        buf = buf.subarray(need);
        requests.push(req);

        const headLen = frame === "4E" ? 13 : 9;
        const serial = frame === "4E" ? req.readUInt16LE(2) : 0;
        const body = req.subarray(headLen);
        const cmd = body.readUInt16LE(2);
        const sub = body.readUInt16LE(4);
        const points = body.readUInt16LE(10);

        let data = Buffer.alloc(0);
        if (endCode === 0 && cmd === 0x0401) {
          // batch read
          if (sub === 0x0001) {
            const bits = opts.bits ?? Array.from({ length: points }, () => false);
            data = packBits(bits.slice(0, points));
          } else {
            const words = opts.words ?? Array.from({ length: points }, () => 0);
            data = Buffer.alloc(points * 2);
            for (let i = 0; i < points; i++) data.writeUInt16LE((words[i] ?? 0) & 0xffff, i * 2);
          }
        }
        socket.write(buildResponse(frame, endCode, data, serial));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    requests,
    kill: () => {
      for (const s of sockets) s.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

let mock: MockServer | null = null;
afterEach(async () => {
  if (mock) await mock.close();
  mock = null;
});

// ── ENCODER (thuần, không server) ───────────────────────────────────────────────
describe("slmpEncoder — wire format", () => {
  it("buildBatchReadWord 3E D100 x2 → exact spec bytes", () => {
    const { request } = buildBatchReadWord("D100", 2, { frame: "3E" });
    // header 50 00 | net 00 | pc FF | io FF 03 | md 00 | dataLen 0C 00
    // body   timer 00 00 | cmd 01 04 | sub 00 00 | devNo 64 00 00 | code A8 | pts 02 00
    expect(request.toString("hex").toUpperCase()).toBe("500000FFFF03000C00000001040000640000A80200");
  });

  it("buildBatchWriteWord 1401H + payload LE", () => {
    const { request } = buildBatchWriteWord("D200", [0x1234], { frame: "3E" });
    const headLen = 9;
    const body = request.subarray(headLen);
    expect(body.readUInt16LE(2)).toBe(0x1401); // command
    expect(body.readUInt16LE(4)).toBe(0x0000); // subcmd word
    expect(body.readUIntLE(6, 3)).toBe(200); // head device
    expect(body[9]).toBe(0xa8); // D code
    expect(body.readUInt16LE(10)).toBe(1); // points
    expect(body.readUInt16LE(12)).toBe(0x1234); // write data LE
  });

  it("parseSlmpDevice radix: X hex vs D decimal vs X octal", () => {
    expect(parseSlmpDevice("X1A").head).toBe(0x1a); // hex device
    expect(parseSlmpDevice("D100").head).toBe(100); // decimal device
    expect(parseSlmpDevice("Y20", true).head).toBe(0o20); // octal (FX5U)
    expect(() => parseSlmpDevice("D1A")).toThrow(); // decimal device w/ hex digit
    expect(parseSlmpDevice("X0").isReadOnly).toBe(true);
  });

  it("float encode/decode round-trip (2 words, low-word first)", () => {
    const words = encodeFloat32(1.0);
    expect(words).toEqual([0x0000, 0x3f80]); // 1.0f LE low word first
    const buf = Buffer.alloc(4);
    buf.writeUInt16LE(words[0], 0);
    buf.writeUInt16LE(words[1], 2);
    expect(decodeFloat32(buf)).toBeCloseTo(1.0, 6);
  });

  it("bit pack/decode round-trip (2 pts/byte, low pt = high nibble)", () => {
    const bits = [true, false, true, true, false];
    const packed = packBits(bits);
    expect(packed[0]).toBe(0x10); // pt0 ON hi-nibble, pt1 OFF
    expect(packed[1]).toBe(0x11); // pt2 ON, pt3 ON
    expect(decodeBits(packed, bits.length)).toEqual(bits);
  });

  it("parseResponse extracts endCode + data (3E)", () => {
    const data = Buffer.from([0x2a, 0x00]); // word 42
    const resp = buildResponseHelper("3E", 0, data);
    const parsed = parseResponse(resp, "3E");
    expect(parsed.endCode).toBe(0);
    expect(decodeWordsUnsigned(parsed.data, 1)).toEqual([42]);
    expect(decodeInt16(parsed.data)).toBe(42);
  });
});
function buildResponseHelper(frame: SlmpFrame, endCode: number, data: Buffer): Buffer {
  return buildResponse(frame, endCode, data, 0);
}

// ── DRIVER over MOCK ─────────────────────────────────────────────────────────────
describe("SlmpDriver (mock TCP server)", () => {
  it("3E connect → readTags int/float/bool with scale/offset", async () => {
    mock = await startMock({ frame: "3E", words: [50], bits: [true] });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}`, options: { frame: "3E" } });
    expect(d.isConnected()).toBe(true);

    const [level] = await d.readTags([
      { tagKey: "level", address: "D100", dataType: "int", scale: 2, offset: 5 },
    ]);
    expect(level.quality).toBe("good");
    expect(level.value).toBe(105); // 50*2+5

    const [run] = await d.readTags([{ tagKey: "run", address: "M0", dataType: "bool" }]);
    expect(run.quality).toBe("good");
    expect(run.value).toBe(true);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("3E readTags float decodes 2 words", async () => {
    mock = await startMock({ frame: "3E", words: encodeFloat32(3.5) });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    const [t] = await d.readTags([{ tagKey: "sp", address: "D10", dataType: "float" }]);
    expect(t.quality).toBe("good");
    expect(t.value).toBeCloseTo(3.5, 5);
    await d.disconnect();
  });

  it("end-code != 0 → quality bad (no batch crash)", async () => {
    mock = await startMock({ frame: "3E", endCode: 0xc059 });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    const samples = await d.readTags([
      { tagKey: "a", address: "D0", dataType: "int" },
      { tagKey: "b", address: "D1", dataType: "int" },
    ]);
    expect(samples.every((s) => s.quality === "bad")).toBe(true);
    expect(samples.every((s) => s.value === null)).toBe(true);
    const h = await d.health();
    expect(h.lastError).toMatch(/c059/i);
    await d.disconnect();
  });

  it("writeTags word (int, inverse scale) → sends 1401H; ok:true", async () => {
    mock = await startMock({ frame: "3E" });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    const res = await d.writeTags([
      { tagKey: "sp", address: "D100", value: 200, dataType: "int", scale: 2, offset: 0 },
    ]);
    expect(res[0].ok).toBe(true);
    // last request body: cmd 1401, points 1, data = 100 (200/2)
    const req = mock.requests[mock.requests.length - 1];
    const body = req.subarray(9);
    expect(body.readUInt16LE(2)).toBe(0x1401);
    expect(body.readUInt16LE(12)).toBe(100);
    await d.disconnect();
  });

  it("writeTags bit (bool) → sends 1401H subcmd 0001; ok:true", async () => {
    mock = await startMock({ frame: "3E" });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    const res = await d.writeTags([{ tagKey: "run", address: "M0", value: true, dataType: "bool" }]);
    expect(res[0].ok).toBe(true);
    const body = mock.requests[mock.requests.length - 1].subarray(9);
    expect(body.readUInt16LE(2)).toBe(0x1401);
    expect(body.readUInt16LE(4)).toBe(0x0001); // bit subcmd
    await d.disconnect();
  });

  it("writeTags read-only device (X) → ok:false, nothing sent", async () => {
    mock = await startMock({ frame: "3E" });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    const before = mock.requests.length;
    const res = await d.writeTags([{ tagKey: "in", address: "X0", value: true, dataType: "bool" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/not writable/);
    expect(mock.requests.length).toBe(before); // no wire traffic
    await d.disconnect();
  });

  it("4E frame round-trip (serial echoed) → read good", async () => {
    mock = await startMock({ frame: "4E", words: [7] });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}`, options: { frame: "4E" } });
    const [t] = await d.readTags([{ tagKey: "c", address: "D0", dataType: "int" }]);
    expect(t.quality).toBe("good");
    expect(t.value).toBe(7);
    // request carried a non-zero serial
    const body4e = mock.requests[0];
    expect(body4e[0]).toBe(0x54); // 4E subheader
    expect(body4e.readUInt16LE(2)).toBeGreaterThan(0);
    await d.disconnect();
  });

  it("link-loss: server kills socket mid-session → isConnected false; readTags throws", async () => {
    mock = await startMock({ frame: "3E", words: [1] });
    const d = new SlmpDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${mock.port}` });
    expect(d.isConnected()).toBe(true);

    mock.kill();
    await new Promise((r) => setTimeout(r, 50)); // let 'close' propagate
    expect(d.isConnected()).toBe(false);
    const h = await d.health();
    expect(h.lastError).toMatch(/link lost/i);
    await expect(d.readTags([{ tagKey: "x", address: "D0", dataType: "int" }])).rejects.toThrow(
      /not connected/,
    );
    await d.disconnect();
  });

  it("readTags/writeTags throw when not connected", async () => {
    const d = new SlmpDriver();
    await expect(d.readTags([{ tagKey: "x", address: "D0", dataType: "int" }])).rejects.toThrow(
      /not connected/,
    );
    await expect(
      d.writeTags([{ tagKey: "x", address: "D0", value: 1, dataType: "int" }]),
    ).rejects.toThrow(/not connected/);
  });
});
