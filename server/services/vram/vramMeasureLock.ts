const DEFAULT_WAIT_BUDGET_MS = 180_000;
const DEFAULT_OWNER_LABEL = "(khong-nhan)";

let dangGiu = false;
const hangCho: Array<() => void> = [];

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

export function __resetMeasureLockForTests(): void {
  dangGiu = false;
  hangCho.length = 0;
  unmeasuredInFlight = 0;
  unmeasuredStarted = 0;
  currentHolderLabel = DEFAULT_OWNER_LABEL;
}

function nhaKhoa(): void {
  const tiepTheo = hangCho.shift();
  if (tiepTheo) { tiepTheo(); return; }
  dangGiu = false;
  currentHolderLabel = DEFAULT_OWNER_LABEL;
}

function giuKhoa(waitBudgetMs: number, ownerLabel: string): Promise<boolean> {
  if (!dangGiu) { dangGiu = true; currentHolderLabel = ownerLabel; return Promise.resolve(true); }
  return new Promise<boolean>((resolve) => {
    let xong = false;
    const hen = setTimeout(() => {
      if (xong) return;
      xong = true;
      const i = hangCho.indexOf(danhDau);
      if (i >= 0) hangCho.splice(i, 1);
      // I-2 — hoan phai CO DAY va CO TIENG (spec §5.4): mot dong canh bao neu ro
      // CA hai phia, khong duoc cam lang.
      console.warn(
        `[vram] "${ownerLabel}" het ngan sach cho khoa do cua so (${waitBudgetMs}ms) — ` +
          `dang bi giu boi "${currentHolderLabel}"; chay tiep KHONG do (measurable=false).`,
      );
      resolve(false);           // het ngan sach: chay tiep, KHONG do
    }, waitBudgetMs);
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
    hangCho.push(danhDau);
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
 * Het ngan sach cho => VAN CHAY, chi mat phep do (`measurable: false`), va ghi
 * MOT dong canh bao neu ro CA nguoi bo cuoc lan nguoi dang giu (I-2, xem
 * `giuKhoa`). Chan nguoi dung de giu phep do la danh doi sai.
 *
 * @param ownerLabel nhan ngan cua hop tieu thu dang goi (vd modelId) — dung cho
 *   dong canh bao khi het ngan sach cho. Tuy chon; khong truyen thi dung nhan
 *   mac dinh ro rang (khong phai chuoi rong). Task 2 khong bat buoc goi phai
 *   truyen nhan nay — chu ky cu (fn) va (fn, waitBudgetMs) van hoat dong nguyen ven.
 */
export async function withMeasureWindow<T>(
  fn: () => Promise<T>,
  waitBudgetMs: number = DEFAULT_WAIT_BUDGET_MS,
  ownerLabel: string = DEFAULT_OWNER_LABEL,
): Promise<MeasureWindowResult<T>> {
  const doDuoc = await giuKhoa(waitBudgetMs, ownerLabel);
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
