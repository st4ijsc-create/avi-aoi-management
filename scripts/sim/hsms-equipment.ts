/**
 * SIMULATOR 3/6 — HSMS equipment ảo (SEMI E37 / SECS-II passive entity).
 *
 * Mở một TCP server HSMS THẬT bind cổng thật (mặc định 5000) đóng vai EQUIPMENT ở
 * chế độ PASSIVE. Tái dùng CODEC SECS-II thật của hệ thống (server/services/secsgem)
 * — KHÔNG bịa khung. Nó:
 *   • chấp nhận HSMS Select.req → trả Select.rsp; Linktest.req → Linktest.rsp;
 *   • trả lời S1F1→S1F2, S1F13→S1F14 (COMMACK=accepted), S1F17→S1F18 (ONLACK=accepted);
 *   • BẮN unsolicited S5F1 (Alarm Report) + S6F11 (Event Report) theo lịch, để
 *     host (hsmsClient.enableLiveDispatch) decode + ack THẬT khi bật cờ
 *     SECS_GEM_ENABLED + SECS_GEM_LIVE_ENABLED.
 *
 * Chạy độc lập (cần tsx vì file .ts import codec TS của server):
 *   node --import tsx scripts/sim/hsms-equipment.ts --port 5000 --id HSMS-L1
 *   (hoặc qua launcher sim-devices.mjs — launcher tự spawn bằng tsx)
 */
import net from "node:net";
import { encodeItem, type Secs2Item } from "../../server/services/secsgem/secs2Codec";
import { s1f2, s1f14, s1f18, COMMACK, ONLACK, type Secs2Message } from "../../server/services/secsgem/s1Messages";
import { s5f1, s6f11 } from "../../server/services/secsgem/s5s6Messages";
import {
  parseHsmsFrames,
  frameStreamFunction,
  SType,
  type ParsedHsmsFrame,
} from "../../server/services/secsgem/hsmsClient";
// util.mjs chạy qua tsx (interop mjs↔ts trong suốt).
// @ts-expect-error — .mjs không có type declaration, cố ý.
import { parseArgs, opt, makeLogger, onShutdown } from "./lib/util.mjs";

const args = parseArgs();
const PORT = Number(opt(args, "port", "SIM_PORT", 5000));
const HOST = String(opt(args, "host", "SIM_HOST", "0.0.0.0"));
const ID = String(opt(args, "id", "SIM_ID", `HSMS-${PORT}`));
const MODEL = String(opt(args, "model", "SIM_MODEL", "AVI-SIM-EQ"));
const SOFTREV = String(opt(args, "softrev", "SIM_SOFTREV", "1.0.0"));
const ALARM_MS = Number(opt(args, "alarmMs", "SIM_ALARM_MS", 15000));
const EVENT_MS = Number(opt(args, "eventMs", "SIM_EVENT_MS", 8000));
const log = makeLogger(ID);

// ── HSMS framing cục bộ (10-byte header + 4-byte length prefix, SEMI E37) ─────
let SYSBYTES = 100;
function nextSysBytes(): number {
  SYSBYTES = (SYSBYTES + 1) >>> 0 || 1;
  return SYSBYTES;
}
function buildHeader(o: { sessionId: number; byte2: number; byte3: number; sType: number; systemBytes: number }): Buffer {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(o.sessionId & 0xffff, 0);
  h[2] = o.byte2 & 0xff;
  h[3] = o.byte3 & 0xff;
  h[4] = 0; // PType = SECS-II
  h[5] = o.sType & 0xff;
  h.writeUInt32BE(o.systemBytes >>> 0, 6);
  return h;
}
function frame(header: Buffer, body: Buffer = Buffer.alloc(0)): Buffer {
  const len = header.length + body.length;
  const out = Buffer.alloc(4 + len);
  out.writeUInt32BE(len, 0);
  header.copy(out, 4);
  body.copy(out, 4 + header.length);
  return out;
}
/** Frame một control message (echo systemBytes của request khi trả lời). */
function frameControl(sessionId: number, sType: number, systemBytes: number, byte2 = 0, byte3 = 0): Buffer {
  return frame(buildHeader({ sessionId, byte2, byte3, sType, systemBytes }));
}
/** Frame một SECS-II DATA message. systemBytes: echo (reply) hoặc mới (primary). */
function frameData(sessionId: number, msg: Secs2Message, systemBytes: number): Buffer {
  const body = encodeItem(msg.body as Secs2Item);
  const byte2 = (msg.wbit ? 0x80 : 0x00) | (msg.stream & 0x7f);
  return frame(buildHeader({ sessionId, byte2, byte3: msg.streamFunction & 0xff, sType: SType.DATA, systemBytes }), body);
}

// ── Per-connection state machine ─────────────────────────────────────────────
interface Conn {
  socket: net.Socket;
  rx: Buffer;
  selected: boolean;
  sessionId: number;
  alarmTimer?: ReturnType<typeof setInterval>;
  eventTimer?: ReturnType<typeof setInterval>;
}

const conns = new Set<Conn>();
let alarmSeq = 0;
let eventSeq = 0;

