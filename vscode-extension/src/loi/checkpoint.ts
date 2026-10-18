/**
 * ★★★ ĐỢT 4B — CHECKPOINT theo LƯỢT CHẠY agent (THUẦN). Trước lượt ghi ĐẦU TIÊN vào một đường, bộ thực thi chụp nội
 * dung GỐC (hoặc `null` = đường chưa có tệp) vào bộ nhớ extension; sau mỗi lượt ghi thành công, ghi băm ĐO ĐƯỢC
 * (`bamSauThat` của `apBanVa`; `null` = tệp không còn ở đường này).
 *
 * Hoàn tác = đưa MỖI đường về trạng thái gốc, và CHỈ khi trạng thái hiện tại đúng là trạng thái AI để lại (băm hiện
 * tại == băm sau). Lệch ⇒ XUNG ĐỘT: ai đó (người, formatter, git) đã sửa tiếp — ghi đè là xoá việc của họ. Có xung
 * đột ở BẤT KỲ đường nào ⇒ cả lượt hoàn tác bị TỪ CHỐI (không hoàn tác nửa vời để lại mã lệch nhau giữa các tệp).
 * Đổi tên A→B được ghi thành hai đường độc lập (A: gốc X → không còn; B: chưa có → X) nên hoàn tác = tạo lại A + xoá B.
 */

export interface MucCheckpoint {
  duongTuyetDoi: string;
  duongTuongDoi: string;
  /** Nội dung gốc trước lượt chạy; `null` = đường này CHƯA có tệp. */
  goc: string | null;
  /** Băm đĩa sau lượt ghi gần nhất của AI; `null` = AI đã làm tệp biến mất khỏi đường này. */
  bamSau: string | null;
}

export class SoCheckpoint {
  private readonly muc = new Map<string, MucCheckpoint>();
  constructor(readonly runId: string) {}

  /** Gọi SAU mỗi lượt ghi THÀNH CÔNG. `gocNeuMoi` chỉ được dùng ở lần đầu đường này xuất hiện. */
  ghiNhan(duongTuyetDoi: string, duongTuongDoi: string, gocNeuMoi: string | null, bamSau: string | null): void {
    const cu = this.muc.get(duongTuyetDoi);
    this.muc.set(duongTuyetDoi, { duongTuyetDoi, duongTuongDoi, goc: cu ? cu.goc : gocNeuMoi, bamSau });
  }

  danhSach(): MucCheckpoint[] {
    return [...this.muc.values()];
  }

  get rong(): boolean {
    return this.muc.size === 0;
  }
}

export type BuocHoanTac =
  | { loai: "thay"; duongTuyetDoi: string; duongTuongDoi: string; noiDung: string; bamHienTai: string }
  | { loai: "tao"; duongTuyetDoi: string; duongTuongDoi: string; noiDung: string }
  | { loai: "xoa"; duongTuyetDoi: string; duongTuongDoi: string; bamHienTai: string };

export interface KeHoachHoanTac {
  buoc: BuocHoanTac[];
  xungDot: Array<{ duongTuongDoi: string; lyDo: string }>;
}

/**
 * Lập kế hoạch hoàn tác từ checkpoint + trạng thái ĐO ĐƯỢC hiện tại (`bamHienTai(duong)` = băm, `null` = không có
 * tệp). `bam(s)` = hàm băm dùng chung với điểm ghi.
 */
export function lapKeHoachHoanTac(
  ds: MucCheckpoint[],
  bamHienTai: Map<string, string | null>,
  bam: (s: string) => string,
): KeHoachHoanTac {
  const buoc: BuocHoanTac[] = [];
  const xungDot: KeHoachHoanTac["xungDot"] = [];
  for (const m of ds) {
    const hien = bamHienTai.has(m.duongTuyetDoi) ? bamHienTai.get(m.duongTuyetDoi)! : undefined;
    if (hien === undefined) {
      xungDot.push({ duongTuongDoi: m.duongTuongDoi, lyDo: "không đo được trạng thái hiện tại" });
      continue;
    }
    if (hien !== m.bamSau) {
      xungDot.push({
        duongTuongDoi: m.duongTuongDoi,
        lyDo:
          m.bamSau === null
            ? "AI đã xoá/chuyển tệp này nhưng hiện lại có tệp ở đây"
            : hien === null
              ? "tệp AI đã ghi nay không còn"
              : "tệp đã bị sửa tiếp SAU lượt ghi của AI (băm hiện tại ≠ băm AI để lại)",
      });
      continue;
    }
    if (m.goc === null) {
      if (hien !== null) buoc.push({ loai: "xoa", duongTuyetDoi: m.duongTuyetDoi, duongTuongDoi: m.duongTuongDoi, bamHienTai: hien });
    } else if (hien === null) {
      buoc.push({ loai: "tao", duongTuyetDoi: m.duongTuyetDoi, duongTuongDoi: m.duongTuongDoi, noiDung: m.goc });
    } else if (bam(m.goc) !== hien) {
      buoc.push({ loai: "thay", duongTuyetDoi: m.duongTuyetDoi, duongTuongDoi: m.duongTuongDoi, noiDung: m.goc, bamHienTai: hien });
    }
  }
  // Xoá trước, tạo sau: hoàn tác một lượt đổi tên A→B không bao giờ để hai bản cùng tồn tại lâu hơn cần thiết.
  const thuTu = { xoa: 0, thay: 1, tao: 2 } as const;
  buoc.sort((a, b) => thuTu[a.loai] - thuTu[b.loai]);
  return { buoc, xungDot };
}
