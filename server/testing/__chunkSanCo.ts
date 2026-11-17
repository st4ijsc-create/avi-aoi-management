/**
 * Chọn thời điểm cho hàng thử NẰM TRONG một CHUNK TimescaleDB ĐÃ CÓ của hypertable — để tệp test giữ MỘT giao dịch dài (fixture rollback) KHÔNG tạo chunk mới.
 *
 * Vì sao (đo 17/11, chup-khoa chỉ đọc ở nhóm phancon): `product_inspections` là hypertable chunk 1 THÁNG (drizzle/0172_inspection_hypertables.sql:83-84) có khoá ngoại fk_product_inspections_machine → machines
 * (drizzle/0180_integrity_enforce_fk_unique.sql:124). INSERT vào một khoảng thời gian CHƯA có chunk ⇒ Timescale tạo chunk + gắn khoá ngoại ⇒ `ShareRowExclusiveLock` trên `machines` GIỮ TỚI HẾT GIAO DỊCH.
 * Giao dịch của `statisticsScope.test.ts` sống ~29 s ⇒ mọi `INSERT machines` của worker khác (RowExclusiveLock) chờ tới trần `DB_STATEMENT_TIMEOUT_MS` 30 s (`server/db/connection.ts:43`) ⇒ `apiKeyTenantScope` hết giờ.
 * Chunk tạo trong giao dịch bị ROLLBACK thì cũng bị huỷ ⇒ mỗi lần chạy lại tạo lại. Chọn thời điểm trong chunk ĐÃ COMMIT sẵn ⇒ không tạo gì, không giữ khoá.
 *
 * THUẦN: không import driver; nhận một hàm chạy truy vấn CHỈ ĐỌC (`ChayTruyVan`). Mọi lỗi / không có chunk phù hợp ⇒ trả `macDinh` (hành vi cũ) kèm lý do — không ném.
 * Tên `__*.ts` = bộ dựng lưới (quy ước của `permissionsDonCacheCensus` (3)).
 */
export type ChayTruyVan = (cauLenh: string, thamSo: unknown[]) => Promise<Array<Record<string, unknown>>>;

export interface TuyChonChonChunk {
  /** hypertable (chỉ `[a-z_]`), ví dụ `product_inspections` */
  bang: string;
  /** cột thời gian (chỉ `[A-Za-z_]`), ví dụ `inspectionTime` */
  cot: string;
  /** hạt giống sinh vị trí trong chunk (mốc `Date.now()` của tệp ⇒ hai lần chạy không dùng chung lát) */
  ts: number;
  /** thời điểm cũ — dùng khi KHÔNG chọn được chunk có sẵn */
  macDinh: Date;
  /** "bây giờ" (tiêm được cho test) */
  bayGio?: Date;
  /** chỉ lấy chunk kết thúc trước `bayGio − daySauToiThieu` ngày (mặc định 1) */
  daySauToiThieu?: number;
  /** chỉ lấy chunk bắt đầu SAU `bayGio − dayLuiToiDa` ngày (mặc định 3500) — các bảng dò của tệp chỉ nhìn lùi 4000 ngày */
  dayLuiToiDa?: number;
  /** nửa bề rộng cần TRỐNG quanh thời điểm chọn (mặc định 30 s) */
  nuaDoTrongMs?: number;
}

export interface KetQuaChonChunk {
  at: Date;
  /** `chunk-san-co` hoặc `mac-dinh:<lý do>` */
  nguon: string;
  chunk?: { batDau: Date; ketThuc: Date };
}

const TEN_BANG = /^[a-z_]+$/;
const TEN_COT = /^[A-Za-z_]+$/;

const laNgay = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
};

/** Vị trí giả ngẫu nhiên TẤT ĐỊNH trong (đầu + lề, cuối − lề) từ `ts` và lần thử `k`. */
export function viTriTrongChunk(batDau: Date, ketThuc: Date, ts: number, k: number, leMs: number): Date {
  const rong = ketThuc.getTime() - batDau.getTime() - 2 * leMs;
  // băm 32 bit (Math.imul, không tràn số nguyên an toàn) → phân số [0,1) → vị trí trong chunk
  const h = (Math.imul((ts % 2_147_483_647) | 0, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  const dich = rong > 0 ? Math.floor((h / 4_294_967_296) * rong) : 0;
  return new Date(batDau.getTime() + leMs + dich);
}

export async function chonThoiDiemTrongChunkSanCo(chay: ChayTruyVan, tuyChon: TuyChonChonChunk): Promise<KetQuaChonChunk> {
  const { bang, cot, ts, macDinh } = tuyChon;
  const macDinhVi = (lyDo: string): KetQuaChonChunk => ({ at: macDinh, nguon: `mac-dinh:${lyDo}` });
  if (!TEN_BANG.test(bang) || !TEN_COT.test(cot)) return macDinhVi("ten-bang-cot-khong-hop-le");
  const bayGio = tuyChon.bayGio ?? new Date();
  const ngay = 86_400_000;
  const muon = new Date(bayGio.getTime() - (tuyChon.daySauToiThieu ?? 1) * ngay);
  const som = new Date(bayGio.getTime() - (tuyChon.dayLuiToiDa ?? 3500) * ngay);
  const nua = tuyChon.nuaDoTrongMs ?? 30_000;
  try {
    // Chỉ ĐỌC. Chunk đã nén bị bỏ (chèn vào chunk nén chậm / bị cấm tuỳ bản).
    const chunks = await chay(
      "select range_start, range_end from timescaledb_information.chunks where hypertable_name = $1 and not is_compressed and range_end <= $2 and range_start >= $3 order by range_start desc limit 12",
      [bang, muon.toISOString(), som.toISOString()],
    );
    for (const c of chunks) {
      const batDau = laNgay(c.range_start);
      const ketThuc = laNgay(c.range_end);
      if (!batDau || !ketThuc || ketThuc.getTime() - batDau.getTime() < 4 * nua) continue;
      for (let k = 0; k < 5; k++) {
        const at = viTriTrongChunk(batDau, ketThuc, ts, k, 2 * nua);
        const dem = await chay(`select count(*)::int as n from ${bang} where "${cot}" >= $1 and "${cot}" < $2`, [new Date(at.getTime() - nua).toISOString(), new Date(at.getTime() + nua).toISOString()]);
        if (Number(dem[0]?.n ?? 1) === 0) return { at, nguon: "chunk-san-co", chunk: { batDau, ketThuc } };
      }
    }
    return macDinhVi("khong-co-chunk-phu-hop");
  } catch (e) {
    return macDinhVi(`loi-doc:${e instanceof Error ? e.message.slice(0, 80) : "khong-ro"}`);
  }
}

/** Có chunk (chưa nén) chứa thời điểm `t` không — để nhật ký nói thẳng khi hàng "hôm nay" sẽ phải tạo chunk. Lỗi ⇒ `null` (không rõ). */
export async function coChunkChuaThoiDiem(chay: ChayTruyVan, bang: string, t: Date): Promise<boolean | null> {
  if (!TEN_BANG.test(bang)) return null;
  try {
    const r = await chay("select 1 as co from timescaledb_information.chunks where hypertable_name = $1 and not is_compressed and range_start <= $2 and range_end > $2 limit 1", [bang, t.toISOString()]);
    return r.length > 0;
  } catch {
    return null;
  }
}