function handleFrame(c: Conn, f: ParsedHsmsFrame): void {
  if (f.sType === SType.SELECT_REQ) {
    c.sessionId = f.sessionId;
    c.selected = true;
    c.socket.write(frameControl(f.sessionId, SType.SELECT_RSP, f.systemBytes, 0, 0));
    log(`SELECT.req → SELECT.rsp (session=${f.sessionId})`);
    startEquipmentInitiated(c);
    return;
  }
  if (f.sType === SType.LINKTEST_REQ) {
    c.socket.write(frameControl(f.sessionId, SType.LINKTEST_RSP, f.systemBytes));
    return;
  }
  if (f.sType === SType.SEPARATE_REQ) {
    log("SEPARATE.req → closing connection");
    c.socket.end();
    return;
  }
  if (f.sType === SType.DATA) {
    const sf = frameStreamFunction(f);
    // S1F1 Are You There → S1F2 On Line Data
    if (sf.stream === 1 && sf.function === 1) {
      c.socket.write(frameData(f.sessionId, s1f2({ modelName: MODEL, softRev: SOFTREV }), f.systemBytes));
      log("S1F1 → S1F2 (online data)");
    } else if (sf.stream === 1 && sf.function === 13) {
      c.socket.write(frameData(f.sessionId, s1f14(COMMACK.ACCEPTED, { modelName: MODEL, softRev: SOFTREV }), f.systemBytes));
      log("S1F13 → S1F14 (COMMACK=accepted)");
    } else if (sf.stream === 1 && sf.function === 17) {
      c.socket.write(frameData(f.sessionId, s1f18(ONLACK.ACCEPTED), f.systemBytes));
      log("S1F17 → S1F18 (ONLACK=accepted)");
    }
    // S5F2 / S6F12 acks từ host: nuốt (không cần xử lý).
    return;
  }
}

/** Sau khi SELECTED: bắn định kỳ S5F1 alarm + S6F11 event (unsolicited primaries). */
function startEquipmentInitiated(c: Conn): void {
  if (!c.alarmTimer) {
    c.alarmTimer = setInterval(() => {
      if (!c.selected || c.socket.destroyed) return;
      alarmSeq++;
      const set = alarmSeq % 2 === 1; // xen kẽ SET/CLEAR
      const alid = 1000 + (alarmSeq % 5);
      const alcd = (set ? 0x80 : 0x00) | 0x04; // bit8=set, category 4 (Parameter Control Error)
      const altx = set ? `SIM over-temperature warning #${alarmSeq}` : `SIM alarm cleared #${alarmSeq}`;
      c.socket.write(frameData(c.sessionId, s5f1(alcd, alid, altx), nextSysBytes()));
      log(`→ S5F1 alarm ALID=${alid} ${set ? "SET" : "CLEAR"} "${altx}"`);
    }, ALARM_MS);
    c.alarmTimer.unref?.();
  }
  if (!c.eventTimer) {
    c.eventTimer = setInterval(() => {
      if (!c.selected || c.socket.destroyed) return;
      eventSeq++;
      const ceid = 5000 + (eventSeq % 3); // vd: 5000 lot-start, 5001 unit-complete, 5002 lot-end
      const reports = [
        { rptId: 1, values: [`UNIT-${eventSeq}`, 25 + (eventSeq % 10), eventSeq % 2 === 0] as (string | number | boolean)[] },
      ];
      c.socket.write(frameData(c.sessionId, s6f11(eventSeq, ceid, reports), nextSysBytes()));
      log(`→ S6F11 event CEID=${ceid} (unit UNIT-${eventSeq})`);
    }, EVENT_MS);
    c.eventTimer.unref?.();
  }
}

function cleanupConn(c: Conn): void {
  if (c.alarmTimer) clearInterval(c.alarmTimer);
  if (c.eventTimer) clearInterval(c.eventTimer);
  conns.delete(c);
}

const server = net.createServer((socket) => {
  const c: Conn = { socket, rx: Buffer.alloc(0), selected: false, sessionId: 0 };
  conns.add(c);
  log(`peer connected ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on("data", (d) => {
    c.rx = Buffer.concat([c.rx, d]);
    const { frames, rest } = parseHsmsFrames(c.rx);
    c.rx = rest;
    for (const f of frames) {
      try {
        handleFrame(c, f);
      } catch (err) {
        log(`frame handler error: ${(err as Error)?.message ?? err}`);
      }
    }
  });
  socket.on("error", (err) => log(`socket error: ${(err as Error)?.message ?? err}`));
  socket.on("close", () => {
    cleanupConn(c);
    log("peer disconnected");
  });
});

server.on("error", (err) => {
  log(`FATAL server error: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`HSMS equipment ready → tcp://${HOST}:${PORT} (passive, model=${MODEL} rev=${SOFTREV}, alarm/${ALARM_MS}ms event/${EVENT_MS}ms)`);
});

onShutdown(async () => {
  log("shutting down HSMS equipment…");
  for (const c of conns) {
    cleanupConn(c);
    c.socket.destroy();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
