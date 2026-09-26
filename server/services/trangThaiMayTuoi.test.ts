/**
 * Đợt 34 (Pareto #1) — MỘT hợp đồng trạng thái máy: nhịp tim quyết định, THUẦN (không DB).
 *
 * Mọi ca dựng từ SỐ ĐO THẬT 2026-09-10 (`.qa-dot34/truoc/db-may-14.json`, `db-may-18.json`):
 *   máy 14: log `online` ~3 ngày (một lần khởi động lại) · `operationStatus=stopped`  · nhịp tim 54 ngày
 *   máy 18: log `online` ~3 ngày                          · `operationStatus=running`  · nhịp tim 54 ngày
 * Trước Đợt 34: 14 → "idle", 18 → "running", cockpit "ONLINE · Connected". Không máy nào gửi nhịp tim từ 07-16.
 *
 * ★ G5 hai chiều: mỗi cửa "⇒ offline" đi kèm một ca "nhịp tim tươi ⇒ đúng trạng thái" — gate không giết máy sống.
 * ★ Ca "log `online` 10 giây + nhịp tim 54 ngày ⇒ offline" ghim đúng chỗ BRIEF SAI: tuổi log không phải liveness.
 */
import { describe, it, expect } from "vitest";
import {
  NGUONG_TRANG_THAI_TUOI_MS,
  VAN_HANH_XAP_XI_KET_NOI,
  dangKetNoi,
  isoCua,
  mapMachineStatus,
  mocConTuoi,
  msCua,
  trangThaiLichSuTaiMoc,
} from "./trangThaiMayTuoi";
// ★ Client giữ cùng ngưỡng ở `mauTrangThai.ts` (module thuần, 0 import) — ghim đẳng thức thay vì hai bản sao lệch câm.
import { NGUONG_CU_MS } from "../../client/src/components/twin3d/mauTrangThai";

const NOW = Date.UTC(2026, 8, 10, 1, 40, 0);
const PHUT = 60_000;
const NGAY = 24 * 60 * PHUT;
const LOG_3_NGAY = NOW - 3 * NGAY;
const HB_54_NGAY = NOW - 54 * NGAY;
const HB_TUOI = NOW - 10_000;

describe("NGUONG_TRANG_THAI_TUOI_MS — MỘT con số", () => {
  it("= 5 phút và = client NGUONG_CU_MS (NT-3 'quá 5 phút') — server và twin không được lệch", () => {
    expect(NGUONG_TRANG_THAI_TUOI_MS).toBe(5 * PHUT);
    expect(NGUONG_TRANG_THAI_TUOI_MS).toBe(NGUONG_CU_MS);
  });
});

describe("msCua / isoCua", () => {
  it("nhận Date, ISO, epoch; vắng/rác ⇒ null", () => {
    expect(msCua(new Date(NOW))).toBe(NOW);
    expect(msCua(new Date(NOW).toISOString())).toBe(NOW);
    expect(msCua(NOW)).toBe(NOW);
    expect(msCua(null)).toBeNull();
    expect(msCua(undefined)).toBeNull();
    expect(msCua("khong-phai-ngay")).toBeNull();
    expect(isoCua(NOW)).toBe("2026-09-10T01:40:00.000Z");
    expect(isoCua(null)).toBeNull();
    expect(isoCua("rac")).toBeNull();
  });
});

describe("mocConTuoi — cửa tuổi, fail-closed", () => {
  it("vắng mốc ⇒ KHÔNG tươi (không biết ⇒ không xanh)", () => {
    expect(mocConTuoi(null, NOW)).toBe(false);
    expect(mocConTuoi(undefined, NOW)).toBe(false);
    expect(mocConTuoi("rac", NOW)).toBe(false);
  });
  it("biên: 4′59″ tươi · đúng 5′ KHÔNG tươi · đồng hồ lệch âm vẫn tươi", () => {
    expect(mocConTuoi(NOW - NGUONG_TRANG_THAI_TUOI_MS + 1, NOW)).toBe(true);
    expect(mocConTuoi(NOW - NGUONG_TRANG_THAI_TUOI_MS, NOW)).toBe(false);
    expect(mocConTuoi(NOW + 3_000, NOW)).toBe(true);
  });
});

