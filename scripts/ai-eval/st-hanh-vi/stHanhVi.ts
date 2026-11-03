/**
 * ★ Đợt 12 B1 (dieu-phoi duyệt 03/11) — bộ chấm Structured Text theo HÀNH VI, CHỈ dùng trong test / đo (không server / client / shared).
 * Động cơ: `vendor/oip-plc` (Open Industry Project, MIT, commit 8970f09 — xem `vendor/oip-plc/THIRD_PARTY.md`), CHỈ AST walker.
 *
 * ST do model sinh là ĐẦU VÀO KHÔNG TIN CẬY ⇒ ba lớp chặn sinh mã, lớp nào cũng đủ một mình:
 *   (1) `setScanEngine('walker')` khi nạp module này + kiểm lại trước MỖI `compile` (ai đó đổi engine giữa chừng ⇒ ném);
 *   (2) BẪY: trong `compile` và mọi `scan`, `globalThis.Function` / `globalThis.eval` là hàm NÉM, trả lại trong `finally`;
 *   (3) `vendor/oip-plc/va-vendor.patch`: `evaluate()` của scanCodegen NÉM thay vì `new Function`.
 * Thời gian mô phỏng tất định: `quet(dt)` = một lần quét với bước `dt` GIÂY (TON / TOF / TP đếm theo tổng dt, không đồng hồ thật).
 * MATIEC vẫn là cổng BIÊN DỊCH của Đợt 9; đây là điểm HÀNH VI bổ sung.
 */
import { compile, setScanEngine } from "../../../vendor/oip-plc/src/plc/interpreter";
import type { CompiledProgram, TagValue } from "../../../vendor/oip-plc/src/plc/types";

setScanEngine("walker");

/** Lỗi khi mã (vendor hay bất kỳ ai) cố sinh / đánh giá mã từ chuỗi trong lúc compile / quét. */
export class LoiSinhMa extends Error {
  constructor(public readonly cach: "Function" | "eval") {
    super(`cam sinh ma (bay bo boc st-hanh-vi): ${cach}`);
    this.name = "LoiSinhMa";
  }
}

/** Chạy `f` với `Function` / `eval` toàn cục bị thay bằng hàm NÉM; luôn trả lại (kể cả khi `f` ném). */
export function voiBaySinhMa<T>(f: () => T): T {
  const g = globalThis as { Function: FunctionConstructor; eval: typeof eval };
  const F = g.Function;
  const E = g.eval;
  const camF = function () {
    throw new LoiSinhMa("Function");
  } as unknown as FunctionConstructor;
  const camE = (() => {
    throw new LoiSinhMa("eval");
  }) as unknown as typeof eval;
  g.Function = camF;
  g.eval = camE;
  try {
    return f();
  } finally {
    g.Function = F;
    g.eval = E;
  }
}

export interface MayST {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  datVao(ten: string, giaTri: TagValue): void;
  doc(ten: string): TagValue | undefined;
  /** `lan` lần quét, mỗi lần bước `dt` giây. */
  quet(dt: number, lan?: number): void;
}

/** Biên dịch ST (đã kiểm kiểu bởi checker của OIP) trên AST walker. Lỗi cú pháp / kiểu ⇒ ném `StError` của OIP. */
export function bienDichST(nguon: string): MayST {
  // lớp (1): kiểm lại engine ngay trước compile — đổi lại ngay, ném nếu ai đó đã đặt khác
  const truoc = setScanEngine("walker");
  if (truoc !== "walker") throw new Error(`st-hanh-vi: engine bi doi thanh '${truoc}' — tu choi bien dich`);
  const p: CompiledProgram = voiBaySinhMa(() => compile(nguon));
  return {
    inputs: p.inputs,
    outputs: p.outputs,
    datVao: (ten, v) => p.setInput(ten, v),
    doc: (ten) => p.get(ten),
    quet: (dt, lan = 1) =>
      voiBaySinhMa(() => {
        for (let i = 0; i < lan; i++) p.scan(dt);
      }),
  };
}

/** Một bước kịch bản: đặt đầu vào, quét `lan` lần với `dt` giây, rồi so các biến kỳ vọng. */
export interface BuocKichBan {
  vao?: Record<string, TagValue>;
  dt: number;
  lan?: number;
  ky?: Record<string, TagValue>;
  /** nhãn hiện trong lệch (vd "t=0.5s") */
  nhan?: string;
}

export interface KetQuaKichBan {
  dat: boolean;
  lech: Array<{ buoc: number; nhan?: string; ten: string; ky: TagValue; thuc: TagValue | undefined }>;
  /** lỗi biên dịch / chạy (StError, lỗi quét…) — có lỗi ⇒ `dat = false` */
  loi?: string;
}

/** Chấm một chương trình ST theo kịch bản. Không ném vì lỗi của ST (đầu vào không tin cậy) — trả `loi`; lỗi SINH MÃ thì NÉM (lỗi an toàn). */
export function chamKichBan(nguon: string, buoc: readonly BuocKichBan[]): KetQuaKichBan {
  let may: MayST;
  try {
    may = bienDichST(nguon);
  } catch (e) {
    if (e instanceof LoiSinhMa) throw e;
    return { dat: false, lech: [], loi: `bien-dich: ${(e as Error).message}` };
  }
  const lech: KetQuaKichBan["lech"] = [];
  for (let i = 0; i < buoc.length; i++) {
    const b = buoc[i]!;
    try {
      for (const [k, v] of Object.entries(b.vao ?? {})) may.datVao(k, v);
      may.quet(b.dt, b.lan ?? 1);
    } catch (e) {
      if (e instanceof LoiSinhMa) throw e;
      return { dat: false, lech, loi: `quet buoc ${i}: ${(e as Error).message}` };
    }
    for (const [k, v] of Object.entries(b.ky ?? {})) {
      const thuc = may.doc(k);
      if (thuc !== v) lech.push({ buoc: i, ...(b.nhan ? { nhan: b.nhan } : {}), ten: k, ky: v, thuc });
    }
  }
  return { dat: lech.length === 0, lech };
}
