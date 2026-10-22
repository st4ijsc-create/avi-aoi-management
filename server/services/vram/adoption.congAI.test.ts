/**
 * ★★★ Audit orphanHolders 2026-10-22 — llama-server :8091 (server AI đang phục vụ) KHÔNG ĐƯỢC đi tới `SIGTERM` của đường thu hồi nhận nuôi.
 *
 * HIỆN TRẠNG ĐÃ ĐO (dev, `vram_events`): 920/958 sự kiện `baseline_foreign_pid` có llama-server trong `orphanHolders` (30 pid khác nhau) vì
 * `LLAMA_SERVER_BIN` là MỘT ảnh thực thi dùng chung cho sidecar thị giác (:8081) lẫn server AI (:8091) và bộ phân loại chỉ nhìn ảnh thực thi. Chỉ còn MỘT
 * so khớp chuỗi con `--port 8081` đứng giữa :8091 và `process.kill`. Bộ ca này khoá BA LỚP độc lập (mỗi lớp một nhóm ca, mỗi lớp có đột biến riêng):
 *   P1 PHÂN LOẠI   server AI → `peers` (không bao giờ là ứng viên nhận nuôi);
 *   P2 NHẬN NUÔI   cổng theo RANH GIỚI TOKEN + DENY cổng AI + cấu hình tự mâu thuẫn ⇒ không nhận nuôi + báo MỘT lần;
 *   P3 ĐƯỜNG GIẾT  đọc lại dòng lệnh (ảnh + cổng + không cổng AI) và KHOÁ KHE trước `SIGTERM`; (P3b) khoá khe cũng chặn NHẬN NUÔI;
 *   P4 DẤU VẾT     sự kiện `adopt_orphan` / `reclaim_orphan` (trước đó chỉ có một dòng console).
 *
 * ⚠ Mỗi nhóm có ca ĐỐI CHỨNG DƯƠNG (cùng fixture, chỉ khác chiều đang kiểm ⇒ VẪN nhận nuôi / VẪN giết) — thiếu nó, "không nhận nuôi" có thể xanh vì
 * fixture hỏng chứ không vì bất biến được giữ.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;
const KHOI = 17_000 * MIB;
const DESKTOP = 1_000 * MIB;
const CEILING = 32_607 * MIB;
const BIN = "D:\\SOURCES\\16.AI\\llama-cuda\\llama-server.exe";
const CONG_VISION = 8081;
const CONG_AI = 8091;

let thietBiUsedBytes = DESKTOP;
vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => ({ usedBytes: thietBiUsedBytes, totalBytes: CEILING, source: "smi" as const }),
  __clearProbeCache: () => {},
}));

type Holder = { pid: number; name: string };
type Proc = { pid: number; ppid: number; cmdline: string; ctime: number };
let hoGiuGpu: { holders: Holder[]; ours: Holder[]; peers: Holder[]; orphans: Holder[]; thirdParty: Holder[] } | null = null;
let bangTienTrinh: Proc[] | null = null;
vi.mock("./vramGpuHolders", async (goc) => {
  const that = await goc<typeof import("./vramGpuHolders")>();
  return { ...that, readGpuHolders: async () => hoGiuGpu, readProcTable: async () => bangTienTrinh };
});

const suKien: Array<{ event: string; owner: string; detail?: Record<string, unknown> }> = [];
vi.mock("./vramEventLog", async (goc) => {
  const that = await goc<typeof import("./vramEventLog")>();
  return { ...that, logVramEvent: (e: { event: string; owner: string; detail?: Record<string, unknown> }) => void suKien.push(e) };
});

import { __resetBrokerForTests, snapshot } from "./vramBroker";
import { __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests } from "./vramSharedLedger";
import type { SharedLeaseRow, SharedLedgerWrite } from "./vramSharedLedger";
import { __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests } from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import { __pidDangNhanNuoi, __resetVramBaselineForTests, __runReconcileTick, thuHoiHoNhanNuoi } from "./vramReconciler";
import { __resetDecisionTickForTests } from "./vramTickCell";
import { lapKeHoachNhanNuoi, lyDoTuChoiGiet, moTaSidecarNhanNuoi, ownerNhanNuoi } from "./vramAdoption";
import { CONG_AI_MAC_DINH, cacCongAI, congTrongDongLenh, dongLenhMangCong, dongLenhMangCongAI } from "./vramAiPorts";
import { classifyHolders } from "./vramGpuHolders";
import { __xoaBoNhoKhoaKhe } from "../ai/khoaKhe";

class BangDungChung implements SharedLedgerGateway {
  rows = new Map<string, SharedLeaseRow>();
  async apply(writes: readonly SharedLedgerWrite[]): Promise<void> {
    for (const w of writes) {
      if (w.op === "upsert") this.rows.set(w.leaseKey, w.row);
      else this.rows.delete(w.leaseKey);
    }
  }
  async selectAll(): Promise<readonly SharedLeaseRow[]> {
    return [...this.rows.values()];
  }
}
let bang: BangDungChung;

function ft(unixMs: number): number {
  return (unixMs + 11_644_473_600_000) * 10_000;
}
const SELF = "worker:1001:5000";
const DESK: Holder[] = [{ pid: 7824, name: "C:\\Windows\\explorer.exe" }];
const procServer: Proc = { pid: 1001, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(9_000) };
/** Hộ llama-server mồ côi: cha (pid 60001) KHÔNG có trong bảng ⇒ đúng hình dạng đo được trên dev (pid 2188, ppid đã chết). */
const llama = (pid: number, port: number | string, ctime = ft(1_000), extra = ""): Proc => ({
  pid, ppid: 60001, cmdline: `${BIN} -m model.gguf --port ${port} --jinja ${extra}`.trim(), ctime,
});
function census(orphans: Holder[], peers: Holder[] = []) {
  return { holders: [...orphans, ...peers, ...DESK], ours: [], peers, orphans, thirdParty: DESK };
}

