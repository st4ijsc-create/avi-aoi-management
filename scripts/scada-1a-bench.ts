/**
 * SCADA 1a — bench chi phí VÒNG ĐẨY DUY NHẤT của `scada:subscribe` (scada-ui §6 Q3): N socket × M đăng ký × T tag, đo thời gian MỘT bước
 * vòng (50 ms) khi (a) không gì đổi (chỉ kiểm hạn), (b) bước có tick cho mọi đăng ký, (c) mọi tag đổi trước MỖI bước (tồi nhất),
 * (d) mọi tag đổi mỗi 1 s (poll 1 s không deadband). CHẠY TAY, không CI:
 *
 *   npx tsx scripts/scada-1a-bench.ts [--socket 200] [--dk 3] [--tag 150] [--lap 200]
 *
 * Trong tiến trình, KHÔNG CSDL, KHÔNG mạng, KHÔNG :3000/:8091/GPU. Socket giả (emit = đếm byte JSON, như chi phí tuần tự hoá của socket.io).
 * Người dùng `admin` (checkPermission đoản mạch, không chạm DB) + cổng phạm vi tiêm toàn quyền; bộ đệm THẬT nuôi bằng `napTuOt`.
 * Bước vòng gọi qua `__motBuocChoTest()` (cùng hàm bộ hẹn gọi) — đo đúng chi phí CPU của vòng, không gồm I/O socket thật.
 */
process.env.SCADA_SOCKET_ENABLED = "true";
process.env.SCADA_LIVE_CACHE_ENABLED = "true";
process.env.RBAC_SCOPED_ADMIN = "false";

const thamSo = (ten: string, md: number): number => {
  const i = process.argv.indexOf(`--${ten}`);
  return i > 0 ? Number(process.argv[i + 1]) : md;
};
const N = thamSo("socket", 200);
const M = thamSo("dk", 3);
const T = thamSo("tag", 150);
const LAP = thamSo("lap", 200);
const SO_ADAPTER = 5;

async function main(): Promise<void> {
  const { __datCongPhamViChoTest } = await import("../server/_core/socketPhongQuyen");
  const bd = await import("../server/services/scada/boDemHienTai");
  const sc = await import("../server/services/scada/scadaSocket");
  __datCongPhamViChoTest({ trongPhamVi: async () => true, idsTrongPhamVi: async () => null });
  for (let a = 1; a <= SO_ADAPTER; a++) bd.datThongTinAdapter(a, { pollMs: 1000, coDeadband: false, machineId: a, code: `B${a}` });
  const tagKeys = Array.from({ length: T }, (_, i) => `t${i}`);
  const napTatCa = (v: number) => {
    for (let a = 1; a <= SO_ADAPTER; a++) {
      bd.napTuOt({ adapterId: a, machineId: a }, tagKeys.filter((_, i) => i % SO_ADAPTER === a - 1).map((tagKey) => ({ tagKey, raw: v, value: v, quality: "good" as const, timestamp: new Date() })));
    }
  };
  napTatCa(1);

  let soKhung = 0;
  let soByte = 0;
  const dem = { delta: 0, tick: 0 };
  const sockets: any[] = [];
  for (let s = 0; s < N; s++) {
    const handlers = new Map<string, (p: unknown) => unknown>();
    const sk = {
      data: { clientType: "browser", user: { id: s + 1, role: "admin" } } as Record<string, unknown>,
      emit: (ev: string, p: unknown) => {
        soKhung++;
        soByte += JSON.stringify(p).length;
        if (ev === "scada:delta") dem.delta++;
        if (ev === "scada:tick") dem.tick++;
      },
      on: (ev: string, cb: (p: unknown) => unknown) => void handlers.set(ev, cb),
    };
    sc.registerScadaHandlers(sk as never);
    for (let d = 0; d < M; d++) {
      await handlers.get("scada:subscribe")!({ subId: `d${d}`, capMs: d === 0 ? 100 : 1000, tags: tagKeys.map((tagKey, i) => ({ adapterId: (i % SO_ADAPTER) + 1, tagKey })) });
    }
    sockets.push(sk);
  }
  if (!sc.__vongDangChay()) throw new Error("vòng không chạy — đăng ký hỏng");

  const doBuoc = (ten: string, truoc: () => void, lap: number) => {
    const ms: number[] = [];
    soKhung = 0;
    soByte = 0;
    for (let i = 0; i < lap; i++) {
      truoc();
      const t = process.hrtime.bigint();
      sc.__motBuocChoTest();
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    ms.sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))].toFixed(3);
    console.log(`${ten.padEnd(44)} p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · max ${ms[ms.length - 1].toFixed(3)} ms · khung/bước ${(soKhung / lap).toFixed(0)} · byte/bước ${(soByte / lap).toFixed(0)}`);
  };

  console.log(`SCADA 1a bench: ${N} socket × ${M} đăng ký (1 × capMs 100 + ${M - 1} × 1000) × ${T} tag (${SO_ADAPTER} adapter) — ${N * M} đăng ký, lặp ${LAP}`);
  // (a) bước thường: không đổi, phần lớn bước không tới hạn tick (bộ đếm bước toàn cục ⇒ lấy trung bình 20 bước/giây gồm 1 bước tick)
  doBuoc("(a) 1 giây vòng (20 bước, có 1 lượt tick)", () => undefined, LAP);
  // (b) chỉ đo các bước tick: 20 bước một lần (đẩy tới hạn tick bằng cách chạy 19 bước không đo)
  const tickMs: number[] = [];
  for (let i = 0; i < Math.max(5, Math.floor(LAP / 20)); i++) {
    for (let k = 0; k < 19; k++) sc.__motBuocChoTest();
    soKhung = 0;
    soByte = 0;
    const t = process.hrtime.bigint();
    sc.__motBuocChoTest();
    tickMs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  tickMs.sort((a, b) => a - b);
  console.log(`(b) bước có tick cho mọi đăng ký             p50 ${tickMs[Math.floor(tickMs.length / 2)].toFixed(3)} ms · max ${tickMs[tickMs.length - 1].toFixed(3)} ms · tick/bước ${dem.tick > 0 ? N * M : 0} · byte ${soByte}`);
  // (c) mọi tag đổi trước mỗi bước (tồi nhất: poll không deadband, mọi mẫu là "đổi")
  let v = 2;
  doBuoc("(c) mọi tag đổi trước mỗi bước (delta)", () => napTatCa(v++), LAP);
  // (d) thực tế hơn: poll 1 s không deadband ⇒ mọi tag "đổi" MỘT lần mỗi 20 bước (trung bình theo bước, gồm tick)
  let b = 0;
  doBuoc("(d) mọi tag đổi mỗi 1 s (trung bình mỗi bước)", () => {
    if (b++ % 20 === 0) napTatCa(v++);
  }, LAP);
  console.log(`tổng khung đã phát: delta ${dem.delta}, tick ${dem.tick}`);
  sc.__datLaiScadaSocket();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
