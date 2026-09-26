/**
 * Tách luồng SSE thành sự kiện JSON. THUẦN: nhận (đệm cũ, chunk mới) trả (sự kiện, đệm dư) — vòng
 * đọc chỉ việc mang `du` sang lần gọi kế. Vì chunk TCP không bao giờ trùng ranh giới khung, mọi
 * bộ đọc SSE tự viết đều phải có đệm; đây là chỗ dễ sai nhất nên tách ra đo riêng.
 *
 * Khung hỏng KHÔNG bị nuốt im lặng — trả về ở `hong` để lớp trên còn khai báo được.
 */
export interface KetQuaTach {
  suKien: Array<Record<string, unknown>>;
  du: string;
  hong: string[];
}

export function tachKhungSse(dem: string, chunk: string): KetQuaTach {
  const buf = dem + chunk;
  const phan = buf.split(/\r?\n\r?\n/);
  const du = phan.pop() ?? "";
  const suKien: Array<Record<string, unknown>> = [];
  const hong: string[] = [];

  for (const khung of phan) {
    const than = khung
      .split(/\r?\n/)
      .filter((d) => d.startsWith("data:"))
      .map((d) => d.slice(5).trimStart())
      .join("\n")
      .trim();
    if (than.length === 0) continue; // khung chú thích `: ping` hoặc khung rỗng
    try {
      const doiTuong = JSON.parse(than) as unknown;
      if (doiTuong && typeof doiTuong === "object") suKien.push(doiTuong as Record<string, unknown>);
      else hong.push(than);
    } catch {
      hong.push(than);
    }
  }
  return { suKien, du, hong };
}
