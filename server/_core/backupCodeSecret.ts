/**
 * ★★★ Pha 7 Task 8a — **CHỦ DUY NHẤT của mã dự phòng 2FA.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI KIỂU, KHÔNG PHẢI "XOÁ HÀM"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước bản vá, bảng `backup_codes` có **HAI người ghi dưới HAI luật**:
 *   · `server/db/auth.ts:generateBackupCodes()` — ghi **PLAINTEXT**;
 *   · `server/routers/twoFactorRouter.ts` — ghi **bcrypt**.
 * Đó là lớp *"hai bản sao của một vị từ dưới một bất biến"* — trong dự án này đã phải **ĐỔI KIỂU
 * 5 lần** để diệt, và **thêm ca test không giải được**: xoá một hàm chỉ dời thời điểm hàm thứ hai
 * mọc lại, ở **file thứ N+1**.
 *
 * Nên bất biến được đặt vào **KIỂU**, không vào một danh sách file:
 *
 *   > ***Giá trị duy nhất gán được vào `backup_codes.code` là giá trị do `bamMaDuPhong()` trả về.***
 *
 * `backupCodes.code` mang nhãn `MaDuPhongDaBam` (`.$type<…>()` ở `drizzle/schema/auth.ts`), và
 * **chỉ** hàm dưới đây sản xuất được nhãn ấy. Một `db.insert(backupCodes).values({ code: "ABCD" })`
 * viết ở **bất kỳ file nào, kể cả file chưa tồn tại**, là một **lỗi biên dịch** — không phải một
 * lỗi mà ai đó phải nhớ đi tìm.
 *
 * ⚠ Đây là bất biến ở **tầng KIỂU**, nên nó chỉ có giá trị khi `npm run check` thật sự chạy. Cổng
 *   hành vi đi kèm (`server/_core/backupCodeWriteScan.test.ts`) canh **hai lỗ mà kiểu không thấy**:
 *   ép kiểu (`as MaDuPhongDaBam` / `as any`) và việc ai đó **gỡ nhãn** khỏi cột.
 *
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI: nhãn nói *"chuỗi này ra từ `bamMaDuPhong`"*, **không** nói *"chuỗi này là
 *    một hash bcrypt hợp lệ"*. Ai viết `bamMaDuPhong` thành `return maTho as …` thì kiểu vẫn xanh;
 *    ca *"đối chứng dương — luồng băm vẫn chạy"* của lưới đi kèm mới bắt được điều đó.
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { InsertBackupCode } from "../../drizzle/schema/auth";

declare const NHAN_DA_BAM: unique symbol;

/**
 * Chuỗi **đã đi qua `bamMaDuPhong()`**. Nhãn danh nghĩa (nominal): không có literal nào, không có
 * phép nối chuỗi nào, không có `JSON.parse` nào tự sinh ra kiểu này.
 */
export type MaDuPhongDaBam = string & { readonly [NHAN_DA_BAM]: true };

/** Vòng băm bcrypt. Một chỗ, để đổi nó là một quyết định nói ra. */
export const VONG_BAM = 10;

/** Sinh **một** mã dự phòng ở dạng người đọc được (8 ký tự hex HOA). */
export function sinhMaDuPhong(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * ★★★ **Người sản xuất DUY NHẤT** của `MaDuPhongDaBam`.
 * Chuẩn hoá HOA trước khi băm để **một** luật so khớp phục vụ **mọi** người đọc (trước bản vá,
 * `server/db/auth.ts` so `code.toUpperCase()` còn `twoFactorRouter.ts` so chuỗi thô — hai luật).
 */
export async function bamMaDuPhong(maTho: string): Promise<MaDuPhongDaBam> {
  return (await bcrypt.hash(chuanHoa(maTho), VONG_BAM)) as MaDuPhongDaBam;
}

/** Đối chiếu mã người dùng gõ với một ô đã băm. Người đọc **duy nhất**. */
export async function khopMaDuPhong(maTho: string, daBam: string): Promise<boolean> {
  return bcrypt.compare(chuanHoa(maTho), daBam);
}

function chuanHoa(ma: string): string {
  return ma.trim().toUpperCase();
}

/**
 * ★★★ **CỔNG KIỂU TỰ CANH.** Nếu ai gỡ `.$type<MaDuPhongDaBam>()` khỏi cột `code` thì dòng dưới
 * **hết lỗi**, `@ts-expect-error` thành **chỉ thị thừa**, và `npm run check` **ĐỎ**.
 *
 * ⚠ Cố ý đặt ở đây chứ **không** ở một file `*.test.ts`: `tsconfig.json` loại trừ mọi file đuôi
 *   `.test.ts` (nợ toàn repo đã trả giá ở Pha 3), nên một `@ts-expect-error` viết trong file test
 *   thì **không ai kiểm**.
 */
// @ts-expect-error — bất biến: "ghi mã CHƯA BĂM" phải KHÔNG viết ra được
const _congKieuGhiMaChuaBam: InsertBackupCode["code"] = "MA-CHUA-BAM";
void _congKieuGhiMaChuaBam;
