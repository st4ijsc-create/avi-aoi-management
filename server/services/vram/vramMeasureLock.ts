import type { VramPriority } from "./types";

const DEFAULT_WAIT_BUDGET_MS = 180_000;
const DEFAULT_OWNER_LABEL = "(khong-nhan)";

/**
 * ★★★ Pha 2B Task 5 — CỔNG 2: HÀNG CHỜ NAY BIẾT ƯU TIÊN, VÀ CÓ CHỐNG CHẾT ĐÓI.
 *
 * LỖI ĐANG VÁ (I-3, review TOÀN NHÁNH — **đang chạy ở Pha 2A**, không phải rủi ro tương lai): hàng
 * chờ là **FIFO thuần**, trong khi `vramBroker` đã biết `VramPriority` từ Pha 1. Một lượt kiểm AOI
 * mức `production` trượt cache phiên xếp hàng SAU một việc nền (`gguf-embed-ctx`, `reranker`) hoặc
 * sau một lượt nạp 30B (11–43 s **+** tạo context + biên lắng + hai đầu dò), với ngân sách chờ mặc
 * định **180 s**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ƯU TIÊN THUẦN LÀ MỘT CÁI BẪY: NÓ ĐỔI MỘT VẤN ĐỀ **ĐỘ TRỄ** LẤY MỘT VẤN ĐỀ **TREO VĨNH VIỄN**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Với một hàng chờ chỉ xếp theo rank, một dòng `production` liên tục (đường kiểm tra AOI **là**
 * một dòng liên tục) giữ việc nền ở cuối hàng **mãi mãi**. Kết cục không phải "chậm" mà là "không
 * bao giờ" — và nó tệ hơn cái nó vừa vá.
 *
 * ⇒ Hạng dùng để chọn là **HẠNG HIỆU LỰC**, không phải hạng khai báo:
 *
 *     hangHieuLuc = rank + floor(thoiGianCho / MEASURE_QUEUE_PROMOTE_EVERY_MS)
 *
 * Nó **tăng không giới hạn theo thời gian chờ**, nên với mọi hạng cố định của kẻ mới tới, một kẻ
 * đang chờ CHẮC CHẮN vượt qua sau hữu hạn thời gian. Đó là một lập luận về giới hạn, không phải
 * một lời hứa: `background` (rank 1) vượt `production` (rank 3) sau **2 khoảng nâng hạng**. Hoà
 * hạng ⇒ **FIFO** (ai vào trước chạy trước), nên công bằng trong cùng mức không bị ưu tiên phá.
 *
 * ⚠ KHÔNG "vá" bằng cách hạ `VRAM_MEASURE_WAIT_MS`: nhánh hết-giờ đang gánh vai LƯỚI CHỐNG BẾ TẮC
 * (thứ tự khoá với `withGgufSlot` không nhất quán giữa các đường gọi — xem `withMeasureWindow`).
 * Hạ nó là đổi "mất phép đo" (an toàn) lấy "treo cứng" (không an toàn).
 */
export const MEASURE_QUEUE_PROMOTE_EVERY_MS = 10_000;

const RANK: Record<VramPriority, number> = { production: 3, interactive: 2, background: 1 };

/**
 * ⚠ MẶC ĐỊNH `background` — mặc định AN TOÀN, và đây là chỗ dễ chọn sai nhất: một mặc định
 * `production` khiến MỌI điểm gọi chưa khai mức tự động chen lên đầu hàng, tức ưu tiên bị vô hiệu
 * hoá bởi chính sự im lặng. Người muốn chen phải NÓI RA.
 */
const DEFAULT_PRIORITY: VramPriority = "background";

let dangGiu = false;

interface MucCho {
  readonly danhDau: () => void;
  readonly rank: number;
  readonly vaoLucMs: number;
}
const hangCho: MucCho[] = [];

// review vong 1 Critical (C-1) — dem cac luot BO CUOC dang chay o ngoai khoa, de
// nguoi dang GIU biet cua so cua minh co bi mot luot khong-do "chay xen" hay
// khong. `unmeasuredInFlight` la so luot bo-cuoc dang chay NGAY LUC NAY;
// `unmeasuredStarted` la bo dem CHI TANG, dung de phat hien luot bo-cuoc bat dau
// GIUA cua so (xem giai thich day du o docstring cua withMeasureWindow).
let unmeasuredInFlight = 0;
let unmeasuredStarted = 0;

