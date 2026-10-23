/**
 * SCADA R0 Task 12 — bench nghiệm thu "kết nối thật" trên OpenPLC (Docker). CHẠY TAY, không vào CI.
 *
 *   pnpm tsx scripts/scada-r0-bench.ts --endpoint tcp://127.0.0.1:15502 --poll 1000 --tags 18 --container avi-openplc-bench
 *       [--timeout 800] [--kieu pause|stop|ca-hai] [--nhanh legacy|ha|ca-hai] [--web http://127.0.0.1:18080] [--giu-mat 3000] [--lap 1]
 *
 * Trong tiến trình, KHÔNG cần DB, KHÔNG đụng :3000: chạy otManager THẬT (`startOt`, nhánh legacy và/hoặc HA) qua seam nguồn adapter
 * (`setAdapterSource` — seam của edge) trên ModbusDriver THẬT + vòng poll chung (`taoVongPoll`) + trạng thái adapter (`trangThaiAdapter`)
 * + ingest.ts → bộ đệm giá trị hiện tại. Hai seam sẵn có thay DB: `setTelemetryPersistFn` (ghi telemetry ⇒ đếm) và `__datGhiDb` của
 * trangThaiAdapter (ghi `device_adapters.status` ⇒ ghi lại THỜI ĐIỂM lệnh UPDATE được phát).
 *
 * "Rút cáp": `docker pause` (đường TREO — chỉ timeout cứu) hoặc `docker stop -t 0` (đường RESET — tiến trình chết, TCP đóng).
 * "Cắm lại": `docker unpause` hoặc `docker start` (+ đăng nhập web openplc/openplc bấm Start nếu runtime chưa chạy — như
 * scripts/safety-plc-bench.ts:54-74). Cổng 4 đo từ lúc Modbus THẬT SỰ trả lời lại: một client thăm dò riêng (kết nối mới mỗi lần,
 * hạn 500 ms) đọc holding 0..N-1 mỗi 100 ms; lần đọc thành công đầu tiên = "Modbus trả lời".
 *
 * Cổng đo (cùng hàng R0 của báo cáo; ngưỡng KHÔNG nới):
 *   1. mọi tag `bad` ở bộ đệm hiện tại ≤ 2 chu kỳ poll        (đo từ lúc lệnh rút cáp TRẢ VỀ; in cả từ lúc bắt đầu lệnh)
 *   2. trạng thái adapter `lost` ≤ 5 s — đây là thứ `scadaDiag.danhSach` (M10) hiển thị: RAM (`layTrangThaiAdapter`) đi TRƯỚC DB
 *   3. lệnh ghi `device_adapters.status` = 'error' ≤ 5 s sau khi rút; 'connected' ≤ 5 s sau khi Modbus trả lời lại
 *   4. mọi tag `good` (tươi) ở bộ đệm ≤ 2 chu kỳ poll sau khi Modbus trả lời lại
 *
 * Bản đồ địa chỉ: thanh ghi holding 0..N-1 (FC03, %QW0..%QW{N-1}). PHẢI xác nhận trên bench trước khi tin — script kiểm trước mỗi lượt
 * rằng FC03 thanh ghi 0..N-1 trả về N giá trị không exception (chương trình benchL2 hiện nạp KHÔNG khai báo %QW nên giá trị là 0 cố
 * định; cổng nghiệm thu chỉ đo CHẤT LƯỢNG truyền thông, không đo giá trị). Trong cú pháp tag của sản phẩm (1-based) đó là
 * `holding:1..N` — `holding:0..N-1` như kế hoạch viết bị bộ phân tích từ chối (mọi tag bad "invalid Modbus register offset: 0").
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

interface TuyChon {
  endpoint: string;
  pollMs: number;
  soTag: number;
  container: string;
  timeoutMs: number;
  kieu: Array<"pause" | "stop">;
  nhanh: Array<"legacy" | "ha">;
  web: string;
  giuMatMs: number;
  /** Số lượt lặp mỗi tổ hợp (nhánh × kiểu); pha rút cáp NGẪU NHIÊN trong chu kỳ poll mỗi lượt. */
  lap: number;
}

