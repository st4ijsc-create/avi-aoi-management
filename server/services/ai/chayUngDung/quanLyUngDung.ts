/**
 * ★★★ Đợt 3c (2026-10-17) — **TRÌNH QUẢN LÝ TIẾN TRÌNH ỨNG DỤNG** (bước 7 của hành trình "mô tả → dự án chạy được").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN — mỗi cái một lưới ở `quanLyUngDung.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **MỘT tiến trình mỗi dự án.** Chỗ được giữ ĐỒNG BỘ trước mọi `await` (cấp cổng là async) ⇒ hai lượt bấm
 *      đồng thời không sinh hai tiến trình.
 *   2. **Cổng TRONG DẢI** (`capCong.ts`), không trùng dự án khác, bỏ qua cổng tiến trình lạ đang giữ. Cổng của
 *      một tiến trình CHƯA quan sát được cái chết KHÔNG được cấp lại (VRAM Pha 3: "ra lệnh giết ≠ đã chết").
 *   3. **Dừng = giết CÂY** (`npm run dev` → cmd → node → vite: cháu/chắt) qua `gietCayTienTrinh` của hộp cát lệnh,
 *      rồi CHỜ `exit` thật trong ân hạn; hết ân hạn ⇒ trả về và KHAI `chuaXacNhanChet`.
 *   4. **Tự dừng khi nhàn rỗi** 30 phút. "Hoạt động" = lượt xem trước đi qua proxy (`cham`) + lượt chạy; ĐỌC trạng
 *      thái/nhật ký KHÔNG tính (một tab quên mở poll mãi không được giữ một tiến trình sống vĩnh viễn).
 *   5. **Dừng hết** khi máy chủ tắt (`dungHet`, nối ở `gracefulShutdown`).
 *   6. **Nhật ký vòng** có trần (dòng + byte), qua `StreamingSecretRedactor` TRƯỚC khi vào bộ đệm (che theo dòng
 *      chảy, không che-lúc-đọc — cùng lý lẽ `lenhSong.ts`).
 *   7. **Audit** mỗi lần chạy/dừng — kể cả dừng do nhàn rỗi/tắt máy (không người bấm ⇒ `userId: null`).
 *
 * ⚠ Trình quản lý KHÔNG tự `spawn`: nó gọi `deps.sinh` — trong sản phẩm là `cuaSinhUngDung.sinhUngDungThat`, CỬA
 *   DUY NHẤT (môi trường lọc, không shell, cwd = gốc). Tiêm được ⇒ lưới đo logic bằng tiến trình giả, đồng hồ giả.
 * ⚠ KHÔNG kiểm quyền ở đây: tuyến gọi (tRPC `aiChayUngDung`) kiểm `ai_repo_exec/canCreate` TRƯỚC — cùng khuôn
 *   "chính sách tách khỏi cưỡng chế" của `repoCommand.ts`.
 */
import { StreamingSecretRedactor } from "../aiSafety";
import type { KetQuaGiet } from "../../aiLocalTools/repoCommandSandbox";
import type { DaiCong } from "./capCong";

export interface LenhUngDung {
  /** Tệp chạy THẬT (tuyệt đối hoặc tên tra PATH). */
  file: string;
  args: string[];
  /** Biến đặt thêm (hằng của mã — vd ASPNETCORE_URLS); PORT/HOST do cửa sinh đặt theo cổng cấp. */
  envThem: Record<string, string>;
  /** Dạng người đọc ("npm run dev", "python app.py", "dotnet run --project …"). */
  moTa: string;
}

/** Tối thiểu của một `ChildProcess` mà trình quản lý cần. */
export interface TienTrinhUngDung {
  pid?: number;
  stdout?: { on(ev: "data", cb: (c: Buffer | string) => void): unknown } | null;
  stderr?: { on(ev: "data", cb: (c: Buffer | string) => void): unknown } | null;
  on(ev: "exit", cb: (code: number | null, sig: string | null) => void): unknown;
  on(ev: "error", cb: (e: Error) => void): unknown;
}

export interface SuKienAuditUngDung {
  loai: "chay" | "dung";
  projectId: string;
  userId: number | null;
  cong: number | null;
  lenh: string;
  lyDo?: LyDoDung;
  chuaXacNhanChet?: boolean;
}

