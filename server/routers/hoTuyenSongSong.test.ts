/**
 * ★★★ Pha 8 Task 5 — **LƯỢNG TỪ TRÊN TOÀN HỌ TUYẾN SONG SONG XÁC THỰC.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ cặp thủ tục thao tác trên CÙNG một tài nguyên xác thực: hai bên phải áp CÙNG bộ phép kiểm
 *   và CÙNG bộ tác động — trừ các cặp được KHAI TÊN kèm lý do.***
 *   ***∀ đơn vị xử lý trả về kết quả một phép đọc THÔ trên bảng tài nguyên xác thực ⇒ VI PHẠM.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỢNG TỪ, KHÔNG PHẢI "VÁ CẶP THỨ TƯ"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/totpOnce.ts:20-24` **đã đếm bằng tay** các cặp tuyến song song và khai **HAI**. Phép
 * đếm ấy **sót cặp thứ BA** (`twoFactor.generateSecret ≡ user.setup2FA`) — và đó **chính là** cặp mà
 * hai bản sao **BẤT ĐỒNG**. Nó không chỉ sót; nó sót **đúng phần tử duy nhất có mâu thuẫn nội tại**.
 * ⇒ Vá cặp thứ tư khi vấp phải nó là cách làm đã chứng minh chỉ dẫn tới cặp thứ năm.
 *
 * **Phép đếm ĐẢO LƯỢNG TỪ hôm nay (bộ suy `./hoXacThucScan`, đọc từ đĩa):**
 *   · **38** đơn vị xử lý (tRPC + REST) chạm tài nguyên xác thực
 *   · **29** cặp song song — **gấp bảy** con số "hai cặp" mà phép liệt kê tay khai
 *   · **14** cặp KHỚP · **15** cặp bất đồng, được **khai tên từng cái** ở `MIEN_TRU` dưới đây
 *   · **0** đơn vị trả nguyên hàng (trước Task 5: **1** — `user.getSessions`)
 *
 * **Ba bất đồng NGUY HIỂM đã vá trong chính lượt này** (mỗi cái một commit):
 *   1. `user.getSessions` trả **NGUYÊN HÀNG** `user_sessions` ⇒ `sessionToken` — **khoá phiên** —
 *      bay xuống trình duyệt, trong khi tuyến song song `session.list` chiếu tường minh và không.
 *      **Đây là cặp thứ TƯ, và nó KHÔNG thuộc trục TOTP** nên phép đếm tay không thể bắt.
 *   2. `user.disable2FA` tắt 2FA mà **KHÔNG dọn `backup_codes`** ⇒ 10 mã dự phòng sống sót, còn
 *      tiêu được ở `twoFactor.verify` và `POST /api/auth/verify-2fa`, **qua cả lượt bật lại bằng
 *      hạt giống MỚI**.
 *   3. `user.verify2FA` thiếu hàng rào *"2FA đã bật"* mà tuyến song song `twoFactor.enable` có.
 *
 * **Cặp CRITICAL mà brief của Pha 8 nêu (`user.setup2FA` thiếu hàng rào `twoFactorEnabled`) hôm nay
 * đã KHỚP** — nó được vá ở Pha 7 / review TOÀN NHÁNH C-1. Ô *"đối chứng dương"* §6 dưới đây đo lại
 * điều đó mỗi lượt chạy, để một lượt hồi quy trên đúng cặp ấy không im lặng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ MIỄN TRỪ **KHÔNG PHẢI MỘT TẤM VÉ TRẮNG** — VÀ ĐÂY LÀ CHỖ LƯỢNG TỪ DỄ TỰ THOẢ NHẤT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mỗi lời khai ghim **CHỮ KÝ CHÊNH LỆCH CHÍNH XÁC**, không phải tên cặp. Một chênh lệch **MỚI** trên
 * đúng cặp đã khai vẫn làm cổng **ĐỎ** (ca §7 đo lại đúng điều này bằng một đột biến tổng hợp).
 * Nếu miễn trừ chỉ là một tập tên, thì cặp `twoFactor.disable ≡ user.disable2FA` — cặp đã có **hai**
 * bất đồng nguy hiểm — sẽ trở thành **vùng mù vĩnh viễn** ngay sau lời khai đầu tiên.
 *
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh thành "đã phủ hết")
 *  1. §1–§7 là lưới **HÌNH DẠNG**: chúng đọc mã, **không chạy** mã. Chúng trả lời *"hai tuyến có
 *     MANG cùng bộ phép kiểm không"*, **không** trả lời *"phép kiểm ấy có chạy trên mọi nhánh
 *     không"*. §8 là nửa **HÀNH VI**, và nó chỉ phủ đúng một trục (`user.getSessions`).
 *  2. Cột `users` **ngoài** nhánh (b) của bộ suy không được canh — trục hồ sơ/phân quyền.
 *  3. SQL thô trên bảng xác thực không được nhận diện (hôm nay: 0 điểm).
 *  4. Còn **một bất đồng NGUY HIỂM CHƯA VÁ** trong tập miễn trừ, và nó được khai đúng như thế:
 *     `twoFactor.disable` **KHÔNG đòi mật khẩu** trong khi `user.disable2FA` có. Vá nó là **đổi
 *     hợp đồng API** (`input` thêm `password`, và `client/src/components/TwoFactorSetup.tsx` phải
 *     sửa theo) ⇒ **CHỜ CHỦ DỰ ÁN**, không tự quyết trên đường xác thực sản xuất.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  taiNguyenXacThuc,
  banDoTangDb,
  quetDonViXuLy,
  donViTrongNguon,
  capSongSong,
  tenDayDu,
  type DonViXuLy,
} from "./hoXacThucScan";
import { moiCotBiMatCuaUserSecrets } from "../_core/publicUser";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";
import * as db from "../db";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/routers
const GOC = join(TEST_DIR, "..", "..");

const TAI_NGUYEN = taiNguyenXacThuc(GOC, moiCotBiMatCuaUserSecrets());
const BAN_DO = banDoTangDb(GOC, TAI_NGUYEN);
const DON_VI = quetDonViXuLy(GOC, TAI_NGUYEN, BAN_DO);
const CAP = capSongSong(DON_VI);

/**
 * ★★★ **TẬP MIỄN TRỪ — 15 cặp, mỗi cặp một lý do MỘT DÒNG và một CHỮ KÝ CHÊNH LỆCH chính xác.**
 *
 * Đọc chữ ký: `A+x` = **chỉ** bên A (tên đứng trước trong khoá) có `x`.
 *   · `o:<cột>`      — một chối từ mà điều kiện chạm cột ấy
 *   · `dung:<f>`     — một lời gọi tiêu thụ vật liệu xác thực, kết quả điều khiển một chối từ
 *   · `bảng.cột=giá` — một lượt GHI
 */