function docThamSo(argv: string[]): TuyChon {
  const lay = (k: string, mac: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : mac;
  };
  const kieu = lay("kieu", "ca-hai");
  const nhanh = lay("nhanh", "ca-hai");
  return {
    endpoint: lay("endpoint", "tcp://127.0.0.1:15502"),
    pollMs: Number(lay("poll", "1000")),
    soTag: Number(lay("tags", "18")),
    container: lay("container", "avi-openplc-bench"),
    timeoutMs: Number(lay("timeout", "800")),
    kieu: kieu === "ca-hai" ? ["pause", "stop"] : [kieu as "pause" | "stop"],
    nhanh: nhanh === "ca-hai" ? ["legacy", "ha"] : [nhanh as "legacy" | "ha"],
    web: lay("web", "http://127.0.0.1:18080"),
    giuMatMs: Number(lay("giu-mat", "3000")),
    lap: Math.max(1, Number(lay("lap", "1"))),
  };
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HAN_DO_MS = 15_000;

function docker(...args: string[]): { ms: number; tBatDau: number; tXong: number } {
  const tBatDau = Date.now();
  execFileSync("docker", args, { stdio: "ignore", timeout: 60_000 });
  const tXong = Date.now();
  return { ms: tXong - tBatDau, tBatDau, tXong };
}
function trangThaiContainer(name: string): string {
  return execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" }).trim();
}

const req = createRequire(import.meta.url);
const ModbusRTU: any = (() => {
  const m = req("modbus-serial");
  return m.default ?? m;
})();

function hostPort(endpoint: string): { host: string; port: number } {
  const u = new URL(endpoint.replace(/^tcp:/, "http:"));
  return { host: u.hostname, port: Number(u.port || 502) };
}

/** MỘT lần thăm dò: kết nối mới, đọc holding 0..n-1, đóng. true ⇔ n thanh ghi, không exception, trong hạn. */
async function thamDo(endpoint: string, n: number, hanMs = 500): Promise<boolean> {
  const { host, port } = hostPort(endpoint);
  const c = new ModbusRTU();
  const xong = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), hanMs);
    (async () => {
      try {
        await c.connectTCP(host, { port });
        c.setID(1);
        c.setTimeout(hanMs);
        const r = await c.readHoldingRegisters(0, n);
        clearTimeout(t);
        resolve(Array.isArray(r?.data) && r.data.length === n);
      } catch {
        clearTimeout(t);
        resolve(false);
      }
    })();
  });
  const ok = await xong;
  try {
    c._port?._client?.destroy?.();
    c.close(() => undefined);
  } catch {
    /* bỏ qua */
  }
  return ok;
}

/** Đăng nhập web OpenPLC (openplc/openplc) và bấm Start — như scripts/safety-plc-bench.ts:54-74. */
async function batPlcQuaWeb(web: string): Promise<boolean> {
  try {
    const r = await fetch(web + "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=openplc&password=openplc",
      redirect: "manual",
    });
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return false;
    const s = await fetch(web + "/start_plc", { headers: { cookie }, redirect: "manual" });
    return s.status === 302 || s.status === 200;
  } catch {
    return false;
  }
}

/** Đợi Modbus trả lời (thăm dò mỗi 100 ms); nếu sau `bamStartSauMs` vẫn chưa ⇒ bấm Start qua web (lặp mỗi 2 s). Trả mốc thời gian. */
async function doiModbusTraLoi(o: TuyChon, bamStartSauMs: number, hanMs = 90_000): Promise<{ t: number; daBamStart: boolean }> {
  const t0 = Date.now();
  let daBamStart = false;
  let lanBamCuoi = 0;
  for (;;) {
    if (await thamDo(o.endpoint, o.soTag)) return { t: Date.now(), daBamStart };
    const now = Date.now();
    if (now - t0 > hanMs) throw new Error(`Modbus ${o.endpoint} không trả lời sau ${hanMs} ms`);
    if (now - t0 >= bamStartSauMs && now - lanBamCuoi >= 2000) {
      lanBamCuoi = now;
      if (await batPlcQuaWeb(o.web)) daBamStart = true;
    }
    await ngu(100);
  }
}

