/**
 * ★ Đợt 12 H4.2 — PHÁT LẠI mọi fixture thật trong `server/testing/fixtures/phat-lai/*.json.gz` (ghi ở cửa sổ GPU, đóng gói bằng
 * `scripts/ai-eval/phat-lai/dongGoi.ts`). Mỗi fixture: dựng lại dự án mẫu ĐÚNG commit lúc ghi (`git archive`), chạy `quanLyLuotChay` THẬT
 * (lõi + goiModelMayChu + bộ thực thi + sổ) với engine PHÁT LẠI ⇒ không lệch · rút hết lượt · sự kiện chuẩn hoá trùng · lý do dừng trùng.
 * Lệch ⇒ ĐỎ kèm "lệch ở lượt n: <trường>" — đổi byte gửi model là CỐ Ý thì phải A/B ở cửa sổ GPU rồi ghi lại fixture.
 * Chưa có fixture ⇒ ca `skip` HIỆN TÊN (không xanh im lặng vì glob rỗng).
 *
 * ★ KHÔNG ĐỂ LẠI HÀNG NÀO (luật AGENTS.md §2: ca chạm DB bọc trong giao dịch ROLLBACK, không DELETE): mỗi ca chạy TRONG một giao dịch luôn bị hoàn tác. `getDb` (module `../db/connection`)
 * bị thay bằng bản trả về CHÍNH giao dịch đó (`kenh.db`), nên mọi ghi của `quanLyLuotChay` (ai_agent_runs, audit_logs — bảng WORM, không xoá được —, ai_pending_actions, …) và người dùng thử
 * đều nằm trong giao dịch và biến mất lúc ROLLBACK. Ngoài giao dịch `getDb()` trả `null` ⇒ việc nền chạy muộn không có CSDL để ghi (không rơi về kết nối chung, vì rơi về đó là để lại hàng).
 * Kiểm bằng phép ĐẾM RỘNG trước/sau một lượt (mọi bảng): 0 bảng đổi.
 *
 * ★ PHÁT HIỆN RÒ RỈ NGAY TRONG CA (16/11): đo thật ở cổng cho thấy mock KHÔNG đủ — một lượt chạy SAI cwd đã để lại 6 cặp `audit_logs` + `ai_pending_actions` mang ĐÚNG userId của người dùng thử đã
 * rollback (hai bảng đó không có khoá ngoại tới `users` nên ghi ngoài giao dịch vẫn thành công). Nên trước khi trả kênh, ca đếm — bằng một kết nối RIÊNG — hàng mang userId người dùng thử ở hai bảng
 * đó; hàng của giao dịch chưa commit không thấy được từ kết nối khác, nên mọi hàng đếm được là rò rỉ ⇒ `kenh.lot` ⇒ ca ĐỎ có tên + bản tóm tắt "ai đã gọi getDb qua kênh".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { taoQuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { taoGoiModelMayChu } from "../services/ai/agent/goiModelMayChu";
import { users } from "../../drizzle/schema";
import { banCoKhiPhatLai } from "./coAnhHuongByte";
import { RollbackPhatLai, ghiNoiKhac, kiemKhongLot, layDbTheoKenh, nuotRollback, type KenhGiaoDich } from "./kenhGiaoDich";
import { ghiNhanRoRi } from "./kiemRoRiDb";
import { donDuAnTam, dungDuAn } from "./phatLaiDuAn";
import { chuanHoaSuKien, soSuKien, taoBoThay, taoStreamPhatLai, TOKEN_GOC, type FixturePhatLai } from "./phatLaiLuot";

const THU_MUC = path.join(__dirname, "fixtures", "phat-lai");
const tep = fs.existsSync(THU_MUC) ? fs.readdirSync(THU_MUC).filter((t) => t.endsWith(".json.gz")).sort() : [];
const ENV0 = { ...process.env };
/** Cờ CỐ ĐỊNH của khung thử (đặt ở beforeAll): fixture khai cờ nào thì fixture thắng; cờ ảnh hưởng byte KHÔNG nằm ở đây và không trong fixture bị GỠ (V1.1). */
const CO_CO_DINH_KHUNG_THU = { AI_AGENT_THEO_VAI_TRO: "0", AI_CODING_TU_TRI_GHI: "1" } as const;

/** Kênh tới giao dịch của ca đang chạy; ngoài ca ⇒ `null` VÀ ghi lại, `afterEach` làm ca ĐỎ nếu có lời gọi lọt ngoài (xem `kenhGiaoDich.ts`). `goi` đếm ai đã đi qua kênh. */
const kenh = vi.hoisted((): KenhGiaoDich => ({ db: null, lot: [], goi: {} }));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return {
    ...goc,
    getDb: async () => layDbTheoKenh(kenh),
    // các cách lấy kết nối KHÁC không nằm trong giao dịch của ca ⇒ ghi lại + null; `afterEach(kiemKhongLot)` làm ca ĐỎ có tên nếu đường phát lại chạm chúng
    getJobsDb: async () => ghiNoiKhac(kenh, "getJobsDb"),
    getReadDb: async () => ghiNoiKhac(kenh, "getReadDb"),
    openSessionClient: () => ghiNoiKhac(kenh, "openSessionClient"),
    getNotifyClient: () => ghiNoiKhac(kenh, "getNotifyClient"),
  };
});