// review vong 1 Important (I-2) — nhan cua nguoi dang giu khoa NGHIEM TUC hien
// tai, de dong canh bao het-ngan-sach neu duoc CA HAI phia (ai bo cuoc, ai dang
// giu) thay vi cam lang.
let currentHolderLabel: string = DEFAULT_OWNER_LABEL;

export interface MeasureWindowResult<T> { readonly value: T; readonly measurable: boolean }

export function measureWindowDepth(): number { return dangGiu ? 1 : 0; }

/**
 * ★★★ Pha 4 Task 4 (re-review, N-9) — **PHÉP PHÂN BIỆT "CHẬM" VỚI "KẸT".**
 *
 * Ở đúng module này, *"chậm vì tranh tài nguyên"* và *"kẹt vì một cửa sổ đo KHÔNG BAO GIỜ ĐÓNG"*
 * cho **CÙNG một triệu chứng**: `Test timed out in 5000ms`. Hai ô dưới đây tách được chúng ra —
 * ở lượt dọn cuối, một hệ CHẬM có **hàng chờ RỖNG** và **0 lượt bỏ-cuộc đang bay**, còn một hệ KẸT
 * thì không.
 *
 * ⚠ CHỈ ĐỌC, chỉ dùng cho chẩn đoán/lưới — cùng hạng với `measureWindowDepth()`. Không một quyết
 * định cấp phát nào đọc hai ô này.
 */
export function __measureLockIdleFacts(): { readonly queued: number; readonly unmeasuredInFlight: number } {
  return { queued: hangCho.length, unmeasuredInFlight };
}

export function __resetMeasureLockForTests(): void {
  dangGiu = false;
  hangCho.length = 0;
  unmeasuredInFlight = 0;
  unmeasuredStarted = 0;
  currentHolderLabel = DEFAULT_OWNER_LABEL;
}

/**
 * HẠNG HIỆU LỰC — hạng khai báo cộng phần NÂNG theo thời gian chờ. Xem khối docstring đầu file:
 * đây là toàn bộ cơ chế chống chết đói, và nó là một hàm THUẦN để đọc được bằng mắt.
 */
function hangHieuLuc(m: MucCho, nowMs: number): number {
  const cho = Math.max(0, nowMs - m.vaoLucMs);
  return m.rank + Math.floor(cho / MEASURE_QUEUE_PROMOTE_EVERY_MS);
}

/** Chọn người kế tiếp: hạng hiệu lực CAO NHẤT; hoà ⇒ **FIFO** (vào trước chạy trước). */
function chonNguoiKeTiep(): MucCho | undefined {
  if (hangCho.length === 0) return undefined;
  const now = Date.now();
  let iTot = 0;
  for (let i = 1; i < hangCho.length; i++) {
    const a = hangHieuLuc(hangCho[i]!, now);
    const b = hangHieuLuc(hangCho[iTot]!, now);
    // `>` chứ KHÔNG `>=`: bằng hạng thì giữ nguyên người đứng TRƯỚC trong mảng = FIFO.
    if (a > b) iTot = i;
  }
  return hangCho.splice(iTot, 1)[0];
}

function nhaKhoa(): void {
  const tiepTheo = chonNguoiKeTiep();
  if (tiepTheo) { tiepTheo.danhDau(); return; }
  dangGiu = false;
  currentHolderLabel = DEFAULT_OWNER_LABEL;
}