export interface PhuThuocQuanLy {
  sinh: (lenh: LenhUngDung, goc: string, cong: number) => TienTrinhUngDung;
  giet: (pid: number | undefined) => KetQuaGiet;
  bayGio: () => number;
  /** Cổng `listen` được không (tiến trình lạ chiếm ⇒ false). */
  congTrong: (cong: number) => Promise<boolean>;
  /** Có ai đang NGHE cổng không (sẵn sàng). */
  thuKetNoi: (cong: number) => Promise<boolean>;
  ghiAudit: (e: SuKienAuditUngDung) => void;
  /** Ân hạn chờ `exit` sau lệnh giết (mặc định 5 s). */
  anHanGietMs?: number;
}

export type TrangThaiUngDung = "dang-khoi-dong" | "dang-chay" | "dang-dung" | "da-dung" | "loi";
export type LyDoDung = "nguoi-dung" | "nhan-roi" | "tat-may";

export const NHAN_ROI_MS = 30 * 60_000;
export const TRAN_DONG_NHAT_KY = 1000;
export const TRAN_BYTE_NHAT_KY = 200_000;
/** Quá mốc này mà cổng vẫn chưa nghe ⇒ cảnh báo "script không đọc biến PORT?" trên bảng. */
export const MOC_CANH_BAO_CHUA_NGHE_MS = 120_000;

interface MucNoiBo {
  projectId: string;
  goc: string;
  chuSoHuu: number;
  cong: number;
  /** `true` ⇔ cổng còn bị giữ (tiến trình chưa được quan sát là đã chết). */
  giuCong: boolean;
  pid: number | null;
  trangThai: TrangThaiUngDung;
  lenh: string;
  batDauLuc: number;
  hoatDongCuoi: number;
  maThoat: number | null;
  lyDoDung: LyDoDung | null;
  chuaXacNhanChet: boolean;
  dong: string[];
  byteNhatKy: number;
  catDau: boolean;
  doDang: string;
  redactor: StreamingSecretRedactor;
  choChet: Array<() => void>;
}

export interface MucCongKhai {
  projectId: string;
  chuSoHuu: number;
  cong: number | null;
  trangThai: TrangThaiUngDung;
  lenh: string;
  batDauLuc: number;
  hoatDongCuoi: number;
  maThoat: number | null;
  lyDoDung: LyDoDung | null;
  chuaXacNhanChet: boolean;
  /** `true` ⇔ đã quá `MOC_CANH_BAO_CHUA_NGHE_MS` mà cổng chưa nghe. */
  chuaNgheCong: boolean;
}

export type KetQuaChayUngDung =
  | { ok: true; muc: MucCongKhai }
  | { ok: false; ma: "DANG_CHAY" | "HET_CONG" | "LOI_SINH"; chiTiet: string; muc?: MucCongKhai };

export type KetQuaDungUngDung =
  | { ok: true; chuaXacNhanChet: boolean }
  | { ok: false; ma: "KHONG_CHAY" };

const SONG: ReadonlySet<TrangThaiUngDung> = new Set(["dang-khoi-dong", "dang-chay", "dang-dung"]);

export class QuanLyUngDung {
  private readonly ds = new Map<string, MucNoiBo>();
  /** Chỗ giữ đồng bộ của lượt chạy đang cấp cổng (bất biến 1). */
  private readonly dangGiu = new Set<string>();
  private readonly anHan: number;

  constructor(
    private readonly dai: DaiCong,
    private readonly deps: PhuThuocQuanLy,
  ) {
    this.anHan = deps.anHanGietMs ?? 5_000;
  }

  get daiCong(): DaiCong {
    return { ...this.dai };
  }

  private congKhai(m: MucNoiBo): MucCongKhai {
    return {
      projectId: m.projectId,
      chuSoHuu: m.chuSoHuu,
      cong: m.giuCong ? m.cong : null,
      trangThai: m.trangThai,
      lenh: m.lenh,
      batDauLuc: m.batDauLuc,
      hoatDongCuoi: m.hoatDongCuoi,
      maThoat: m.maThoat,
      lyDoDung: m.lyDoDung,
      chuaXacNhanChet: m.chuaXacNhanChet,
      chuaNgheCong: m.trangThai === "dang-khoi-dong" && this.deps.bayGio() - m.batDauLuc > MOC_CANH_BAO_CHUA_NGHE_MS,
    };
  }