beforeAll(async () => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-phat-lai-0123456789";
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  process.env.AI_CODING_TU_TRI_GHI = "1";
  delete process.env.AI_GHI_LUOT_DIR;
}, 60_000);

/** Một lời gọi `getDb()` rơi ra NGOÀI giao dịch (việc nền chạy muộn, đường ghi quên đi qua `getDb`) hoặc một RÒ RỈ đo được ⇒ ca ĐỎ có tên, không bị nuốt. */
afterEach(() => kiemKhongLot(kenh));

afterAll(async () => {
  kiemKhongLot(kenh);
  for (const k of ["AI_AGENT_THEO_VAI_TRO", "AI_CODING_TU_TRI_GHI", "AI_REPO_SANDBOX_ROOTS", "SECRET_ENCRYPTION_KEY"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  donDuAnTam();
}, 60_000);

describe("H4.2 — phát lại fixture thật", () => {
  if (!tep.length) {
    it.skip("chưa có fixture nào trong server/testing/fixtures/phat-lai (ghi ở cửa sổ GPU tối B)", () => undefined);
    return;
  }
  it.each(tep)("%s", async (ten) => {
    const dbThat = await (await vi.importActual<typeof import("../db/connection")>("../db/connection")).getDb();
    if (!dbThat) throw new Error("phát lại fixture cần CSDL _test (DATABASE_URL)");
    try {
      await dbThat.transaction(async (tx) => {
        kenh.db = tx;
        let uid: number | null = null;
        try {
          const [nguoi] = await tx
            .insert(users)
            .values({ openId: `phatlaifx_${process.pid}`, username: `phatlaifx_${process.pid}`, name: "người dùng phát lại fixture", role: "admin", loginMethod: "local" })
            .returning({ id: users.id });
          uid = nguoi!.id;
          const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(THU_MUC, ten))).toString("utf8")) as FixturePhatLai;
          const goc = dungDuAn(fx);
          // Cờ máy chủ LÚC GHI (vitest.setup không nạp .env) — đặt cho ca này rồi trả lại. V1.1: mọi cờ ảnh hưởng byte KHÔNG có trong fixture bị GỠ (mã dùng mặc định thật của nó),
          // nên cờ `export` trong shell hay cờ mới bật ở môi trường chạy test không làm fixture cũ đỏ oan.
          const ban = banCoKhiPhatLai(fx.lenh.moiTruong, CO_CO_DINH_KHUNG_THU);
          const env0 = Object.fromEntries([...Object.keys(ban.dat), ...ban.xoa].map((k) => [k, process.env[k]]));
          Object.assign(process.env, ban.dat);
          for (const k of ban.xoa) delete process.env[k];
          try {
            process.env.AI_REPO_SANDBOX_ROOTS = `phatlaifx=Phat lai fixture|${goc}`;
            const p = taoStreamPhatLai(fx, { goc });
            const ql = taoQuanLyLuotChay({ goiModel: taoGoiModelMayChu({ chatStream: p.stream, khongGhiDauVet: true }) });
            const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: fx.lenh.cauHoi.split(TOKEN_GOC).join(goc), projectId: "phatlaifx", cheDo: fx.lenh.cheDo });
            if (!kq.ok) throw new Error(`${kq.ma} ${kq.thongDiep ?? ""}`);
            await kq.luot.xong;
            expect(p.lech, "lệch đầu tiên").toEqual([]);
            expect(p.conLai(), "lượt chưa rút").toBe(0);
            expect(kq.luot.lyDoDung).toBe(fx.ky.lyDo);
            const ct = await ql.chiTiet(kq.luot.id, uid);
            // Công cụ THẬT không tất định (thời gian, thứ tự dòng, chỗ cắt cụt) + siêu dữ liệu bat-dau ⇒ `soSuKien` (lệch đầu tiên hoặc null).
            expect(soSuKien(fx.ky.suKien, chuanHoaSuKien(ct!.suKien, taoBoThay(goc))), "sự kiện lệch đầu tiên").toBeNull();
          } finally {
            for (const [k, v] of Object.entries(env0)) {
              if (v === undefined) delete process.env[k];
              else process.env[k] = v;
            }
          }
        } finally {
          // RÒ RỈ: hàng mang userId người dùng thử thấy được từ kết nối KHÁC khi giao dịch còn mở ⇒ đã ghi NGOÀI giao dịch (xem khối ★ đầu tệp). Đếm cả khi ca đỏ.
          if (uid !== null) await ghiNhanRoRi(kenh, uid);
          kenh.db = null;
        }
        throw new RollbackPhatLai();
      });
    } catch (e) {
      nuotRollback(e);
    }
  }, 300_000);
});