function giuKhoa(waitBudgetMs: number, ownerLabel: string, priority: VramPriority): Promise<boolean> {
  if (!dangGiu) { dangGiu = true; currentHolderLabel = ownerLabel; return Promise.resolve(true); }
  return new Promise<boolean>((resolve) => {
    let xong = false;
    const hen = setTimeout(() => {
      if (xong) return;
      xong = true;
      const i = hangCho.findIndex((m) => m.danhDau === danhDau);
      if (i >= 0) hangCho.splice(i, 1);
      // I-2 — hoan phai CO DAY va CO TIENG (spec §5.4): mot dong canh bao neu ro
      // CA hai phia, khong duoc cam lang.
      console.warn(
        `[vram] "${ownerLabel}" het ngan sach cho khoa do cua so (${waitBudgetMs}ms) — ` +
          `dang bi giu boi "${currentHolderLabel}"; chay tiep KHONG do (measurable=false).`,
      );
      resolve(false);           // het ngan sach: chay tiep, KHONG do
    }, waitBudgetMs);
    /**
     * ★★ T2-M4 / M-7 (review TOAN NHANH) — `.unref()`, VA DAY LA LY DO PHAI CO NO.
     *
     * Task 6 da phan tich dung lop cau hoi nay cho hen gio bien lang (`vramProcessProbe.ts`,
     * `awaitCounterSettle`) roi GIU `.unref()` cho mot hen gio **250 ms**, voi ly do: *"mot hen gio
     * co `ref` giu tien trinh song them o MOI luot cap phat dang bay… do la ranh gioi telemetry
     * CHI QUAN SAT ma module nay tu cam minh vuot"*. Hen gio NAY giu tien trinh song toi **180
     * giay** — dai hon **720 lan** — nen neu nguyen tac do dung o 250 ms thi no dung gap boi o day.
     * Hai quyet dinh doi lap ve CUNG mot nguyen tac, trong CUNG mot pha, la thu khong duoc de lai.
     *
     * ⚠ CAI MAT, noi du de nguoi sau khong phai tu phat hien (cung khuon voi M-4 cua Task 6): neu
     * hen gio nay la thu DUY NHAT con giu vong lap su kien, tien trinh thoat va loi hua **khong
     * bao gio giai** ⇒ `giuKhoa()` khong tra, `beginVramAllocation()` dung giua chung. Moi thu mat
     * theo deu la trang thai TRONG BO NHO cua mot tien trinh dang chet (khoa, so cua so, giay phep
     * do dang) — chung bien mat cung no. Ve doi lap thi khong vo hai: telemetry gianh quyen quyet
     * dinh luc nao tien trinh duoc phep thoat, toi 3 phut moi luot cho.
     *
     * ⚠ `.unref?.()` qua ep kieu vi `setTimeout` trong `lib.dom` tra `number` (khong co `unref`),
     * con o Node la `Timeout` (co). Giu nguyen khuon cua `awaitCounterSettle` de hai cho doc giong
     * nhau.
     */
    (hen as unknown as { unref?: () => void }).unref?.();
    const danhDau = () => {
      // review vong 2 — nhanh nay BAT KHA DAT THEO CAU TRUC chung nao `splice` o
      // tren con nam trong callback hen gio: `xong` chi chuyen false->true o HAI
      // cho (o day va trong callback hen gio), va callback hen gio dat `xong =
      // true` roi `splice` chinh no ra khoi `hangCho` TRONG CUNG mot khoi dong bo,
      // khong co diem nhuong nao o giua — nen MOI entry con trong `hangCho` khi
      // `nhaKhoa()` goi toi day luon co `xong === false`. Vi vay "go rieng nhanh
      // nay ⇒ 0 ca do" la TUONG DUONG DA CHUNG MINH bang thuc nghiem co doi chung
      // (thay than bang `throw` -> 14/14 xanh, khong lan nao chay; doi chung go
      // splice giu nguyen nhanh nem -> 10/14 do, tuc dung cu do CO kha nang bat,
      // nen so 0 la am tinh THAT) — MIEN TRU tuong minh khoi rang buoc toan cuc 5,
      // KHONG PHAI lo hong test. Giu lai vi day la thu DUY NHAT do duoc khoa rò
      // vinh vien neu mot ban sua tuong lai lam mat `splice` o tren.
      if (xong) { nhaKhoa(); return; }  // da bo cuoc — chuyen luot ngay, KHONG nuot
      xong = true;
      clearTimeout(hen);
      currentHolderLabel = ownerLabel;
      resolve(true);
    };
    hangCho.push({ danhDau, rank: RANK[priority], vaoLucMs: Date.now() });
  });
}