const MIEN_TRU: Readonly<Record<string, { lyDo: string; lech: readonly string[] }>> = {
  /* ── Trục TIÊU mã dự phòng ─────────────────────────────────────────────────────────────── */
  "server/_core/oauth.ts#/api/auth/verify-2fa | server/routers/twoFactorRouter.ts#disable": {
    lyDo: "Hai luồng khác nhau: bước-2 ĐĂNG NHẬP (chưa có phiên, có vé bước-mật-khẩu + ngân sách đoán) vs TẮT 2FA trong phiên.",
    lech: ["A+dung:verifyBackupCode", "B+backupCodes:delete", "B+userSecrets.twoFactorSecret=null", "B+users.twoFactorEnabled=false"],
  },
  "server/_core/oauth.ts#/api/auth/verify-2fa | server/routers/twoFactorRouter.ts#verify": {
    lyDo: "CÙNG một luật đối chiếu mã dự phòng, HAI người gọi: REST qua `db.verifyBackupCode`, tRPC qua `khopMaDuPhong`. Nợ MỚI: hợp nhất về một chủ.",
    lech: ["A+dung:verifyBackupCode"],
  },
  "server/routers/twoFactorRouter.ts#disable | server/routers/twoFactorRouter.ts#verify": {
    lyDo: "`verify` chỉ XÁC MINH (không đổi trạng thái); `disable` xác minh RỒI tắt 2FA và dọn vật liệu.",
    lech: ["A+backupCodes:delete", "A+userSecrets.twoFactorSecret=null", "A+users.twoFactorEnabled=false"],
  },

  /* ── Trục SINH/DỌN mã dự phòng ─────────────────────────────────────────────────────────── */
  "server/routers/twoFactorRouter.ts#disable | server/routers/twoFactorRouter.ts#enable": {
    lyDo: "Hai HƯỚNG ngược nhau của cùng một công tắc: bật 2FA (cấp mã mới) vs tắt 2FA (thu mã về).",
    lech: ["A+backupCodes.isUsed=true", "A+backupCodes.usedAt=*", "A+userSecrets.twoFactorSecret=null", "A+users.twoFactorEnabled=false", "B+backupCodes:insert", "B+users.twoFactorEnabled=true"],
  },
  "server/routers/twoFactorRouter.ts#disable | server/routers/twoFactorRouter.ts#regenerateBackupCodes": {
    lyDo: "Tắt 2FA vs cấp lại mã dự phòng khi 2FA vẫn bật — hai thao tác người dùng khác nhau.",
    lech: ["A+backupCodes.isUsed=true", "A+backupCodes.usedAt=*", "A+userSecrets.twoFactorSecret=null", "A+users.twoFactorEnabled=false", "B+backupCodes:insert"],
  },
  "server/routers/twoFactorRouter.ts#enable | server/routers/twoFactorRouter.ts#regenerateBackupCodes": {
    lyDo: "`enable` còn BẬT cờ 2FA (lần đầu); `regenerate` chạy khi cờ đã bật nên không chạm cờ.",
    lech: ["A+users.twoFactorEnabled=true"],
  },
  "server/routers/twoFactorRouter.ts#enable | server/routers/userRouters.ts#disable2FA": {
    lyDo: "Hai HƯỚNG ngược nhau (bật vs tắt); chênh lệch `dung:compare`/`o:passwordHash` là bất đồng ĐÃ KHAI ở cặp `disable ≡ disable2FA` bên dưới.",
    lech: ["A+backupCodes:insert", "A+users.twoFactorEnabled=true", "B+dung:compare", "B+o:passwordHash", "B+userSecrets.twoFactorSecret=null", "B+users.twoFactorEnabled=false"],
  },
  "server/routers/twoFactorRouter.ts#regenerateBackupCodes | server/routers/userRouters.ts#disable2FA": {
    lyDo: "Cấp lại mã dự phòng vs tắt 2FA — hai thao tác khác nhau, chỉ dùng chung lượt dọn `backup_codes`.",
    lech: ["A+backupCodes:insert", "B+dung:compare", "B+o:passwordHash", "B+userSecrets.twoFactorSecret=null", "B+users.twoFactorEnabled=false"],
  },
  "server/routers/twoFactorRouter.ts#enable | server/routers/userRouters.ts#verify2FA": {
    lyDo: "⚠ NỢ SẢN PHẨM (đã báo): `twoFactor.enable` quay vòng 10 mã dự phòng và TRẢ VỀ cho client (`TwoFactorSetup.tsx` hiện chúng); `Profile.tsx` KHÔNG có màn hiển thị ấy, nên cấp mã rồi không hiện là tệ hơn không cấp.",
    lech: ["A+backupCodes:delete", "A+backupCodes:insert"],
  },

  /* ── Trục TẮT 2FA ──────────────────────────────────────────────────────────────────────── */
  "server/routers/twoFactorRouter.ts#disable | server/routers/userRouters.ts#disable2FA": {
    lyDo: "⚠⚠ BẤT ĐỒNG NGUY HIỂM CHƯA VÁ, CHỜ CHỦ DỰ ÁN: `twoFactor.disable` KHÔNG đòi mật khẩu (và NHẬN mã dự phòng) trong khi `user.disable2FA` đòi mật khẩu + chỉ nhận TOTP — vá là ĐỔI HỢP ĐỒNG API (`input` thêm `password`) và phải sửa `client/src/components/TwoFactorSetup.tsx`.",
    lech: ["A+backupCodes.isUsed=true", "A+backupCodes.usedAt=*", "B+dung:compare", "B+o:passwordHash"],
  },

  /* ── Trục GHI mật khẩu ─────────────────────────────────────────────────────────────────── */
  "server/routers.ts#setupAdmin | server/routers/userRouters.ts#changePassword": {
    lyDo: "Bootstrap admin đầu tiên (chưa tồn tại tài khoản nên không có mật khẩu cũ để đối chiếu) vs tự đổi mật khẩu.",
    lech: ["B+dung:compare", "B+o:passwordHash"],
  },
  "server/routers/userRouters.ts#changePassword | server/routers/userRouters.ts#create": {
    lyDo: "Tự đổi mật khẩu (ĐÒI mật khẩu hiện tại) vs admin TẠO tài khoản mới (chưa có mật khẩu nào để đòi).",
    lech: ["A+dung:compare", "A+o:passwordHash"],
  },
  "server/routers/userRouters.ts#changePassword | server/routers/userRouters.ts#updatePassword": {
    lyDo: "Tự đổi (ĐÒI mật khẩu hiện tại) vs admin ĐẶT LẠI hộ người khác (`adminProcedure`, mật khẩu cũ không có ở đó).",
    lech: ["A+dung:compare", "A+o:passwordHash"],
  },

  /* ── Trục phân công tổ chức ────────────────────────────────────────────────────────────── */
  "server/routers/userRouters.ts#reassignCorporate | server/routers/userRouters.ts#removeCorporateAssignment": {
    lyDo: "Chuyển phân công = gỡ RỒI gán; gỡ phân công chỉ gỡ.",
    lech: ["A+userCorporateAssignments:insert"],
  },
  "server/routers/userRouters.ts#reassignFactory | server/routers/userRouters.ts#removeFactoryAssignment": {
    lyDo: "Chuyển phân công = gỡ RỒI gán; gỡ phân công chỉ gỡ.",
    lech: ["A+userFactoryAssignments:insert"],
  },
};