/** Hỏi `dk` mỗi `buocMs` tới khi đúng; trả mốc Date.now() lần hỏi đầu tiên đúng, hoặc null nếu quá hạn. */
async function doiDen(dk: () => boolean, buocMs: number, hanMs: number): Promise<number | null> {
  const t0 = Date.now();
  for (;;) {
    if (dk()) return Date.now();
    if (Date.now() - t0 > hanMs) return null;
    await ngu(buocMs);
  }
}

interface KetQuaLuot {
  nhanh: "legacy" | "ha";
  kieu: "pause" | "stop";
  lenhRut: { ms: number };
  lenhCam: { ms: number };
  cong1: number | null;
  cong1TuBatDauLenh: number | null;
  /** Mẫu good cuối cùng so với lúc BẮT ĐẦU lệnh rút (âm = trước). */
  mauTotCuoiTruocRut: number;
  lyDoXau: string;
  cong2: number | null;
  cong3Mat: number | null;
  cong3CoLai: number | null;
  /** DB đã nhận 'connected' (chập chờn) TRƯỚC lúc Modbus thật sự trả lời. */
  dbDaConnectedTruoc: boolean;
  /** Modbus trả lời lại, tính từ lúc lệnh cắm lại trả về. */
  modbusTraLoiSau: number;
  daBamStart: boolean;
  cong4: number | null;
  cong4TuLenhCam: number | null;
  noiLai: number | null;
  ghiDb: string[];
  trangThaiOt: string;
}