  private async capCong(): Promise<number | null> {
    const daGiu = new Set<number>();
    for (const m of this.ds.values()) if (m.giuCong) daGiu.add(m.cong);
    for (let c = this.dai.tu; c <= this.dai.den; c++) {
      if (daGiu.has(c)) continue;
      if (await this.deps.congTrong(c)) return c;
    }
    return null;
  }

  async chay(input: { projectId: string; goc: string; userId: number; lenh: LenhUngDung }): Promise<KetQuaChayUngDung> {
    const { projectId } = input;
    const cu = this.ds.get(projectId);
    if (this.dangGiu.has(projectId) || (cu && SONG.has(cu.trangThai))) {
      return { ok: false, ma: "DANG_CHAY", chiTiet: projectId, ...(cu ? { muc: this.congKhai(cu) } : {}) };
    }
    this.dangGiu.add(projectId);
    try {
      const cong = await this.capCong();
      if (cong === null) return { ok: false, ma: "HET_CONG", chiTiet: `${this.dai.tu}-${this.dai.den}` };
      const bayGio = this.deps.bayGio();
      const m: MucNoiBo = {
        projectId,
        goc: input.goc,
        chuSoHuu: input.userId,
        cong,
        giuCong: true,
        pid: null,
        trangThai: "dang-khoi-dong",
        lenh: input.lenh.moTa,
        batDauLuc: bayGio,
        hoatDongCuoi: bayGio,
        maThoat: null,
        lyDoDung: null,
        chuaXacNhanChet: false,
        dong: [],
        byteNhatKy: 0,
        catDau: false,
        doDang: "",
        redactor: new StreamingSecretRedactor(),
        choChet: [],
      };
      let con: TienTrinhUngDung;
      try {
        con = this.deps.sinh(input.lenh, input.goc, cong);
      } catch (e) {
        return { ok: false, ma: "LOI_SINH", chiTiet: e instanceof Error ? e.message : String(e) };
      }
      m.pid = typeof con.pid === "number" ? con.pid : null;
      this.ds.set(projectId, m);
      const nhan = (c: Buffer | string) => this.noiNhatKy(m, typeof c === "string" ? c : c.toString("utf8"));
      con.stdout?.on("data", nhan);
      con.stderr?.on("data", nhan);
      con.on("error", (e) => {
        this.noiNhatKy(m, `\n[lỗi tiến trình] ${e.message}\n`);
        this.khiChet(m, null, null);
      });
      con.on("exit", (code, sig) => this.khiChet(m, typeof code === "number" ? code : null, sig ?? null));
      this.deps.ghiAudit({ loai: "chay", projectId, userId: input.userId, cong, lenh: input.lenh.moTa });
      return { ok: true, muc: this.congKhai(m) };
    } finally {
      this.dangGiu.delete(projectId);
    }
  }

  private khiChet(m: MucNoiBo, code: number | null, _sig: string | null): void {
    if (!m.giuCong && !SONG.has(m.trangThai)) return;
    const du = m.redactor.flush();
    if (du) this.themDong(m, du, true);
    if (m.doDang) {
      this.themDong(m, m.doDang + "\n", true);
      m.doDang = "";
    }
    m.giuCong = false;
    m.maThoat = code;
    m.chuaXacNhanChet = false;
    // Dừng có chủ ý (người/nhàn rỗi/tắt máy) ⇒ "da-dung" bất kể mã; TỰ thoát ⇒ mã 0 "da-dung", khác 0 "loi".
    m.trangThai = m.lyDoDung !== null || code === 0 ? "da-dung" : "loi";
    const cho = m.choChet.splice(0);
    for (const f of cho) f();
  }

  private noiNhatKy(m: MucNoiBo, doan: string): void {
    const nha = m.redactor.push(doan);
    if (nha) this.themDong(m, nha, false);
  }