describe("dangKetNoi — NHỊP TIM quyết định, log `online` không chứng minh gì", () => {
  it("★★★ máy 14/18 thật: log online 3 ngày + nhịp tim 54 ngày ⇒ KHÔNG kết nối", () => {
    expect(dangKetNoi({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_54_NGAY }, NOW)).toBe(false);
  });
  it("★★★ CHỖ BRIEF SAI: log online 10 GIÂY + nhịp tim 54 ngày ⇒ vẫn KHÔNG kết nối (log là sự kiện, không phải nhịp)", () => {
    expect(dangKetNoi({ logStatus: "online", logTs: NOW - 10_000, nhipTimTs: HB_54_NGAY }, NOW)).toBe(false);
  });
  it("★ ĐỐI CHỨNG (G5): nhịp tim 10 giây ⇒ kết nối — log online 3 ngày tuổi KHÔNG làm máy sống thành chết", () => {
    expect(dangKetNoi({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_TUOI }, NOW)).toBe(true);
  });
  it("nhịp tim tươi + CHƯA có log nào ⇒ kết nối (bằng chứng sống mạnh hơn sự vắng mặt của một sự kiện)", () => {
    expect(dangKetNoi({ logStatus: undefined, logTs: undefined, nhipTimTs: HB_TUOI }, NOW)).toBe(true);
  });
  it("log `offline` ghi SAU nhịp tim cuối ⇒ KHÔNG kết nối dù nhịp tim còn tươi (đã ngắt)", () => {
    expect(dangKetNoi({ logStatus: "offline", logTs: NOW - 5_000, nhipTimTs: HB_TUOI }, NOW)).toBe(false);
  });
  it("log `offline` ghi TRƯỚC nhịp tim mới ⇒ kết nối (đã nối lại qua đường nhịp tim)", () => {
    expect(dangKetNoi({ logStatus: "offline", logTs: NOW - 60_000, nhipTimTs: HB_TUOI }, NOW)).toBe(true);
  });
  it("vắng nhịp tim ⇒ KHÔNG kết nối bất kể log — fail-closed", () => {
    expect(dangKetNoi({ logStatus: "online", logTs: NOW - 1_000, nhipTimTs: null }, NOW)).toBe(false);
    expect(dangKetNoi({ logStatus: "online", logTs: NOW - 1_000, nhipTimTs: undefined }, NOW)).toBe(false);
  });
  it("biên đúng 5′ của nhịp tim: 4′59″ ⇒ nối · 5′00″ ⇒ không", () => {
    expect(dangKetNoi({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: NOW - NGUONG_TRANG_THAI_TUOI_MS + 1 }, NOW)).toBe(true);
    expect(dangKetNoi({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: NOW - NGUONG_TRANG_THAI_TUOI_MS }, NOW)).toBe(false);
  });
});