/**
 * Noi tiep hoa CUA SO DO trong mot tien trinh.
 *
 * KHONG cung loai voi ba khoa in-flight (`inFlightLoads`,
 * `embeddingContextInFlight`, `textContextInFlight`): ba khoa do chong LAM TRUNG
 * VIEC cho CUNG mot model. Khoa nay noi tiep HAI MODEL KHAC NHAU, vi bo dem
 * `\GPU Process Memory` tra MOT so cho moi PID va khong tach duoc hai khoi
 * trong cung tien trinh (dieu kien D1, spec §10).
 *
 * review vong 1 Critical (C-1) — brief GOC SAI o day (khong phai loi chep): CHI
 * giu khoa la KHONG DU de khai measurable:true. Mot luot BO CUOC (het ngan sach)
 * van CHAY o ngoai khoa, va no co the chay XEN vao dung khoang thoi gian ma
 * nguoi giu dang do — so byte cua no bi CONG LAN vao phep do cua nguoi giu, tai
 * sinh dung lop loi cong-trung ma co che nay dung ra de diet. Vi vay mot cua so
 * chi duoc khai measurable:true khi KHONG co luot bo-cuoc-dang-chay nao chong len
 * no, du chi mot phan — kiem qua HAI VE doc lap:
 *   (a) cleanStart = unmeasuredInFlight===0 LUC MO cua so — bat luot bo cuoc DA
 *       chay tu TRUOC khi cua so mo;
 *   (b) unmeasuredStarted khong doi tu luc MO den luc DONG — bat luot bo cuoc BAT
 *       DAU GIUA CHUNG (sau khi mo, truoc khi dong).
 * Thieu ve nao cung lot mot lop chong-trung.
 *
 * review vong 1 Important (I-4) — thu tu khoa VOI `withGgufSlot`
 * (ggufConcurrency.ts) KHONG DONG NHAT giua cac duong goi trong aiGgufEngine.ts:
 * `generateText()` lay context (`ensureTextContext`, ~dong 1551/1560) NAM NGOAI
 * `withGgufSlot`, trong khi `generateEmbedding()`/`generateEmbeddings()` lay
 * context (`getEmbeddingContext`, ~dong 2697/2734) NAM BEN TRONG `withGgufSlot`.
 * Khi mot khoa noi tiep khac (nhu khoa nay) duoc noi quanh CA HAI duong o Task 3,
 * thu tu long khoa se KHONG DONG NHAT theo tung model — nghia la
 * `waitBudgetMs`/nhanh het-gio o day dang AM THAM ganh vai tro LUOI CHONG BE TAC
 * CO CHU Y, khong chi la "hoan co day". HA waitBudgetMs xuong 0 hoac BO nhanh
 * het-gio se doi be tac tu "mat phep do" (an toan) thanh "treo cung vinh vien"
 * (khong an toan). Dung tu y thu tieu nhanh nay.
 *
 * ⚠⚠ C-1 (review TOAN NHANH) — PHAM VI CUA KHOA NAY: no noi tiep hoa cac luot **CAP PHAT** di qua
 * `beginVramAllocation()`. No **KHONG** noi tiep hoa cac luot **NHA**: `ticket.release()` khong lay
 * khoa, va `measurable` o duoi chi dem cac luot BO CUOC — no KHONG dem luot nha. Nghia la mot luot
 * nha xen giua hai dau do van cho `measurable === true` trong khi hieu so da bi TRU BOT. Lop lo do
 * duoc bat o TANG TREN (`vramWiring.ts`, nhanh `release-during-measure-window`) bang mot so rieng
 * (`OpenMeasureWindow.releasedDuring`), KHONG bang bo dem cua khoa nay. ⚠ Dung tuong `measurable:
 * true` nghia la "khong ai dong vao thiet bi trong cua so nay" — no chi nghia la "khong luot CAP
 * PHAT khong-do nao chay xen".
 *
 * Het ngan sach cho => VAN CHAY, chi mat phep do (`measurable: false`), va ghi
 * MOT dong canh bao neu ro CA nguoi bo cuoc lan nguoi dang giu (I-2, xem
 * `giuKhoa`). Chan nguoi dung de giu phep do la danh doi sai.
 *
 * @param ownerLabel nhan ngan cua hop tieu thu dang goi (vd modelId) — dung cho
 *   dong canh bao khi het ngan sach cho. Tuy chon; khong truyen thi dung nhan
 *   mac dinh ro rang (khong phai chuoi rong). Task 2 khong bat buoc goi phai
 *   truyen nhan nay — chu ky cu (fn) va (fn, waitBudgetMs) van hoat dong nguyen ven.
 * @param priority ★ Pha 2B Task 5 (cổng 2) — mức ưu tiên trong HÀNG CHỜ. Mặc định `background`:
 *   xem `DEFAULT_PRIORITY` để biết vì sao mặc định phải là mức THẤP NHẤT.
 */
export async function withMeasureWindow<T>(
  fn: () => Promise<T>,
  waitBudgetMs: number = DEFAULT_WAIT_BUDGET_MS,
  ownerLabel: string = DEFAULT_OWNER_LABEL,
  priority: VramPriority = DEFAULT_PRIORITY,
): Promise<MeasureWindowResult<T>> {
  const doDuoc = await giuKhoa(waitBudgetMs, ownerLabel, priority);
  if (!doDuoc) {
    unmeasuredStarted++;
    unmeasuredInFlight++;
    try {
      return { value: await fn(), measurable: false };
    } finally {
      unmeasuredInFlight--;
    }
  }
  const cleanStart = unmeasuredInFlight === 0;
  const startedAtOpen = unmeasuredStarted;
  try {
    const value = await fn();
    return { value, measurable: cleanStart && unmeasuredStarted === startedAtOpen };
  } finally {
    nhaKhoa();
  }
}
