const DEFAULT_WAIT_BUDGET_MS = 180_000;

let dangGiu = false;
const hangCho: Array<() => void> = [];

export interface MeasureWindowResult<T> { readonly value: T; readonly measurable: boolean }

export function measureWindowDepth(): number { return dangGiu ? 1 : 0; }

export function __resetMeasureLockForTests(): void {
  dangGiu = false;
  hangCho.length = 0;
}

function nhaKhoa(): void {
  const tiepTheo = hangCho.shift();
  if (tiepTheo) { tiepTheo(); return; }
  dangGiu = false;
}

function giuKhoa(waitBudgetMs: number): Promise<boolean> {
  if (!dangGiu) { dangGiu = true; return Promise.resolve(true); }
  return new Promise<boolean>((resolve) => {
    let xong = false;
    const hen = setTimeout(() => {
      if (xong) return;
      xong = true;
      const i = hangCho.indexOf(danhDau);
      if (i >= 0) hangCho.splice(i, 1);
      resolve(false);           // het ngan sach: chay tiep, KHONG do
    }, waitBudgetMs);
    const danhDau = () => {
      if (xong) { nhaKhoa(); return; }  // da bo cuoc — chuyen luot ngay
      xong = true;
      clearTimeout(hen);
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
 * Het ngan sach cho => VAN CHAY, chi mat phep do (`measurable: false`).
 * Chan nguoi dung de giu phep do la danh doi sai.
 */
export async function withMeasureWindow<T>(
  fn: () => Promise<T>,
  waitBudgetMs: number = DEFAULT_WAIT_BUDGET_MS,
): Promise<MeasureWindowResult<T>> {
  const doDuoc = await giuKhoa(waitBudgetMs);
  if (!doDuoc) return { value: await fn(), measurable: false };
  try {
    return { value: await fn(), measurable: true };
  } finally {
    nhaKhoa();
  }
}