/** ★★★ GHIM SỐ. Một cặp bất đồng **thứ mười sáu** phải là một quyết định NÓI RA. */
const SO_MIEN_TRU = 15;

/** So hai chữ ký chênh lệch — thứ tự đã chuẩn hoá ở `capSongSong`. */
function bang(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

describe("★★★ Pha 5/8 Task 5 §1 — cầu chì: bộ suy thấy CẢ HỌ, không thấy một tập rỗng", () => {
  it("★★★ ba nhánh tài nguyên xác thực đều KHÁC RỖNG và neo vào đúng thứ chúng phải neo", () => {
    expect(TAI_NGUYEN.cotBiMat, "hạt giống TOTP phải trong tập (a)").toContain("twoFactorSecret");
    expect(TAI_NGUYEN.cotBiMat, "hash mật khẩu phải trong tập (a)").toContain("passwordHash");
    expect(
      TAI_NGUYEN.cotUsers,
      "nhánh (b) trượt mất `twoFactorEnabled` ⇒ MỌI cặp bật/tắt 2FA rơi khỏi lượng từ",
    ).toContain("twoFactorEnabled");
    expect(TAI_NGUYEN.bang, "bảng mã dự phòng phải trong tập (c)").toContain("backupCodes");
    expect(TAI_NGUYEN.bang, "bảng phiên phải trong tập (c)").toContain("userSessions");
  });

  it("★★★ quét thấy đủ ĐƠN VỊ XỬ LÝ và đủ CẶP (0 ⇒ mọi ô dưới là chân lý rỗng)", () => {
    expect(
      DON_VI.length,
      "quét trúng quá ít đơn vị xử lý — bộ suy phạm vi đã hỏng?\n⚠ Đo được ở Pha 8 Task 5: 38.",
    ).toBeGreaterThanOrEqual(30);
    expect(
      CAP.length,
      "quét ra quá ít CẶP song song — lượng từ đang canh gần như không gì.\n⚠ Đo được ở Pha 8 Task 5: 29 cặp (phép đếm TAY ở `_core/totpOnce.ts` khai HAI).",
    ).toBeGreaterThanOrEqual(20);
    expect(
      new Set(DON_VI.map((d) => d.duong)).size,
      "mọi đơn vị rơi vào cùng một file ⇒ phạm vi quét đệ quy đã hỏng",
    ).toBeGreaterThanOrEqual(3);
    // Cả hai HỌ tuyến phải có mặt — thiếu một bên thì "cặp song song" là khái niệm rỗng.
    const file = new Set(DON_VI.map((d) => d.duong));
    expect(file, "họ `twoFactor*` phải nằm trong lượng từ").toContain("server/routers/twoFactorRouter.ts");
    expect(file, "họ `user*` phải nằm trong lượng từ").toContain("server/routers/userRouters.ts");
    expect(file, "bề mặt REST phải nằm trong lượng từ").toContain("server/_core/oauth.ts");
  });
});

describe("★★★★ Pha 5/8 Task 5 §2 — ∀ cặp song song: KHỚP, hoặc được KHAI TÊN kèm chữ ký chênh lệch", () => {
  it("★★★★ không cặp bất đồng nào nằm ngoài tập KHAI", () => {
    const ho = CAP.filter((c) => c.lech.length > 0 && MIEN_TRU[c.khoa] === undefined);
    expect(
      ho.map((c) => `  · "${c.khoa}":\n      neo   ${c.neo.join(", ")}\n      lệch  ${JSON.stringify(c.lech)}`).join("\n"),
      "MỘT CẶP TUYẾN SONG SONG BẤT ĐỒNG MÀ KHÔNG AI KHAI.\n" +
        "⚠ Hai tuyến làm cùng một việc trên cùng một tài nguyên xác thực nhưng áp KHÁC bộ phép kiểm\n" +
        "  ⇒ kẻ tấn công chọn tuyến LỎNG hơn, và mọi cổng dựng trên tuyến chặt thành trang trí.\n" +
        "⇒ Hoặc vá cho khớp bên chặt hơn, hoặc KHAI vào `MIEN_TRU` kèm lý do MỘT DÒNG + chữ ký\n" +
        "  chênh lệch chính xác (và cập nhật `SO_MIEN_TRU`).\n",
    ).toBe("");
  });

  it("★★★★ chữ ký chênh lệch của mỗi cặp đã khai phải khớp CHÍNH XÁC (lời khai không phải vé trắng)", () => {
    const troi = CAP.filter((c) => MIEN_TRU[c.khoa] !== undefined && !bang(c.lech, MIEN_TRU[c.khoa]!.lech));
    expect(
      troi
        .map((c) => `  · "${c.khoa}"\n      KHAI  ${JSON.stringify(MIEN_TRU[c.khoa]!.lech)}\n      THẬT  ${JSON.stringify(c.lech)}`)
        .join("\n"),
      "CHÊNH LỆCH TRÊN MỘT CẶP ĐÃ KHAI ĐÃ ĐỔI.\n" +
        "⚠ Miễn trừ ghim CHỮ KÝ, không ghim TÊN: một bất đồng MỚI trên đúng cặp đã khai vẫn phải\n" +
        "  làm cổng ĐỎ, nếu không thì lời khai đầu tiên biến cặp ấy thành vùng mù VĨNH VIỄN — và\n" +
        "  cặp `twoFactor.disable ≡ user.disable2FA` đã có SẴN hai bất đồng nguy hiểm.\n",
    ).toBe("");
  });

  it("★★★ SỐ cặp bất đồng được GHIM — cặp thứ mười sáu phải là một quyết định NÓI RA", () => {
    const bd = CAP.filter((c) => c.lech.length > 0);
    expect(
      bd.map((c) => `  · ${c.khoa}`).join("\n"),
      "số cặp bất đồng đã đổi (khai: " + SO_MIEN_TRU + ")",
    ).toBeDefined();
    expect(bd.length, "số cặp bất đồng đã đổi").toBe(SO_MIEN_TRU);
    expect(Object.keys(MIEN_TRU).length, "tập KHAI và tập bất đồng phải cùng lực lượng").toBe(SO_MIEN_TRU);
    // …và không lời khai nào là RÁC (khai cho một cặp không còn tồn tại ⇒ luật đang co lại im lặng).
    const khoaThat = new Set(CAP.map((c) => c.khoa));
    const rac = Object.keys(MIEN_TRU).filter((k) => !khoaThat.has(k));
    expect(
      rac.join("\n"),
      "một lời khai trỏ tới cặp KHÔNG CÒN TỒN TẠI — hoặc thủ tục bị xoá/đổi tên, hoặc bộ suy đã mù.",
    ).toBe("");
  });
});

describe("★★★★ Pha 5/8 Task 5 §3 — ∀ TUYỆT ĐỐI: không đơn vị nào trả NGUYÊN HÀNG bảng xác thực", () => {
  it("★★★★ 0 đơn vị xử lý trả kết quả một phép đọc THÔ", () => {
    const vp = DON_VI.filter((d) => d.traTho.length > 0);
    expect(
      vp.map((d) => `  · ${d.duong}:${d.dong}  ${d.ten}()  ← ${d.traTho.join(", ")}`).join("\n"),
      "MỘT ĐƠN VỊ XỬ LÝ TRẢ NGUYÊN HÀNG MỘT BẢNG TÀI NGUYÊN XÁC THỰC.\n" +
        "⚠ `db.select()` không phép chiếu ⇒ MỌI cột ra, kể cả cột chưa ai kịp phân loại. Đúng hình\n" +
        "  dạng đã để `user_sessions.sessionToken` — KHOÁ PHIÊN — bay xuống trình duyệt qua\n" +
        "  `user.getSessions`, trong khi tuyến song song `session.list` chiếu tường minh.\n" +
        "⇒ Chiếu qua một CHỦ DUY NHẤT (`server/_core/publicSession.ts` — allow-list + cổng KIỂU),\n" +
        "  không phải bằng một `delete row.<cột>` tại chỗ.\n",
    ).toBe("");
  });
});

describe("★★★★ Pha 5/8 Task 5 §4 — M3: một cặp bất đồng MỚI trong FILE CHƯA TỒN TẠI vẫn bị bắt", () => {
  const FILE_MOI = "server/routers/tatHai2FaN1Router.ts";

  it("★★★★ ca phân biệt 'lưới theo ĐƯỜNG THOÁT' với 'lưới theo FILE'", () => {
    expect(existsSync(join(GOC, FILE_MOI)), "ca này giả định file ấy chưa tồn tại").toBe(false);
    const ma = `
      import { router, protectedProcedure } from "../_core/trpc";
      import * as db from "../db";
      export const r = router({
        tatNhanh: protectedProcedure.mutation(async ({ ctx }) => {
          await db.disable2FA(ctx.user.id);
          return { success: true };
        }),
      });`;
    const themVao = donViTrongNguon(FILE_MOI, ma, TAI_NGUYEN, BAN_DO);
    expect(themVao.length, "thủ tục mới phải vào được lượng từ (0 ⇒ bộ suy mù với file mới)").toBeGreaterThanOrEqual(1);

    const capMoi = capSongSong([...DON_VI, ...themVao]).filter(
      (c) => c.lech.length > 0 && c.khoa.includes(FILE_MOI) && MIEN_TRU[c.khoa] === undefined,
    );
    expect(
      capMoi.length,
      "một tuyến TẮT 2FA mới, KHÔNG đòi bằng chứng nào và KHÔNG dọn `backup_codes`, đứng cạnh hai\n" +
        "tuyến tắt 2FA đã có mà lưới KHÔNG đỏ ⇒ lưới đang canh theo FILE, không theo ĐƯỜNG THOÁT.",
    ).toBeGreaterThanOrEqual(2);
    // …và nó phải ghép với ĐÚNG hai tuyến song song đã có, không phải với một cái ngẫu nhiên.
    const doiTac = new Set(capMoi.flatMap((c) => [c.a, c.b].map(tenDayDu)).filter((t) => !t.startsWith(FILE_MOI)));
    expect([...doiTac], "phải ghép với `twoFactor.disable`").toContain("server/routers/twoFactorRouter.ts#disable");
    expect([...doiTac], "phải ghép với `user.disable2FA`").toContain("server/routers/userRouters.ts#disable2FA");
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — cùng file mới ấy, nhưng KHỚP bên chặt hơn ⇒ KHÔNG bị bắt", () => {
    const ma = `
      import { router, protectedProcedure } from "../_core/trpc";
      import { appError } from "../_core/appError";
      import * as db from "../db";
      export const r = router({
        tatNhanh: protectedProcedure
          .input(z.object({ token: z.string().length(6), password: z.string().min(1) }))
          .mutation(async ({ ctx, input }) => {
            const bcrypt = await import("bcryptjs");
            const user = await db.getUserById(ctx.user.id);
            const biMat = await db.layBiMatNguoiDung(ctx.user.id);
            if (biMat.passwordHash) {
              const ok = await bcrypt.compare(input.password, biMat.passwordHash);
              if (!ok) throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "password" }, "sai");
            }
            const status = await db.get2FAStatus(ctx.user.id);
            if (!status?.twoFactorEnabled || !status.twoFactorSecret) {
              throw appError("BAD_REQUEST", "TWO_FACTOR_NOT_SET_UP", undefined, "chưa bật");
            }
            const { verifyTotpOnce } = await import("../_core/totpOnce");
            const valid = (await verifyTotpOnce({ userId: ctx.user.id, secret: status.twoFactorSecret, token: input.token })).hopLe;
            if (!valid) throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "twoFactorCode" }, "sai");
            await db.disable2FA(ctx.user.id);
            await db.xoaMoiMaDuPhong(ctx.user.id);
            return { success: true };
          }),
      });`;
    const themVao = donViTrongNguon(FILE_MOI, ma, TAI_NGUYEN, BAN_DO);
    expect(themVao.length, "thủ tục phải vào được lượng từ").toBeGreaterThanOrEqual(1);
    const voi = capSongSong([...DON_VI, ...themVao]).filter(
      (c) => c.khoa.includes(FILE_MOI) && [c.a, c.b].map(tenDayDu).includes("server/routers/userRouters.ts#disable2FA"),
    );
    expect(voi.length, "phải ghép được với `user.disable2FA`").toBe(1);
    expect(
      voi[0]!.lech,
      "một tuyến KHỚP HOÀN TOÀN bên chặt hơn vẫn bị bắt ⇒ lưới đang canh CHÍNH TẢ, không canh luật",
    ).toEqual([]);
  });
});

describe("★★★ Pha 5/8 Task 5 §5 — ĐỐI CHỨNG DƯƠNG trên cặp Pha 7 ĐÃ VÁ", () => {
  it("★★★ `twoFactor.generateSecret ≡ user.setup2FA` nằm TRONG lượng từ và KHỚP", () => {
    /**
     * ⚠ Brief của Pha 8 khai cặp này là **CRITICAL chưa vá**. Phép đo hôm nay nói **đã vá** — ở
     * Pha 7 / review TOÀN NHÁNH C-1 (`userRouters.ts` mang `if (user?.twoFactorEnabled) throw`).
     * Ô này giữ cho câu ấy **đo lại được mỗi lượt chạy**, thay vì là một lời kể.
     */
    const c = CAP.find(
      (x) =>
        [x.a, x.b].map(tenDayDu).includes("server/routers/twoFactorRouter.ts#generateSecret") &&
        [x.a, x.b].map(tenDayDu).includes("server/routers/userRouters.ts#setup2FA"),
    );
    expect(c, "cặp GHI HẠT GIỐNG rơi khỏi lượng từ ⇒ bộ suy đang mù đúng cặp C-1 vá").toBeTruthy();
    expect(c!.neo, "neo phải là lượt ghi hạt giống TOTP").toContain("userSecrets.twoFactorSecret=*");
    expect(c!.lech, "hai tuyến ghi hạt giống TOTP đã bất đồng trở lại").toEqual([]);
  });

  it("★★★ bốn tuyến THU HỒI PHIÊN khớp nhau (đối chứng dương thứ hai, trên một trục khác)", () => {
    const ten = (d: DonViXuLy): string => tenDayDu(d);
    const nhom = [
      "server/routers/sessionRouter.ts#revoke",
      "server/routers/sessionRouter.ts#revokeAll",
      "server/routers/userRouters.ts#revokeSession",
      "server/routers/userRouters.ts#revokeAllSessions",
    ];
    const trong = CAP.filter((c) => nhom.includes(ten(c.a)) && nhom.includes(ten(c.b)));
    expect(trong.length, "bốn tuyến thu hồi phiên phải tạo ra 6 cặp trong lượng từ").toBe(6);
    expect(
      trong.filter((c) => c.lech.length > 0).map((c) => c.khoa).join("\n"),
      "bốn tuyến thu hồi phiên vốn KHỚP — một cặp đỏ ở đây là hồi quy thật",
    ).toBe("");
  });
});

describe("★★★★ Pha 5/8 Task 5 §6 — lượng từ có TỰ THOẢ không: đột biến trên chính cơ chế miễn trừ", () => {
  it("★★★★ một chênh lệch MỚI trên một cặp ĐÃ KHAI vẫn phải bị bắt", () => {
    /**
     * ⚠⚠⚠ Đây là ca duy nhất chứng minh miễn trừ **không phải một vé trắng**. Nếu `MIEN_TRU` được so
     * theo **tên cặp**, ô này XANH một cách vô nghĩa và cặp đã khai thành vùng mù vĩnh viễn.
     */
    const khoa = "server/routers/twoFactorRouter.ts#disable | server/routers/userRouters.ts#disable2FA";
    const that = CAP.find((c) => c.khoa === khoa);
    expect(that, "cặp neo của ca này phải tồn tại").toBeTruthy();
    const gia = { ...that!, lech: [...that!.lech, "B+o:mocGiaDinh"].sort() };
    expect(bang(gia.lech, MIEN_TRU[khoa]!.lech), "chênh lệch MỚI trên cặp đã khai vẫn LỌT ⇒ miễn trừ là vé trắng").toBe(false);
  });

  it("★★★★ tập KHAI không được rộng hơn tập bất đồng — miễn trừ không được 'phủ trước' cặp chưa sinh", () => {
    const khoaThat = new Set(CAP.filter((c) => c.lech.length > 0).map((c) => c.khoa));
    const thua = Object.keys(MIEN_TRU).filter((k) => !khoaThat.has(k));
    expect(
      thua.join("\n"),
      "một lời khai không ứng với bất đồng nào đang tồn tại. Đó là chỗ để ai đó khai TRƯỚC cho một\n" +
        "cặp sắp viết ⇒ lượng từ tự thoả. Gỡ lời khai ấy đi.",
    ).toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §7 — LƯỚI **HÀNH VI**. Mọi ô trên đọc HÌNH DẠNG mã; ô dưới **gọi thật** và đọc giá trị trả về.
 * ⚠ `if (true) return …` đã ship được qua một lưới quét mã đầy đủ — nên nửa này không thay thế
 *   được, và cũng không bị thay thế.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const OPEN_ID = `t5_phien_${Date.now()}`;
let uid = 0;

async function ctxCua(token: string | null): Promise<TrpcContext> {
  const hang = await db.getUserById(uid);
  return {
    user: hang as unknown as User,
    sessionToken: token,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  };
}

describe("★★★ Pha 5/8 Task 5 §7 — HÀNH VI: `user.getSessions` KHÔNG phát ra khoá phiên", () => {
  beforeAll(async () => {
    const r = await db.createLocalUser({
      username: OPEN_ID,
      passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
      name: "Task 5 — phép chiếu phiên",
      role: "user",
    });
    uid = r.id;
  });

  afterAll(async () => {
    if (uid) await db.deleteUser(uid);
  });

  it("★★★★ hàng phiên có `sessionToken` trong DB, nhưng giá trị trả về thì KHÔNG", async () => {
    expect(uid).toBeGreaterThan(0);
    const token = `t5_token_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.createUserSession({
      userId: uid,
      sessionToken: token,
      deviceName: "vitest",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // Cầu chì: bảng THẬT SỰ giữ token — nếu không, ô dưới là chân lý rỗng.
    const hang = await db.getUserSessions(uid);
    expect(hang.length, "cầu chì: phải có đúng một phiên vừa dựng").toBeGreaterThanOrEqual(1);
    expect(
      hang.some((h) => h.sessionToken === token),
      "cầu chì: `db.getUserSessions` phải đọc THÔ (có token) — đó chính là thứ phép chiếu phải chặn",
    ).toBe(true);

    const ra = await appRouter.createCaller(await ctxCua(token)).user.getSessions();
    expect(ra.length, "thủ tục phải trả về phiên vừa dựng").toBeGreaterThanOrEqual(1);
    const chuoi = JSON.stringify(ra);
    expect(
      chuoi.includes(token),
      "KHOÁ PHIÊN rời máy chủ. Ai đọc được response này LÀ người dùng ấy, trên MỌI thiết bị.",
    ).toBe(false);
    for (const cot of ["sessionToken", "userId", "isActive"]) {
      expect(Object.keys(ra[0]!), `cột \`${cot}\` phải KHÔNG có trong phép chiếu công khai`).not.toContain(cot);
    }
    // …và ô SUY RA vẫn cho client biết phiên nào là phiên của nó (thu hẹp, không phải mất chức năng).
    expect(ra.some((s) => s.isCurrent === true), "`isCurrent` phải suy ra được ở máy chủ").toBe(true);
    expect(ra[0]!.deviceName, "các cột công khai vẫn phải ra").toBe("vitest");
  }, 20_000);
});
