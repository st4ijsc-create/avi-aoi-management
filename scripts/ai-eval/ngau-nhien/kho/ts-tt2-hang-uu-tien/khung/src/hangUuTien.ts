export type SoSanh<T> = (a: T, b: T) => number;

export class HangUuTien<T> {
  constructor(soSanh: SoSanh<T>, khoaCua?: (x: T) => string) {
    throw new Error("chưa làm");
  }

  size(): number {
    throw new Error("chưa làm");
  }

  peek(): T | undefined {
    throw new Error("chưa làm");
  }

  push(x: T): void {
    throw new Error("chưa làm");
  }

  pop(): T | undefined {
    throw new Error("chưa làm");
  }

  capNhat(x: T): boolean {
    throw new Error("chưa làm");
  }
}

export function topK<T>(ds: Iterable<T>, k: number, soSanh: SoSanh<T>): T[] {
  throw new Error("chưa làm");
}