async function chayLuot(o: TuyChon, nhanh: "legacy" | "ha", kieu: "pause" | "stop", stt: number): Promise<KetQuaLuot> {
  process.env.OT_CONN_HA_ENABLED = nhanh === "ha" ? "true" : "false";
  await import("../server/services/ot"); // đăng ký driver (như scripts/safety-plc-bench.ts)
  const [{ setAdapterSource }, { createDriver }, ot, tt, boDem] = await Promise.all([
    import("../server/services/ot/deviceAdapter"),
    import("../server/services/ot/driverRegistry"),
    import("../server/services/ot/otManager"),
    import("../server/services/ot/trangThaiAdapter"),
    import("../server/services/scada/boDemHienTai"),
  ]);

  const adapterId = 990_120_500 + stt;
  // Cú pháp địa chỉ của sản phẩm (modbusDecode.parseModbusAddress) là 1-BASED kiểu Modicon: "holding:1" = thanh ghi 0 = %QW0.
  // "holding:0" (cách viết của kế hoạch) bị bộ phân tích TỪ CHỐI ("invalid Modbus register offset: 0") — đo trên bench 23/10.
  const tags = Array.from({ length: o.soTag }, (_, i) => ({ tagKey: `qw${i}`, address: `holding:${i + 1}`, dataType: "int" as const }));
  const adapter = {
    adapterId,
    code: `r0-bench-${nhanh}-${kieu}`,
    machineId: null,
    protocol: "modbus" as const,
    connection: { endpoint: o.endpoint, timeoutMs: o.timeoutMs, options: { unitId: 1, timeoutMs: o.timeoutMs } },
    pollIntervalMs: o.pollMs,
    tags,
    driver: createDriver("modbus"),
  };
  // Chẩn đoán pha: ghi mốc mẫu GOOD cuối cùng (bọc onSample — không đổi hành vi) để biết lần đọc kế tiếp bắt đầu lúc nào so với lúc rút.
  let mauTotCuoi = 0;
  const goc = adapter.driver.subscribe.bind(adapter.driver);
  adapter.driver.subscribe = (t, onSample, i, tc) =>
    goc(
      t,
      (smp) => {
        if (smp.quality === "good") mauTotCuoi = Date.now();
        return onSample(smp);
      },
      i,
      tc,
    );
  setAdapterSource(async () => [adapter]);

  const ghi: Array<{ tt: string; t: number }> = [];
  tt.__datGhiDb(async (id, trangThai) => {
    if (id === adapterId) ghi.push({ tt: trangThai, t: Date.now() }); // lần ghi trễ của adapter lượt trước không tính
  });

  const moiTag = (q: "good" | "bad") =>
    tags.every((t) => {
      const g = boDem.layGiaTri(adapterId, t.tagKey);
      return !!g && g.q === q && (q === "good" ? !g.stale : true);
    });

  if (!(await ot.startOt())) throw new Error("startOt trả false");
  try {
    const tOn = await doiDen(() => tt.layTrangThaiAdapter(adapterId)?.tt === "connected" && moiTag("good"), 50, 30_000);
    if (tOn === null) {
      const g = boDem.layGiaTri(adapterId, tags[0].tagKey);
      throw new Error(
        `adapter không lên connected + ${o.soTag} tag good trong 30 s: trạng thái=${tt.layTrangThaiAdapter(adapterId)?.tt}, tag đầu=${JSON.stringify(g)}, ot=${JSON.stringify(ot.getOtAdapterStatus(adapterId))}`,
      );
    }
    // như lưới stub: lần ghi DB cuối của lúc khởi động đã qua ≥ 6 s; + PHA NGẪU NHIÊN trong một chu kỳ poll (nếu không, mốc rút luôn
    // rơi đúng một nhịp sau lần đọc — đo được: mẫu good cuối luôn ≈ −920 ms ⇒ pha cố định, số đo không đại diện).
    await ngu(11_000 + Math.floor(Math.random() * o.pollMs));

    // ── RÚT CÁP ──
    const lenhRut = kieu === "pause" ? docker("pause", o.container) : docker("stop", "-t", "0", o.container);
    const tRut = lenhRut.tXong;
    const mauTotCuoiTruocRut = mauTotCuoi - lenhRut.tBatDau;
    const soGhiTruoc = ghi.length;
    const [t1, t2, t3] = await Promise.all([
      doiDen(() => moiTag("bad"), 10, HAN_DO_MS),
      doiDen(() => tt.layTrangThaiAdapter(adapterId)?.tt === "lost", 10, HAN_DO_MS),
      doiDen(() => ghi.slice(soGhiTruoc).some((g) => g.tt === "lost"), 10, HAN_DO_MS),
    ]);
    const mau = boDem.layGiaTri(adapterId, tags[0].tagKey);
    const lyDoXau = mau ? `${mau.q}/${mau.reason ?? "-"}/${mau.statusCode ?? "-"}` : "-";
    const tGhiMat = t3 === null ? null : ghi.slice(soGhiTruoc).find((g) => g.tt === "lost")!.t;
    await ngu(o.giuMatMs);

    // ── CẮM LẠI ──
    const lenhCam = kieu === "pause" ? docker("unpause", o.container) : docker("start", o.container);
    // pause: runtime vẫn chạy ⇒ chỉ thăm dò; stop: sau 3 s chưa trả lời ⇒ bấm Start qua web.
    const traLoi = await doiModbusTraLoi(o, kieu === "pause" ? Number.POSITIVE_INFINITY : 3000);
    const coDotMat = t3 !== null; // không có lần ghi 'lost' ⇒ không có chuyển trạng thái nào để DB "khớp lại"
    const [t4, t6, tGhiCoLai] = await Promise.all([
      doiDen(() => moiTag("good"), 10, HAN_DO_MS),
      doiDen(() => tt.layTrangThaiAdapter(adapterId)?.tt === "connected", 10, HAN_DO_MS),
      // 3b: lần ghi 'connected' ĐẦU TIÊN tại/sau lúc Modbus trả lời
      doiDen(() => ghi.some((g) => g.t >= traLoi.t && g.tt === "connected"), 10, coDotMat ? HAN_DO_MS : 0).then((x) =>
        x === null ? null : ghi.find((g) => g.t >= traLoi.t && g.tt === "connected")!.t,
      ),
    ]);
    // Lần ghi cuối TRƯỚC lúc Modbus trả lời (và sau lúc rút) đã là 'connected' ⇒ DB "khớp" từ trước — do liên kết chập chờn qua proxy
    // cổng của Docker Desktop (nhận TCP rồi đóng khi container chưa chạy), không phải do thiết bị đã trả lời. Ghi chú riêng.
    const cuoiTruoc = ghi.filter((g) => g.t > tRut && g.t < traLoi.t).at(-1);
    const dbDaConnectedTruoc = coDotMat && cuoiTruoc?.tt === "connected";
    // Cổng 4 từ lúc Modbus trả lời. t4 chỉ được hỏi SAU mốc đó nên không bao giờ âm; 0 = mọi tag đã tốt ngay lần hỏi đầu (có thể tốt từ
    // TRƯỚC mốc: thăm dò độc lập chỉ chạy mỗi 100 ms, còn lần nối lại đang chờ + lần đọc đầu ngay (D2) có thể xong sớm hơn).
    const tu = (t: number | null, goc: number) => (t === null ? null : t - goc);
    const st = ot.getOtAdapterStatus(adapterId);
    return {
      nhanh,
      kieu,
      lenhRut: { ms: lenhRut.ms },
      lenhCam: { ms: lenhCam.ms },
      cong1: tu(t1, tRut),
      cong1TuBatDauLenh: tu(t1, lenhRut.tBatDau),
      mauTotCuoiTruocRut,
      lyDoXau,
      cong2: tu(t2, tRut),
      cong3Mat: tu(tGhiMat, tRut),
      // T12b fix round 1 — KHÔNG ghi 0 khi DB đã 'connected' giả từ trước: số đo giữ nguyên (thường null — trạng thái không đổi nên không
      // có lần ghi mới), cờ `dbDaConnectedTruoc` là dấu "connected GIẢ" và lượt đó tính KHÔNG ĐẠT cổng 3.
      cong3CoLai: tGhiCoLai === null ? null : tGhiCoLai - traLoi.t,
      dbDaConnectedTruoc,
      modbusTraLoiSau: traLoi.t - lenhCam.tXong,
      daBamStart: traLoi.daBamStart,
      cong4: tu(t4, traLoi.t),
      cong4TuLenhCam: tu(t4, lenhCam.tXong),
      noiLai: tu(t6, traLoi.t),
      ghiDb: ghi.map((g) => `${g.tt}@${g.t - tRut}`),
      trangThaiOt: st ? `${st.state}` : "-",
    };
  } finally {
    // đưa container về trạng thái chạy cho lượt sau (lượt cuối: main() dừng nó)
    try {
      const s = trangThaiContainer(o.container);
      if (s === "paused") docker("unpause", o.container);
      else if (s !== "running") docker("start", o.container);
    } catch {
      /* bỏ qua */
    }
    await ot.stopOt();
    setAdapterSource(null);
    tt.__datGhiDb(null);
  }
}