  private themDong(m: MucNoiBo, s: string, cuoi: boolean): void {
    const tong = m.doDang + s;
    const phan = tong.split(/\r?\n/);
    m.doDang = cuoi ? "" : (phan.pop() ?? "");
    if (cuoi && phan[phan.length - 1] === "") phan.pop();
    for (const d of phan) {
      m.dong.push(d);
      m.byteNhatKy += d.length + 1;
    }
    while (m.dong.length > TRAN_DONG_NHAT_KY || m.byteNhatKy > TRAN_BYTE_NHAT_KY) {
      const bo = m.dong.shift();
      if (bo === undefined) break;
      m.byteNhatKy -= bo.length + 1;
      m.catDau = true;
    }
  }

  async dung(projectId: string, lyDo: LyDoDung, userId: number | null): Promise<KetQuaDungUngDung> {
    const m = this.ds.get(projectId);
    if (!m || !SONG.has(m.trangThai)) return { ok: false, ma: "KHONG_CHAY" };
    m.trangThai = "dang-dung";
    m.lyDoDung = lyDo;
    const daChet = new Promise<boolean>((giai) => {
      if (!m.giuCong) return giai(true);
      const hen = setTimeout(() => giai(false), this.anHan);
      (hen as { unref?: () => void }).unref?.();
      m.choChet.push(() => {
        clearTimeout(hen);
        giai(true);
      });
    });
    this.deps.giet(m.pid ?? undefined);
    const thay = await daChet;
    if (!thay) {
      // ⚠ KHÔNG khai là đã chết; cổng VẪN bị giữ (không cấp cho ai) cho tới khi `exit` thật tới.
      m.chuaXacNhanChet = true;
      m.trangThai = "da-dung";
    }
    this.deps.ghiAudit({ loai: "dung", projectId, userId, cong: m.cong, lenh: m.lenh, lyDo, chuaXacNhanChet: !thay });
    return { ok: true, chuaXacNhanChet: !thay };
  }

  trangThai(projectId: string): MucCongKhai | null {
    const m = this.ds.get(projectId);
    return m ? this.congKhai(m) : null;
  }

  danhSach(): MucCongKhai[] {
    return [...this.ds.values()].map((m) => this.congKhai(m));
  }

  nhatKy(projectId: string): { dong: string[]; catDau: boolean } | null {
    const m = this.ds.get(projectId);
    if (!m) return null;
    return { dong: m.doDang ? [...m.dong, m.doDang] : [...m.dong], catDau: m.catDau };
  }

  /** Cổng ĐANG GIỮ của dự án (proxy chỉ chuyển tới đây). `null` ⇔ không có tiến trình sống. */
  congCuaDuAn(projectId: string): number | null {
    const m = this.ds.get(projectId);
    return m && m.giuCong && (m.trangThai === "dang-khoi-dong" || m.trangThai === "dang-chay") ? m.cong : null;
  }

  /** Một lượt xem trước đi qua proxy ⇒ đẩy lùi mốc nhàn rỗi. */
  cham(projectId: string): void {
    const m = this.ds.get(projectId);
    if (m && SONG.has(m.trangThai)) m.hoatDongCuoi = this.deps.bayGio();
  }

  async lamMoiSanSang(projectId: string): Promise<void> {
    const m = this.ds.get(projectId);
    if (!m || m.trangThai !== "dang-khoi-dong" || !m.giuCong) return;
    if (await this.deps.thuKetNoi(m.cong)) {
      if (m.trangThai === "dang-khoi-dong") m.trangThai = "dang-chay";
    }
  }

  async kiemNhanRoi(): Promise<string[]> {
    const bayGio = this.deps.bayGio();
    const dung: string[] = [];
    for (const m of [...this.ds.values()]) {
      if ((m.trangThai === "dang-khoi-dong" || m.trangThai === "dang-chay") && bayGio - m.hoatDongCuoi >= NHAN_ROI_MS) {
        dung.push(m.projectId);
        await this.dung(m.projectId, "nhan-roi", null);
      }
    }
    return dung;
  }

  async dungHet(): Promise<void> {
    await Promise.all(
      [...this.ds.values()].filter((m) => SONG.has(m.trangThai) && m.trangThai !== "dang-dung").map((m) => this.dung(m.projectId, "tat-may", null)),
    );
  }
}