describe("mapMachineStatus — máy im lặng không còn là running/idle", () => {
  const CU = { logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_54_NGAY };
  const TUOI = { logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_TUOI };
  it("★★★ máy 18 thật: running + im lặng 54 ngày ⇒ OFFLINE (trước: running giả)", () => {
    expect(mapMachineStatus(CU, "running", NOW)).toBe("offline");
  });
  it("★★★ máy 14 thật: stopped + im lặng 54 ngày ⇒ OFFLINE (trước: idle)", () => {
    expect(mapMachineStatus(CU, "stopped", NOW)).toBe("offline");
  });
  it("★ ĐỐI CHỨNG (G5): nhịp tim tươi ⇒ đúng bảng cũ — gate không giết máy sống", () => {
    // ★ Đợt 53 — ô `null` TÁCH ra `describe` riêng bên dưới: nó KHÔNG còn là "running".
    expect(mapMachineStatus(TUOI, "running", NOW)).toBe("running");
    expect(mapMachineStatus(TUOI, "warming_up", NOW)).toBe("running");
    expect(mapMachineStatus(TUOI, "stopped", NOW)).toBe("idle");
    expect(mapMachineStatus(TUOI, "error", NOW)).toBe("down");
    expect(mapMachineStatus(TUOI, "maintenance", NOW)).toBe("maintenance");
  });
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 53 (QA lần 8, SAI #2) — THIẾU `operationStatus` ⇒ KHÔNG SUY RA "RUNNING"
   * ════════════════════════════════════════════════════════════════════════
   * Đo trên dist 3053 với NHỊP TIM `now()` tạm cho máy 14 (`.qa-dot53/hd-truoc-co-hb/tong.json`):
   * `overview` = **idle** (cột `machines."operationStatus" = 'stopped'`) trong khi
   * `factoryCommand.machineDetail` = **running** và `assetCockpit.liveState.statusMapped` =
   * **running**, vì `liveState.value.operationStatus = null` ⇒ `default: → running`.
   * MỘT máy, MỘT giây, HAI chữ. Ô `null` từng là ô "running" trong chính lưới này (dòng cũ ở
   * ĐỐI CHỨNG trên) — tức LƯỚI ĐÃ GHIM CHÍNH CÁI HÀNH VI SAI suốt 19 đợt.
   */
  it("★★★ operationStatus null/undefined/\"\" ⇒ IDLE, không phải running (fail-safe: câu YẾU hơn)", () => {
    expect(mapMachineStatus(TUOI, null, NOW)).toBe("idle");
    expect(mapMachineStatus(TUOI, undefined, NOW)).toBe("idle");
    expect(mapMachineStatus(TUOI, "", NOW)).toBe("idle");
  });
  it("★ giá trị vận hành CÓ THẬT vẫn ra running — bản vá không giết nhánh đúng", () => {
    for (const op of ["running", "warming_up", "changeover", "starved", "blocked"]) {
      expect(mapMachineStatus(TUOI, op, NOW)).toBe("running");
    }
  });
  it("★★★ BẤT BIẾN 'MỘT hợp đồng': cùng bằng chứng + cùng cột ⇒ overview và machineDetail cùng chữ", () => {
    // Hai bề mặt = hai lời gọi khác nhau của CÙNG hàm. Đường `machineDetail` từng đánh rơi dữ kiện
    // bằng `?? undefined`; ghim ở đây để một `?? undefined` mới ở bất kỳ đâu cũng không đổi được chữ.
    for (const op of ["stopped", "running", "error", "maintenance"]) {
      const overview = mapMachineStatus(TUOI, op, NOW);
      const machineDetail = mapMachineStatus(TUOI, op ?? undefined, NOW);
      expect(machineDetail).toBe(overview);
    }
    // …và ca THẬT SỰ đã vỡ: một bên có cột (`stopped` ⇒ idle), bên kia đánh rơi dữ kiện.
    // Trước vá hai vế cho "idle" ≠ "running"; sau vá cả hai cho "idle".
    const danhRoi: string | null | undefined = null; // = `liveState.value.operationStatus` của cockpit
    expect(mapMachineStatus(TUOI, "stopped", NOW)).toBe("idle");
    expect(mapMachineStatus(TUOI, danhRoi ?? undefined, NOW)).not.toBe("running");
    expect(mapMachineStatus(TUOI, danhRoi ?? undefined, NOW)).toBe(mapMachineStatus(TUOI, "stopped", NOW));
  });
  it("xấp xỉ CHỈ khi người gọi KHAI — `VAN_HANH_XAP_XI_KET_NOI` là cửa duy nhất còn lại ra running", () => {
    expect(mapMachineStatus(TUOI, VAN_HANH_XAP_XI_KET_NOI, NOW)).toBe("running");
    // …và nó KHÔNG cứu được máy im lặng: bằng chứng kết nối vẫn quyết định trước.
    expect(mapMachineStatus(CU, VAN_HANH_XAP_XI_KET_NOI, NOW)).toBe("offline");
  });
  it("log `offline` SAU nhịp tim ⇒ offline bất kể operationStatus", () => {
    expect(mapMachineStatus({ logStatus: "offline", logTs: NOW - 1_000, nhipTimTs: HB_TUOI }, "running", NOW)).toBe("offline");
  });
  it("gate phụ thuộc `now` THAM SỐ, không đồng hồ máy: cùng bằng chứng, hai `now` ⇒ hai kết quả", () => {
    const bc = { logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_54_NGAY };
    expect(mapMachineStatus(bc, "running", HB_54_NGAY + 60_000)).toBe("running");
    expect(mapMachineStatus(bc, "running", NOW)).toBe("offline");
  });
});

/* ★★★ Đợt 38 (Pareto #2 QA Đợt 37) — replay CÙNG từ điển với live, bằng chứng cắt tại mốc */
describe("trangThaiLichSuTaiMoc — ảnh lịch sử qua ĐÚNG mapMachineStatus", () => {
  it("★★★ máy 14 thật tại mốc = bây giờ: log online 3 ngày + nhịp tim 54 ngày ⇒ OFFLINE (trước: `running 3,2 ngày`)", () => {
    expect(trangThaiLichSuTaiMoc({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_54_NGAY }, NOW)).toBe("offline");
  });
  it("★★★ D-4 msl now(): log online 1 GIÂY + nhịp tim 54 ngày ⇒ vẫn OFFLINE (trước: `running 1 s`)", () => {
    expect(trangThaiLichSuTaiMoc({ logStatus: "online", logTs: NOW - 1000, nhipTimTs: HB_54_NGAY }, NOW)).toBe("offline");
  });
  it("★ ĐỐI CHỨNG (G5): nhịp tim tươi TẠI MỐC ⇒ `running` (xấp xỉ có khai) — gate không giết máy sống trong quá khứ", () => {
    expect(trangThaiLichSuTaiMoc({ logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_TUOI }, NOW)).toBe("running");
    expect(trangThaiLichSuTaiMoc({ logStatus: null, logTs: null, nhipTimTs: HB_TUOI }, NOW)).toBe("running");
  });
  it("log `offline` ghi SAU nhịp tim tươi ⇒ offline (đã ngắt trước mốc)", () => {
    expect(trangThaiLichSuTaiMoc({ logStatus: "offline", logTs: NOW - 5000, nhipTimTs: HB_TUOI }, NOW)).toBe("offline");
  });
  it("★★★ KHÔNG bằng chứng nào ≤ mốc ⇒ `null` (không bịa quá khứ), KHÔNG phải offline", () => {
    expect(trangThaiLichSuTaiMoc({ logStatus: null, logTs: null, nhipTimTs: null }, NOW)).toBeNull();
    expect(trangThaiLichSuTaiMoc({ logStatus: undefined, logTs: undefined, nhipTimTs: undefined }, NOW)).toBeNull();
  });
  it("mốc là THAM SỐ: cùng bằng chứng, mốc lùi về lúc nhịp tim còn tươi ⇒ running; mốc bây giờ ⇒ offline", () => {
    const bc = { logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_54_NGAY };
    expect(trangThaiLichSuTaiMoc(bc, HB_54_NGAY + 10_000)).toBe("running");
    expect(trangThaiLichSuTaiMoc(bc, NOW)).toBe("offline");
  });
  it("từ điển = CommandMachineStatus ∪ {null}: không bao giờ ra `stopped`/`online`/từ lạ", () => {
    const TU_DIEN: Array<string | null> = ["running", "idle", "down", "offline", "maintenance", null];
    const cas = [
      { logStatus: "online", logTs: LOG_3_NGAY, nhipTimTs: HB_TUOI },
      { logStatus: "offline", logTs: NOW, nhipTimTs: HB_TUOI },
      { logStatus: "degraded", logTs: NOW, nhipTimTs: HB_54_NGAY },
      { logStatus: null, logTs: null, nhipTimTs: null },
    ];
    for (const bc of cas) expect(TU_DIEN).toContain(trangThaiLichSuTaiMoc(bc, NOW));
  });
});