const fmt = (v: number | null, nguong?: number) =>
  v === null ? `> ${HAN_DO_MS} ms — KHÔNG ĐẠT` : nguong === undefined ? `${v} ms` : `${v} ms — ${v <= nguong ? "ĐẠT" : "KHÔNG ĐẠT"}`;

function inBang(o: TuyChon, k: KetQuaLuot): string {
  const c = o.pollMs * 2;
  return [
    `### ${k.kieu === "pause" ? "docker pause/unpause (đường TREO)" : "docker stop -t 0/start (đường RESET)"} — nhánh ${k.nhanh}`,
    ``,
    `| Cổng | Ngưỡng | Đo được |`,
    `|---|---|---|`,
    `| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ ${c} ms | ${fmt(k.cong1, c)} (từ lúc BẮT ĐẦU lệnh: ${fmt(k.cong1TuBatDauLenh)}; mẫu: ${k.lyDoXau}) |`,
    `| 2. M10 "lost" (trạng thái RAM mà danhSach hiển thị) | ≤ 5000 ms | ${fmt(k.cong2, 5000)} |`,
    `| 3a. ghi DB status='error' sau khi rút | ≤ 5000 ms | ${fmt(k.cong3Mat, 5000)} |`,
    `| 3b. ghi DB status='connected' sau khi Modbus trả lời lại | ≤ 5000 ms | ${k.dbDaConnectedTruoc ? `KHÔNG ĐẠT — "connected" GIẢ: DB đã ghi 'connected' TRƯỚC khi Modbus trả lời (nhận-rồi-đóng TCP trong lúc thiết bị chưa chạy); lần ghi sau mốc: ${k.cong3CoLai === null ? "không có" : `${k.cong3CoLai} ms`}` : k.cong3Mat === null && k.cong3CoLai === null ? "không có chuyển trạng thái (adapter chưa từng 'lost')" : fmt(k.cong3CoLai, 5000)} |`,
    `| 4. Modbus trả lời lại ⇒ mọi tag good (bộ đệm) | ≤ ${c} ms | ${fmt(k.cong4, c)} (từ lúc lệnh cắm lại trả về: ${fmt(k.cong4TuLenhCam)}) |`,
    ``,
    `Chẩn đoán: mẫu good cuối ${k.nhanh === "ha" ? "n/a (HA: supervisor tự tạo driver)" : `${k.mauTotCuoiTruocRut} ms so với lúc bắt đầu lệnh rút`} · lệnh rút ${k.lenhRut.ms} ms · lệnh cắm ${k.lenhCam.ms} ms · Modbus trả lời sau lệnh cắm ${k.modbusTraLoiSau} ms${k.daBamStart ? " (đã bấm Start qua web)" : ""} · RAM 'connected' lại sau Modbus trả lời ${fmt(k.noiLai)} · lệnh ghi DB (ms so với lúc rút): ${k.ghiDb.join(", ") || "(không)"}`,
    ``,
  ].join("\n");
}