const duongKhoa = (): string => {
  const d = process.env.LLAMA_WATCHDOG_PAUSE_FILE;
  if (!d) throw new Error("vitest.setup.ts phải đặt LLAMA_WATCHDOG_PAUSE_FILE về thư mục tạm của lượt chạy (khoá khe thật trên máy sẽ làm ca đỏ ngẫu nhiên)");
  return d;
};
function datKhoaKhe(conHan = true): void {
  fs.writeFileSync(duongKhoa(), JSON.stringify({ chu: "phep-do-test", lyDo: "đo 27B", hetHan: Date.now() + (conHan ? 60_000 : -1_000) }));
  __xoaBoNhoKhoaKhe();
}
function goKhoaKhe(): void {
  fs.rmSync(duongKhoa(), { force: true });
  __xoaBoNhoKhoaKhe();
}

beforeEach(() => {
  bang = new BangDungChung();
  thietBiUsedBytes = DESKTOP;
  hoGiuGpu = census([]);
  bangTienTrinh = null;
  suKien.length = 0;
  process.env.LLAMA_SERVER_BIN = BIN;
  process.env.LLAMA_VISION_PORT = String(CONG_VISION);
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${CONG_AI}`;
  process.env.VRAM_SIDECAR_ESTIMATE_MB = "17000";
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(bang);
  __setSharedLedgerSelfKeyForTests(SELF);
  goKhoaKhe();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  goKhoaKhe();
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  delete process.env.VRAM_SIDECAR_ESTIMATE_MB;
  delete process.env.LLAMA_SERVER_URL;
  delete process.env.LLAMA_FIM_SERVER_URL;
  delete process.env.LLAMA_SERVER_PORT;
  delete process.env.LLAMA_CODER_PORT;
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("A. vramAiPorts — cổng AI + so khớp cổng theo RANH GIỚI TOKEN", () => {
  it("cổng AI luôn gồm 8091 mặc định, kể cả khi chưa đặt biến nào", () => {
    expect(cacCongAI({})).toEqual([CONG_AI_MAC_DINH]);
    expect(CONG_AI_MAC_DINH).toBe(8091);
  });

  it("đọc đủ bốn nguồn: LLAMA_SERVER_URL · LLAMA_FIM_SERVER_URL · LLAMA_SERVER_PORT · LLAMA_CODER_PORT; bỏ giá trị hỏng", () => {
    expect(
      cacCongAI({
        LLAMA_SERVER_URL: "http://127.0.0.1:8095/",
        LLAMA_FIM_SERVER_URL: "http://localhost:8092",
        LLAMA_SERVER_PORT: "8093",
        LLAMA_CODER_PORT: "8090",
      }),
    ).toEqual([8090, 8091, 8092, 8093, 8095]);
    expect(cacCongAI({ LLAMA_SERVER_URL: "khong-phai-url", LLAMA_SERVER_PORT: "0", LLAMA_CODER_PORT: "99999", LLAMA_FIM_SERVER_URL: "http://h" })).toEqual([8091]);
  });

  it("★ dòng lệnh: `--port N` và `--port=N` theo TOKEN; cổng là tiền tố/hậu tố của số khác KHÔNG khớp", () => {
    expect(congTrongDongLenh(`${BIN} -m a.gguf --port 8091 --jinja`)).toEqual([8091]);
    expect(congTrongDongLenh(`"${BIN}" --port=8081`)).toEqual([8081]);
    expect(dongLenhMangCong(`${BIN} --port 80810`, 8081), "8081 là tiền tố của 80810").toBe(false);
    expect(dongLenhMangCong(`${BIN} --port 8091`, 809), "809 là tiền tố của 8091").toBe(false);
    expect(dongLenhMangCong(`${BIN} --port 18081`, 8081)).toBe(false);
    expect(dongLenhMangCong(`${BIN} --port 8081x`, 8081)).toBe(false);
    expect(dongLenhMangCong(`${BIN} --xport 8081`, 8081), "`--xport` không phải `--port`").toBe(false);
    expect(dongLenhMangCong(`${BIN} --port 8081`, 8081)).toBe(true);
    expect(dongLenhMangCong("", 8081)).toBe(false);
  });

  it("dongLenhMangCongAI: chỉ true khi MỘT `--port` thuộc tập cổng AI", () => {
    expect(dongLenhMangCongAI(`${BIN} --port 8091`, [8091])).toBe(true);
    expect(dongLenhMangCongAI(`${BIN} --port 8081`, [8091])).toBe(false);
    expect(dongLenhMangCongAI(`${BIN} --port 8081 --port 8091`, [8091]), "hai --port: một cái là cổng AI ⇒ vẫn là server AI").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("B. P1 — PHÂN LOẠI: server AI là `peers`, sidecar thị giác mồ côi vẫn là `orphans`", () => {
  const roots = [1001];
  function phanLoai(procs: Proc[], holders: Holder[], congAI?: readonly number[]) {
    return classifyHolders({
      holders: [...holders, ...DESK], procs: [procServer, ...procs], roots, ownExecutables: [BIN], appRoot: "D:\\SOURCES\\avi-aoi-management",
      ...(congAI === undefined ? {} : { congAI }),
    });
  }

  it("★★★ B-1: llama-server `--port 8091` (cha đã chết) ⇒ `peers`, KHÔNG phải `orphans`", () => {
    const c = phanLoai([llama(2188, CONG_AI)], [{ pid: 2188, name: BIN }], [CONG_AI]);
    expect(c.peers.map((h) => h.pid)).toEqual([2188]);
    expect(c.orphans).toEqual([]);
  });

  it("★ B-2 (đối chứng dương): sidecar `--port 8081` cùng ảnh, cùng cha chết ⇒ VẪN `orphans`", () => {
    const c = phanLoai([llama(31337, CONG_VISION)], [{ pid: 31337, name: BIN }], [CONG_AI]);
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
    expect(c.peers).toEqual([]);
  });

  it("B-3: cổng LẠ (không phải AI, không phải vision) ⇒ giữ nguyên phân loại cũ = `orphans`", () => {
    const c = phanLoai([llama(40000, 9099)], [{ pid: 40000, name: BIN }], [CONG_AI]);
    expect(c.orphans.map((h) => h.pid)).toEqual([40000]);
  });

  it("B-4: không truyền `congAI` ⇒ hành vi cũ (server :8091 vẫn `orphans`) — chứng minh chính tham số này lái ca B-1", () => {
    const c = phanLoai([llama(2188, CONG_AI)], [{ pid: 2188, name: BIN }]);
    expect(c.orphans.map((h) => h.pid)).toEqual([2188]);
  });

  it("B-5: hai server cùng lúc — chỉ cái mang cổng AI sang `peers`, cái còn lại ở `orphans`", () => {
    const c = phanLoai([llama(2188, CONG_AI), llama(31337, CONG_VISION)], [{ pid: 2188, name: BIN }, { pid: 31337, name: BIN }], [CONG_AI]);
    expect(c.peers.map((h) => h.pid)).toEqual([2188]);
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
  });

  it("B-6: tiến trình KHÔNG chạy mã của hệ (thirdParty) mang `--port 8091` KHÔNG bị nâng thành anh em", () => {
    const c = phanLoai(
      [{ pid: 5000, ppid: 60001, cmdline: "C:\\Other\\ollama.exe serve --port 8091", ctime: ft(1_000) }],
      [{ pid: 5000, name: "C:\\Other\\ollama.exe" }],
      [CONG_AI],
    );
    expect(c.thirdParty.map((h) => h.pid)).toContain(5000);
    expect(c.peers).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("C. P2 — KẾ HOẠCH NHẬN NUÔI: cổng theo token, DENY cổng AI, cấu hình mâu thuẫn", () => {
  function ke(cmdline: string, over: Partial<Parameters<typeof lapKeHoachNhanNuoi>[0]> = {}) {
    return lapKeHoachNhanNuoi({
      selfKey: SELF,
      rows: [],
      procs: [procServer, { pid: 31337, ppid: 60001, cmdline, ctime: ft(1_000) }],
      orphans: [{ pid: 31337, name: BIN }],
      pidDaNhanNuoi: [],
      sidecar: moTaSidecarNhanNuoi(),
      congAI: [CONG_AI],
      ...over,
    });
  }

  it("★ C-0 (đối chứng dương): sidecar `--port 8081` ⇒ nhận nuôi, cấu hình hợp lệ", () => {
    const k = ke(`${BIN} -m a.gguf --port 8081 --jinja`);
    expect(k.nhanNuoi.map((n) => n.pid)).toEqual([31337]);
    expect(k.cauHinhSai).toBeNull();
  });

  it("★★★ C-1: dòng lệnh mang cổng AI 8091 (bin trùng) ⇒ KHÔNG nhận nuôi, ngay cả khi lọt vào `orphans`", () => {
    expect(ke(`${BIN} -m a.gguf --port 8091 --jinja`).nhanNuoi).toEqual([]);
  });

  it("★★★ C-2: RANH GIỚI TOKEN — `--port 80810` và `--port 8081x` KHÔNG khớp cổng sidecar 8081 (trước đây `includes` khớp chuỗi con)", () => {
    expect(ke(`${BIN} -m a.gguf --port 80810`).nhanNuoi).toEqual([]);
    expect(ke(`${BIN} -m a.gguf --port 8081x`).nhanNuoi).toEqual([]);
    expect(ke(`${BIN} -m a.gguf --port=8081`).nhanNuoi.map((n) => n.pid), "dạng `--port=8081` hợp lệ").toEqual([31337]);
  });

  it("★★★ C-3: dòng lệnh mang CẢ cổng sidecar lẫn cổng AI ⇒ DENY thắng", () => {
    expect(ke(`${BIN} --port 8081 --port 8091`).nhanNuoi).toEqual([]);
  });

  it("★★★ C-4: LLAMA_VISION_PORT TRÙNG cổng AI ⇒ cấu hình sai, KHÔNG nhận nuôi hộ nào (kể cả hộ khớp cổng ấy)", () => {
    const k = ke(`${BIN} --port 8091`, { sidecar: { binPath: BIN, port: CONG_AI, bytes: KHOI } });
    expect(k.nhanNuoi).toEqual([]);
    expect(k.cauHinhSai).toMatch(/TRÙNG cổng/);
    expect(k.cauHinhSai).toContain("8091");
  });

  it("C-5: không truyền `congAI` ⇒ hành vi cũ về phần DENY (đối chứng cho ca C-1)", () => {
    expect(ke(`${BIN} -m a.gguf --port 8091`, { congAI: undefined }).nhanNuoi, "cổng 8091 ≠ cổng sidecar 8081 ⇒ vẫn không khớp").toEqual([]);
    expect(ke(`${BIN} --port 8081 --port 8091`, { congAI: undefined }).nhanNuoi.map((n) => n.pid), "…nhưng DENY chỉ tồn tại khi có congAI").toEqual([31337]);
  });

  it("C-6 (P3b): khoá khe đang giữ ⇒ KHÔNG nhận nuôi, đếm số hộ bị hoãn", () => {
    const k = ke(`${BIN} --port 8081`, { khoaKheDangGiu: true });
    expect(k.nhanNuoi).toEqual([]);
    expect(k.hoanViKhoaKhe).toBe(1);
    expect(ke(`${BIN} --port 8081`, { khoaKheDangGiu: false }).nhanNuoi.map((n) => n.pid)).toEqual([31337]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("D. P3 — lyDoTuChoiGiet (thuần): ảnh + cổng đã khai + không cổng AI", () => {
  const sc = { binPath: BIN, port: CONG_VISION, bytes: KHOI };
  it("hợp lệ ⇒ null; từng chiều sai ⇒ có lý do", () => {
    expect(lyDoTuChoiGiet(`${BIN} -m a.gguf --port 8081`, sc, [CONG_AI])).toBeNull();
    expect(lyDoTuChoiGiet(`"${BIN}" --port 8081`, sc, [CONG_AI]), "ảnh có dấu nháy").toBeNull();
    expect(lyDoTuChoiGiet(`${BIN} --port 8091`, sc, [CONG_AI])).toMatch(/cổng của server AI/);
    expect(lyDoTuChoiGiet(`${BIN} --port 8081 --port 8091`, sc, [CONG_AI])).toMatch(/cổng của server AI/);
    expect(lyDoTuChoiGiet(`${BIN} --port 9099`, sc, [CONG_AI])).toMatch(/không mang --port 8081/);
    expect(lyDoTuChoiGiet(`${BIN} --port 80810`, sc, [CONG_AI]), "cổng theo token").toMatch(/không mang --port 8081/);
    expect(lyDoTuChoiGiet("C:\\Windows\\notepad.exe --port 8081", sc, [CONG_AI])).toMatch(/ảnh thực thi/);
    expect(lyDoTuChoiGiet("", sc, [CONG_AI]), "không đọc được dòng lệnh").toMatch(/KHÔNG đọc được dòng lệnh/);
    expect(lyDoTuChoiGiet(undefined, sc, [CONG_AI])).toMatch(/KHÔNG đọc được dòng lệnh/);
    expect(lyDoTuChoiGiet(`${BIN} --port 8081`, null, [CONG_AI])).toMatch(/chưa cấu hình sidecar/);
    expect(lyDoTuChoiGiet(`${BIN} --port 8091`, { ...sc, port: CONG_AI }, [CONG_AI])).toMatch(/trùng cổng server AI/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("E. ĐƯỜNG THẬT — nhịp đối chiếu + thu hồi (P1 → P2 → P3 → P4 nối nhau)", () => {
  const SIDECAR: Holder = { pid: 31337, name: BIN };
  function cua(pidConGiuGpu: readonly number[] | null, ghi?: { giet: number[] }) {
    let t = 0;
    return {
      giet: (p: number) => void ghi?.giet.push(p),
      docPidGiuGpu: async () => pidConGiuGpu,
      nghi: async () => {},
      now: () => (t += 1_000),
    };
  }
  /** Dựng thế giới: sidecar mồ côi (hoặc server AI) cho nhịp chạy. */
  async function nhanNuoiSidecar(): Promise<void> {
    bangTienTrinh = [procServer, llama(31337, CONG_VISION)];
    hoGiuGpu = census([SIDECAR]);
    thietBiUsedBytes = DESKTOP + KHOI;
    await __runReconcileTick();
  }

  it("★★★ E-1 (đối chứng dương): sidecar :8081 mồ côi ⇒ nhận nuôi ⇒ thu hồi ⇒ giết ĐÚNG pid + sự kiện P4", async () => {
    await nhanNuoiSidecar();
    expect(__pidDangNhanNuoi()).toEqual([31337]);
    const adopt = suKien.filter((e) => e.event === "adopt_orphan");
    expect(adopt.length, "P4: nhận nuôi PHẢI để lại sự kiện truy được").toBe(1);
    expect(adopt[0]!.owner).toBe(ownerNhanNuoi(31337));
    expect(adopt[0]!.detail).toMatchObject({ pid: 31337, reclaimer: "orphan-pid", congSidecar: CONG_VISION });

    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(true);
    expect(ghi.giet).toEqual([31337]);
    const rec = suKien.filter((e) => e.event === "reclaim_orphan");
    expect(rec.map((e) => e.detail?.outcome)).toEqual(["killed-confirmed"]);
  });

  it("★★★ E-2: server AI :8091 (cha chết) đi qua CHUỖI THẬT classifyHolders → nhịp ⇒ là `peers`, KHÔNG nhận nuôi, KHÔNG lease", async () => {
    const procs = [procServer, llama(2188, CONG_AI)];
    bangTienTrinh = procs;
    const c = classifyHolders({ holders: [{ pid: 2188, name: BIN }, ...DESK], procs, roots: [1001], ownExecutables: [BIN], appRoot: "D:\\SOURCES\\avi-aoi-management", congAI: cacCongAI() });
    expect(c.peers.map((h) => h.pid), "tiền đề: P1 đã đưa nó sang peers").toEqual([2188]);
    hoGiuGpu = c;
    thietBiUsedBytes = DESKTOP + KHOI;
    await __runReconcileTick();
    expect(__pidDangNhanNuoi()).toEqual([]);
    expect(snapshot().leases).toEqual([]);
    expect(suKien.filter((e) => e.event === "adopt_orphan")).toEqual([]);
  });

  it("★★★ E-3 (độc lập P1): dù hộ :8091 VẪN nằm trong `orphans` (P1 bị bỏ qua) thì P2 vẫn không nhận nuôi", async () => {
    bangTienTrinh = [procServer, llama(2188, CONG_AI)];
    hoGiuGpu = census([{ pid: 2188, name: BIN }]);
    thietBiUsedBytes = DESKTOP + KHOI;
    await __runReconcileTick();
    expect(__pidDangNhanNuoi()).toEqual([]);
    expect(snapshot().leases).toEqual([]);
  });

  it("★★ E-4: LLAMA_VISION_PORT = cổng AI ⇒ log CẤU HÌNH SAI đúng MỘT lần qua nhiều nhịp, và không nhận nuôi", async () => {
    process.env.LLAMA_VISION_PORT = String(CONG_AI);
    bangTienTrinh = [procServer, llama(2188, CONG_AI)];
    hoGiuGpu = census([{ pid: 2188, name: BIN }]);
    thietBiUsedBytes = DESKTOP + KHOI;
    await __runReconcileTick();
    await __runReconcileTick();
    await __runReconcileTick();
    expect(__pidDangNhanNuoi()).toEqual([]);
    const loi = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("CẤU HÌNH SAI"));
    expect(loi.length, "đúng MỘT dòng, không lặp mỗi nhịp 60 s").toBe(1);
  });

  it("★★★ E-5 (P3b): khoá khe còn hạn ⇒ KHÔNG nhận nuôi; gỡ khoá ⇒ nhận nuôi", async () => {
    datKhoaKhe(true);
    await nhanNuoiSidecar();
    expect(__pidDangNhanNuoi(), "khoá khe đang giữ").toEqual([]);
    goKhoaKhe();
    await __runReconcileTick();
    expect(__pidDangNhanNuoi(), "hết khoá ⇒ nhận nuôi như thường").toEqual([31337]);
  });

  it("★★★ E-6 (P3): đã nhận nuôi, nhưng cùng pid + cùng ctime giờ mang `--port 8091` ⇒ KHÔNG giết, giữ lease", async () => {
    await nhanNuoiSidecar();
    bangTienTrinh = [procServer, llama(31337, CONG_AI)]; // ctime y nguyên (ft(1000)) ⇒ vượt cổng mốc-tạo
    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    expect(ghi.giet).toEqual([]);
    expect(__pidDangNhanNuoi()).toEqual([31337]);
    expect(snapshot().totalReservedBytes).toBe(KHOI);
    expect(suKien.filter((e) => e.event === "reclaim_orphan").map((e) => e.detail?.outcome)).toEqual(["refused-cmdline"]);
  });

  it("★★ E-7 (P3): ảnh thực thi đã đổi / dòng lệnh rỗng ⇒ KHÔNG giết", async () => {
    await nhanNuoiSidecar();
    const ghi = { giet: [] as number[] };
    bangTienTrinh = [procServer, { pid: 31337, ppid: 60001, cmdline: "C:\\Windows\\notepad.exe --port 8081", ctime: ft(1_000) }];
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    bangTienTrinh = [procServer, { pid: 31337, ppid: 60001, cmdline: "", ctime: ft(1_000) }];
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    expect(ghi.giet).toEqual([]);
    expect(__pidDangNhanNuoi()).toEqual([31337]);
  });

  it("★★★ E-8 (P3): khoá khe còn hạn ngay trước SIGTERM ⇒ KHÔNG giết; gỡ khoá ⇒ giết", async () => {
    await nhanNuoiSidecar();
    datKhoaKhe(true);
    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    expect(ghi.giet).toEqual([]);
    expect(snapshot().totalReservedBytes).toBe(KHOI);
    expect(suKien.filter((e) => e.event === "reclaim_orphan").map((e) => e.detail?.outcome)).toEqual(["refused-khoa-khe"]);
    goKhoaKhe();
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(true);
    expect(ghi.giet).toEqual([31337]);
  });

  it("E-9 (P4): thiết bị vẫn thấy pid sau SIGTERM ⇒ sự kiện `kill-sent-not-confirmed`, lease giữ nguyên", async () => {
    await nhanNuoiSidecar();
    expect(await thuHoiHoNhanNuoi(31337, cua([7824, 31337]))).toBe(false);
    expect(suKien.filter((e) => e.event === "reclaim_orphan").map((e) => e.detail?.outcome)).toEqual(["kill-sent-not-confirmed"]);
    expect(__pidDangNhanNuoi()).toEqual([31337]);
  });
});
