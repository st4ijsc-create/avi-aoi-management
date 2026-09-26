/**
 * ★★★ 2026-08-29 — LƯỚI CHO **SỔ ĐUÔI SỐNG** (`lenhSong.ts`): đầu ra `run_command` đang chạy mà
 * panel Terminal poll xem realtime.
 *
 * Bốn bất biến AN TOÀN (không phải khẩu vị) phải đo bằng ĐƯỜNG THOÁT thật, không quét văn bản:
 *   §2 CÁCH LY USER — user B không đọc được entry của user A (đầu ra lệnh mang đường dẫn/nhánh).
 *   §3 CHUNK TRỄ — chunk của lượt CŨ không được nối vào đuôi lượt MỚI đã thay chỗ (actionId so).
 *   §4 TRẦN ĐUÔI — đuôi không phình vô hạn theo một build verbose; cắt ĐẦU giữ ĐUÔI.
 *   §5 CHE BÍ MẬT — thứ nằm trong đuôi là thứ ĐÃ QUA redactor; một khoá `sk-…` tách đôi giữa hai
 *      chunk KHÔNG BAO GIỜ xuất hiện nguyên văn ở bất kỳ nhịp đọc nào (lớp rò Pha 8 / doc 69).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • `docLenhSong` bỏ khoá userId (trả entry bất kỳ)            ⇒ §2 ĐỎ
 *   • `noiDauRaSong` bỏ so `actionId`                            ⇒ §3 ĐỎ
 *   • bỏ cap `TRAN_DUOI_SONG` / cắt ĐUÔI thay vì cắt ĐẦU         ⇒ §4 ĐỎ
 *   • đuôi giữ chunk THÔ, che lúc đọc (hoặc không che)           ⇒ §5 ĐỎ
 *   • `ketThucLenhSong` quên `flush()` phần redactor giữ lại      ⇒ §6 ĐỎ
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRAN_DUOI_SONG,
  TTL_SAU_KET_THUC_MS,
  _xoaSachSoSong,
  batDauLenhSong,
  docLenhSong,
  ketThucLenhSong,
  noiDauRaSong,
} from "./lenhSong";

beforeEach(() => _xoaSachSoSong());
afterEach(() => {
  _xoaSachSoSong();
  vi.useRealTimers();
});

describe("§1 VÒNG ĐỜI — bắt đầu → nối → kết thúc", () => {
  it("★★★ batDau ⇒ đọc được {lenh, dangChay:true, đuôi rỗng}; ketThuc ⇒ dangChay:false", () => {
    batDauLenhSong(1, "act-1", "pnpm build");
    const dau = docLenhSong(1);
    expect(dau).not.toBeNull();
    expect(dau?.lenh).toBe("pnpm build");
    expect(dau?.dangChay).toBe(true);
    expect(dau?.dauRa).toBe("");
    expect(dau?.catDau).toBe(false);

    ketThucLenhSong(1, "act-1");
    expect(docLenhSong(1)?.dangChay).toBe(false);
  });

  it("★ chưa từng bắt đầu ⇒ null (client hiểu 'không gì đang chạy')", () => {
    expect(docLenhSong(999)).toBeNull();
  });

  it("★ msTroi đo từ lúc bắt đầu, không âm", () => {
    batDauLenhSong(1, "act-1", "pnpm build");
    expect(docLenhSong(1)!.msTroi).toBeGreaterThanOrEqual(0);
  });
});

describe("§2 CÁCH LY USER — khoá sổ là userId", () => {
  it("★★★ user 2 KHÔNG đọc được entry của user 1; hai user chạy song song không lẫn đuôi", () => {
    batDauLenhSong(1, "act-a", "dotnet test");
    noiDauRaSong(1, "act-a", "dong cua user mot\n");
    expect(docLenhSong(2)).toBeNull();

    batDauLenhSong(2, "act-b", "npm run check");
    noiDauRaSong(2, "act-b", "dong cua user hai\n");
    ketThucLenhSong(1, "act-a");
    ketThucLenhSong(2, "act-b");
    expect(docLenhSong(1)!.dauRa).toContain("user mot");
    expect(docLenhSong(1)!.dauRa).not.toContain("user hai");
    expect(docLenhSong(2)!.dauRa).toContain("user hai");
    expect(docLenhSong(2)!.dauRa).not.toContain("user mot");
  });
});

describe("§3 CHUNK TRỄ của lượt cũ — actionId phải khớp", () => {
  it("★★★ lượt mới thay chỗ ⇒ chunk vét muộn của lượt cũ KHÔNG vào đuôi lượt mới", () => {
    batDauLenhSong(1, "act-cu", "lenh cu");
    noiDauRaSong(1, "act-cu", "chu cua luot cu ");
    // Lượt mới CÙNG user thay chỗ (mỗi user một entry hiện hành):
    batDauLenhSong(1, "act-moi", "lenh moi");
    // stdout của lượt cũ còn vét nốt một chunk — phải rơi vào hư không:
    noiDauRaSong(1, "act-cu", "CHUNK-TRE-PHAI-BO");
    ketThucLenhSong(1, "act-moi");
    const d = docLenhSong(1)!;
    expect(d.lenh).toBe("lenh moi");
    expect(d.dauRa).not.toContain("CHUNK-TRE-PHAI-BO");
    // …và `ketThuc` trễ của lượt cũ cũng không lật cờ của lượt mới:
    batDauLenhSong(1, "act-3", "lenh ba");
    ketThucLenhSong(1, "act-moi");
    expect(docLenhSong(1)!.dangChay).toBe(true);
  });
});

describe("§4 TRẦN ĐUÔI — cắt ĐẦU, giữ ĐUÔI, dựng cờ catDau", () => {
  it("★★★ nối vượt trần ⇒ length ≤ TRAN_DUOI_SONG, phần GIỮ là phần CUỐI, catDau:true", () => {
    batDauLenhSong(1, "act-1", "pnpm build");
    // Chunk dài, kết thúc bằng mốc nhận diện — sau cắt, mốc CUỐI phải còn, mốc ĐẦU phải mất.
    const khoi = "x".repeat(1000) + "\n";
    noiDauRaSong(1, "act-1", "MOC-DAU-TIEN\n");
    for (let i = 0; i < Math.ceil(TRAN_DUOI_SONG / khoi.length) + 5; i++) {
      noiDauRaSong(1, "act-1", khoi);
    }
    noiDauRaSong(1, "act-1", "MOC-CUOI-CUNG\n");
    ketThucLenhSong(1, "act-1");
    const d = docLenhSong(1)!;
    expect(d.dauRa.length).toBeLessThanOrEqual(TRAN_DUOI_SONG);
    expect(d.catDau).toBe(true);
    expect(d.dauRa).toContain("MOC-CUOI-CUNG");
    expect(d.dauRa).not.toContain("MOC-DAU-TIEN");
  });

  it("★ dưới trần ⇒ không cắt, catDau:false", () => {
    batDauLenhSong(1, "act-1", "pnpm build");
    noiDauRaSong(1, "act-1", "ngan thoi\n");
    ketThucLenhSong(1, "act-1");
    const d = docLenhSong(1)!;
    expect(d.catDau).toBe(false);
    expect(d.dauRa).toContain("ngan thoi");
  });
});

describe("§5 CHE BÍ MẬT — đuôi chỉ chứa chữ ĐÃ QUA redactor (per-chunk, per-entry)", () => {
  const KHOA_BI_MAT = "sk-abcdefghijklmnop123456"; // khớp mẫu api_key `sk-[A-Za-z0-9]{16,}`

  it("★★★ khoá `sk-…` TÁCH ĐÔI giữa hai chunk: KHÔNG nhịp đọc nào thấy nguyên văn; kết thúc ⇒ placeholder", () => {
    batDauLenhSong(1, "act-1", "npm run check");
    noiDauRaSong(1, "act-1", `loi cau hinh: ${KHOA_BI_MAT.slice(0, 10)}`);
    // Nhịp poll GIỮA hai chunk — đây chính là chỗ mà che-lúc-đọc bị rò (tiền tố đã rời server):
    expect(docLenhSong(1)!.dauRa).not.toContain(KHOA_BI_MAT.slice(0, 10));
    noiDauRaSong(1, "act-1", `${KHOA_BI_MAT.slice(10)} — sua .env di\n`);
    expect(docLenhSong(1)!.dauRa).not.toContain(KHOA_BI_MAT);
    ketThucLenhSong(1, "act-1");
    const cuoi = docLenhSong(1)!.dauRa;
    expect(cuoi).not.toContain(KHOA_BI_MAT);
    expect(cuoi).toContain("[REDACTED_SECRET]");
    expect(cuoi).toContain("sua .env di");
  });

  it("★★ hai entry hai redactor RIÊNG — nửa khoá của user 1 không 'nối' với nửa khoá của user 2", () => {
    batDauLenhSong(1, "act-a", "lenh a");
    batDauLenhSong(2, "act-b", "lenh b");
    noiDauRaSong(1, "act-a", KHOA_BI_MAT.slice(0, 10));
    noiDauRaSong(2, "act-b", KHOA_BI_MAT.slice(10));
    ketThucLenhSong(1, "act-a");
    ketThucLenhSong(2, "act-b");
    // Mỗi bên chỉ có NỬA khoá — không bên nào đủ hình dạng bí mật, và không bên nào thấy nửa của bên kia.
    expect(docLenhSong(1)!.dauRa).toBe(KHOA_BI_MAT.slice(0, 10));
    expect(docLenhSong(2)!.dauRa).toBe(KHOA_BI_MAT.slice(10));
  });
});

describe("§6 KẾT THÚC PHẢI FLUSH — phần redactor giữ lại không được bốc hơi", () => {
  it("★★★ chữ thường ngắn hơn cửa giữ-lại (32 ký tự): TRƯỚC ketThuc có thể vắng, SAU ketThuc phải đủ", () => {
    batDauLenhSong(1, "act-1", "pnpm build");
    noiDauRaSong(1, "act-1", "hello world"); // 11 ký tự < 32 ⇒ redactor giữ TOÀN BỘ
    ketThucLenhSong(1, "act-1");
    expect(docLenhSong(1)!.dauRa).toBe("hello world");
  });
});

describe("§7 TTL — entry chết tự xoá, entry bị thay chỗ không giết oan lượt mới", () => {
  it("★★★ sau ketThuc + TTL ⇒ null; lượt MỚI bắt đầu trước hạn xoá thì KHÔNG bị timer cũ xoá", () => {
    vi.useFakeTimers();
    batDauLenhSong(1, "act-1", "pnpm build");
    ketThucLenhSong(1, "act-1");
    expect(docLenhSong(1)).not.toBeNull();
    vi.advanceTimersByTime(TTL_SAU_KET_THUC_MS + 1);
    expect(docLenhSong(1)).toBeNull();

    // Lượt 2 kết thúc rồi lượt 3 thay chỗ TRƯỚC khi timer của lượt 2 nổ — lượt 3 phải sống:
    batDauLenhSong(1, "act-2", "lenh hai");
    ketThucLenhSong(1, "act-2");
    batDauLenhSong(1, "act-3", "lenh ba");
    vi.advanceTimersByTime(TTL_SAU_KET_THUC_MS + 1);
    expect(docLenhSong(1)?.lenh).toBe("lenh ba");
  });
});