/** Bảng tổng hợp mỗi tổ hợp (kiểu × nhánh): mọi lượt, số lượt đạt. */
function tongHop(o: TuyChon, ds: KetQuaLuot[]): string {
  const c = o.pollMs * 2;
  const out: string[] = ["## Tổng hợp", ""];
  for (const kieu of o.kieu) {
    for (const nhanh of o.nhanh) {
      const l = ds.filter((k) => k.kieu === kieu && k.nhanh === nhanh);
      if (l.length === 0) continue;
      const cot = (f: (k: KetQuaLuot) => number | null, nguong: number) => {
        const v = l.map(f);
        const dat = v.filter((x) => x !== null && x <= nguong).length;
        return `${v.map((x) => (x === null ? `>${HAN_DO_MS}` : String(x))).join(" / ")} ms — đạt ${dat}/${v.length}`;
      };
      // 3b: lượt có "connected" GIẢ (DB đã 'connected' trước khi Modbus trả lời) hiện là GIẢ và KHÔNG tính đạt.
      const coLai = l.every((k) => k.cong3Mat === null)
        ? "không có chuyển trạng thái (chưa từng 'lost')"
        : `${l.map((k) => (k.dbDaConnectedTruoc ? "GIẢ" : k.cong3CoLai === null ? `>${HAN_DO_MS}` : String(k.cong3CoLai))).join(" / ")} ms — đạt ${l.filter((k) => !k.dbDaConnectedTruoc && k.cong3CoLai !== null && k.cong3CoLai <= 5000).length}/${l.length}`;
      out.push(
        `### ${kieu === "pause" ? "docker pause/unpause (đường TREO)" : "docker stop -t 0/start (đường RESET)"} — nhánh ${nhanh} — ${l.length} lượt`,
        "",
        "| Cổng | Ngưỡng | Đo được (từng lượt) |",
        "|---|---|---|",
        `| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ ${c} ms | ${cot((k) => k.cong1, c)} |`,
        `| 2. M10 "lost" (RAM, thứ danhSach hiển thị) | ≤ 5000 ms | ${cot((k) => k.cong2, 5000)} |`,
        `| 3a. ghi DB 'error' sau khi rút | ≤ 5000 ms | ${cot((k) => k.cong3Mat, 5000)} |`,
        `| 3b. ghi DB 'connected' sau khi Modbus trả lời | ≤ 5000 ms | ${coLai}${l.some((k) => k.dbDaConnectedTruoc) ? " (GIẢ = DB đã ghi 'connected' TRƯỚC khi Modbus trả lời — \"connected\" giả, KHÔNG ĐẠT)" : ""} |`,
        `| 4. Modbus trả lời ⇒ mọi tag good (bộ đệm) | ≤ ${c} ms | ${cot((k) => k.cong4, c)} |`,
        "",
      );
    }
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const o = docThamSo(process.argv.slice(2));
  // Không DB, không :3000; đúng 4 cờ R0 cần cho đường này (Lab không cần). Đặt TRƯỚC mọi import của server.
  process.env.DATABASE_URL = "";
  process.env.OT_GATEWAY_ENABLED = "true";
  process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
  process.env.OT_GHI_TRANG_THAI_ADAPTER_ENABLED = "true";
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
  process.env.SCADA_SOCKET_ENABLED = "true";
  process.env.OT_STORE_FORWARD_ENABLED = "false";
  process.env.OT_POLL_BATCH_ENABLED = "false";
  process.env.OT_TAG_DEADBAND_ENABLED = "false";
  process.env.OT_INGEST_TO_UNS = "false";
  delete process.env.OT_LEGACY_RECONNECT_MS; // mặc định sản phẩm

  const banDau = trangThaiContainer(o.container);
  const anh = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}} {{.Image}}", o.container], { encoding: "utf8" }).trim();
  console.log(`[bench] container ${o.container}: trạng thái ban đầu=${banDau}; ảnh ${anh}`);
  if (banDau === "paused") docker("unpause", o.container);
  else if (banDau !== "running") docker("start", o.container);
  const dau = await doiModbusTraLoi(o, 3000);
  console.log(`[bench] Modbus ${o.endpoint} trả lời holding 0..${o.soTag - 1} (FC03, ${o.soTag} thanh ghi, không exception)${dau.daBamStart ? " — đã bấm Start qua web" : ""}`);

  const { setTelemetryPersistFn } = await import("../server/services/telemetryBus");
  let soHang = 0;
  setTelemetryPersistFn(async (rows) => {
    soHang += rows.length;
    return rows.length;
  });

  const ketQua: KetQuaLuot[] = [];
  let stt = 0;
  try {
    for (const nhanh of o.nhanh) {
      for (const kieu of o.kieu) for (let lap = 1; lap <= o.lap; lap++) {
        stt += 1;
        console.log(`[bench] lượt ${stt}: nhánh ${nhanh}, ${kieu} …`);
        // trước mỗi lượt: bản đồ địa chỉ phải trả lời
        await doiModbusTraLoi(o, 3000);
        const k = await chayLuot(o, nhanh, kieu, stt);
        ketQua.push(k);
        console.log(inBang(o, k));
      }
    }
  } finally {
    setTelemetryPersistFn(null);
    // trả container về đúng trạng thái đã gặp
    try {
      const s = trangThaiContainer(o.container);
      if (banDau !== "running" && banDau !== "paused" && s !== "exited") docker("stop", o.container);
      if (banDau === "paused" && s === "running") docker("pause", o.container);
      console.log(`[bench] container trả về: ${trangThaiContainer(o.container)} (ban đầu: ${banDau})`);
    } catch (e) {
      console.warn(`[bench] không trả được trạng thái container: ${(e as Error).message}`);
    }
  }
  console.log(tongHop(o, ketQua));
  console.log(`[bench] số hàng telemetry đi qua bus (seam ghi): ${soHang}`);
  console.log(`[bench] JSON ${JSON.stringify({ tuyChon: { ...o }, ketQua })}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[bench] lỗi:", e);
    process.exit(1);
  },
);
