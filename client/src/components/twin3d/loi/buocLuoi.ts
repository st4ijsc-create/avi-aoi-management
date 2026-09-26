/**
 * buocLuoi.ts — BƯỚC LƯỚI SÀN TÍNH THEO **MÀN HÌNH**, KHÔNG THEO MÉT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PH-54 — VÌ SAO PHẢI CÓ TỆP NÀY: LƯỚI SÀN LÀ MỘT TẤM DITHER, ĐÃ ĐO
 * ════════════════════════════════════════════════════════════════════════════
 * Lưới tồn tại để cho **cảm giác tỉ lệ**. Ở cỡ mà một ô nhỏ hơn vài pixel thì nó
 * không cho cảm giác gì — chỉ thêm nhiễu và tốn đỉnh. Đo sống trên `ca088198`
 * (khung 1280×720, ANGLE/GPU thật, ô tại ĐIỂM NGẮM):
 *
 *   | màn                          | ô lưới     |
 *   |------------------------------|------------|
 *   | `/factory-command` tập đoàn  | **1,07 px** (đường section 10 m: 5,33 px) |
 *   | `/twin` tập đoàn             | **1,47 px** |
 *   | Studio                       | 2,59 px (trần zoom **0,83 px**) |
 *   | `/factory-command` một nhà máy | 2,94 px |
 *   | `/twin` một nhà máy          | 27,75 px ✓ — màn DUY NHẤT đạt |
 *
 * Ba màn, ba kiểu sai khác nhau, nhưng **cùng một gốc**: bước lưới được chọn bằng
 * MÉT (hằng 2 m ở drei `<Grid>`; ~5 m và ~1 m ở `gridHelper`) trong khi thứ quyết
 * định "có đọc được không" là **pixel**. Một hằng số mét không thể đúng ở mọi cỡ
 * cảnh và mọi nấc zoom, vì px/mét đi theo `1/khoảng cách`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO **BẮT BUỘC** PHẢI THÍCH ỨNG THEO ZOOM — MỘT PHÉP CHIA
 * ════════════════════════════════════════════════════════════════════════════
 * Một bước HẰNG (chỉ đổi số, vẫn là hằng) phải thoả ĐỒNG THỜI:
 *   · ô ≥ N px ở chỗ camera lùi xa nhất  ⇒  S ≥ N·K·d_max / H
 *   · ô không nuốt cả cảnh ở zoom gần nhất (còn ≥ 2 ô bắc ngang khung)
 *                                        ⇒  S ≤ K·d_min / 2
 * Hai điều kiện ấy cùng đúng khi và chỉ khi  **d_max / d_min ≤ H / (2N)**.
 * ĐO SỐNG dải zoom thật của từng màn (`.qa-tapdoan/ph54/tho/do-nen.json`, N = 8):
 *
 *   | màn                    | d_max   | d_min  | tỉ số | chịu được | kết luận |
 *   |------------------------|---------|--------|-------|-----------|----------|
 *   | `/factory-command` TĐ  | 2.050,0 |   4,00 | 512,5 |   ≤ 33,1  | **BẤT KHẢ, vượt 16×** |
 *   | `/factory-command` NM  |   743,2 |   4,00 | 185,8 |   ≤ 33,1  | **BẤT KHẢ, vượt 6×**  |
 *   | `/twin` tập đoàn       | 8.975,0 | 563,77 |  15,9 |   ≤ 30,6  | khả thi (khe 121,6–233,5 m) |
 *   | `/twin` một nhà máy    |   918,6 |  42,40 |  21,7 |   ≤ 30,6  | khả thi (khe 12,4–17,6 m)   |
 *   | Studio                 |   365,2 |  42,69 |   8,6 |   ≤ 15,7  | khả thi (khe 9,6–17,7 m)    |
 *
 * ⇒ Hai màn `/factory-command` KHÔNG có hằng số nào đạt được cả hai điều kiện —
 *   `minDistance = 4` m (CanhNhaMay.tsx) mở dải zoom rộng gấp 6–16 lần thứ một
 *   hằng số chịu nổi. Ba màn còn lại CÓ khe khả thi, nhưng là ba khe HẸP và KHÁC
 *   NHAU, tức phải chỉnh tay ba con số và chỉnh lại mỗi lần cỡ cảnh đổi.
 *   Một quy tắc theo màn hình thay được cả năm mà không có con số viết tay nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CÁCH LÀM: THANG BẢN ĐỒ 1/2/5/10 + **CHỈ LÀM THƯA, KHÔNG LÀM DÀY**
 * ════════════════════════════════════════════════════════════════════════════
 * · Bước được chọn từ thang 1/2/5/10/20/50… — như thước tỉ lệ trên bản đồ, nên
 *   con số luôn là một số tròn người đọc được ("mỗi ô 20 m"), không phải 17,3 m.
 * · `max(buocGoc, …)` — **chỉ làm thưa**. Ở zoom gần, biểu thức màn-hình đòi một
 *   bước NHỎ HƠN bước hôm nay; nếu nghe theo thì lưới sẽ DÀY LÊN so với bản đang
 *   chạy, tức bản vá tự sinh một thay đổi diện mạo mà không ai yêu cầu (và `/twin`
 *   một nhà máy — màn DUY NHẤT đang đạt — sẽ bị đổi). Nên sàn là bước gốc.
 * · Hệ quả đo được: ô luôn nằm trong **[N, 2,5·N) px** khi màn hình quyết định
 *   (bội nhảy lớn nhất của thang 1/2/5/10 là 2,5×), và **giữ nguyên hôm nay** ở
 *   mọi nấc zoom mà bước gốc đã đủ.
 *
 * ★ TRỄ MỘT CHIỀU (`buocKeTiep`) — xem docblock của hàm ấy.
 */

/** Ngưỡng: một ô lưới không bao giờ nhỏ hơn ngần này pixel trên màn. */
export const O_TOI_THIEU_PX = 8;

/**
 * Thang bản đồ 1/2/5/10. Bội nhảy giữa hai nấc liền kề ≤ 2,5 — đó là thứ chặn
 * TRÊN của dải px mà bản vá để lại.
 */
export const THANG_BUOC = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500,
  1000, 2000, 5000, 10000, 20000, 50000,
] as const;

/** Nấc nhỏ nhất của thang mà ≥ `x`. */
export function thangTran(x: number): number {
  for (const v of THANG_BUOC) if (v >= x - 1e-9) return v;
  return THANG_BUOC[THANG_BUOC.length - 1];
}

/**
 * Số pixel trên mỗi mét của một mặt phẳng cách camera `d`, với fov DỌC `fovDoc`
 * (độ) và khung cao `caoPx`:   px/mét = caoPx / (2·d·tan(fov/2))
 */
export function pxTrenMet(caoPx: number, d: number, fovDoc: number): number {
  const k = 2 * Math.tan(((fovDoc / 2) * Math.PI) / 180);
  return caoPx / (k * Math.max(d, 1e-6));
}

/**
 * Bước lưới (m) để một ô rộng ít nhất `oToiThieuPx` pixel ở khoảng cách `d`,
 * nhưng KHÔNG BAO GIỜ nhỏ hơn `buocGoc` (chỉ làm thưa).
 */
export function buocLuoiTheoManHinh({
  d,
  caoPx,
  fovDoc,
  buocGoc,
  oToiThieuPx = O_TOI_THIEU_PX,
}: {
  d: number;
  caoPx: number;
  fovDoc: number;
  buocGoc: number;
  oToiThieuPx?: number;
}): number {
  if (!Number.isFinite(d) || !Number.isFinite(caoPx) || caoPx <= 0) return buocGoc;
  const canM = oToiThieuPx / pxTrenMet(caoPx, d, fovDoc);
  return Math.max(buocGoc, thangTran(canM));
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TRỄ MỘT CHIỀU — LÀM THƯA NGAY, LÀM DÀY CHẬM
 * ════════════════════════════════════════════════════════════════════════════
 * Bước đổi theo `d`, mà `d` là thứ người dùng đổi liên tục bằng con lăn. Nếu
 * dùng thẳng `buocLuoiTheoManHinh` thì ở ĐÚNG ranh giới một nấc, một rung động
 * nhỏ của `d` sẽ lật bước qua lại mỗi khung hình — **nhấp nháy**, đúng hazard
 * phải hỏi trước chứ không chờ ảnh tố cáo.
 *
 * Trễ ở đây **một chiều, và lệch về phía an toàn**:
 *  · cần THƯA hơn ⇒ đổi NGAY. Vì chậm một khung hình ở chiều này nghĩa là một
 *    khung hình có ô < N px — tức phá đúng cái bất biến bản vá dựng lên.
 *  · cần DÀY hơn ⇒ chỉ đổi khi đã vào hẳn bên trong (đệm `DEM_LAM_DAY`), nên
 *    muốn lật ngược lại phải cuộn thêm một quãng thật, không phải một rung động.
 * Hệ quả: `≥ N px` là bất biến ở MỌI khung hình, kể cả khung đang chuyển nấc.
 */
export const DEM_LAM_DAY = 1.15;

export function buocKeTiep(
  buocHienTai: number | null,
  tham: Parameters<typeof buocLuoiTheoManHinh>[0],
): number {
  const moi = buocLuoiTheoManHinh(tham);
  if (buocHienTai == null) return moi;
  if (moi > buocHienTai) return moi; // làm thưa: NGAY
  const moiCoDem = buocLuoiTheoManHinh({ ...tham, d: tham.d * DEM_LAM_DAY });
  return moiCoDem < buocHienTai ? moiCoDem : buocHienTai;
}

/**
 * Khoảng cách từ camera tới **điểm nó đang ngắm trên mặt sàn** (`y = yMatSan`).
 *
 * Vì sao không dùng `|camera.position|`: đó là khoảng cách tới GỐC toạ độ, mà gốc
 * chỉ tình cờ trùng điểm ngắm khi `OrbitControls.target` còn ở mặc định (0,0,0).
 * Sau một cú "bay tới máy" (`BayToi`, `CauNoiCanh`) target rời gốc và hai số ấy
 * LỆCH — lưới sẽ được chọn theo một điểm người dùng không hề nhìn.
 * Bắn tia theo hướng nhìn xuống mặt sàn thì đúng định nghĩa "ô tại điểm ngắm"
 * trong mọi trường hợp, và KHÔNG cần với tới `controls`.
 *
 * ⚠ Khi camera nhìn ngang đường chân trời, `huongY → 0` và giao điểm chạy ra vô
 *   cực. Nên kẹp trong `[0,25·r, 4·r]` với `r = |camera - gốc|`: giữ được ý nghĩa
 *   hình học ở mọi góc mà không bao giờ cho một `d` vô nghĩa.
 */
export function khoangCachToiDiemNgam(
  viTri: { x: number; y: number; z: number },
  huong: { x: number; y: number; z: number },
  yMatSan = 0,
): number {
  const r = Math.hypot(viTri.x, viTri.y, viTri.z);
  const can = viTri.y - yMatSan;
  if (huong.y < -1e-4 && can > 0) {
    const t = can / -huong.y;
    if (Number.isFinite(t) && t > 0) return Math.min(Math.max(t, r * 0.25), r * 4);
  }
  return r;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỢNG TỬ HOÁ VỀ SỐ Ô NGUYÊN — thứ giữ cho bất biến "ô ≥ N px" còn đúng
 * ════════════════════════════════════════════════════════════════════════════
 * `gridHelper` không nhận một BƯỚC, nó nhận một SỐ Ô nguyên. Nên bước thật sự
 * được vẽ là `canh / soO`, chứ không phải bước mà {@link buocLuoiTheoManHinh}
 * vừa chọn. Nếu làm tròn số ô theo kiểu gần nhất thì bước thật có thể **nhỏ hơn**
 * bước đã chọn, và ô trên màn tụt xuống **dưới** {@link O_TOI_THIEU_PX} — tức
 * bất biến bị phá ở đúng chỗ không ai nhìn.
 *
 * ⇒ Làm tròn số ô **XUỐNG** (`floor`): ít ô hơn ⇒ bước LỚN hơn ⇒ ô trên màn
 *   **≥** thứ đã chọn. Sai số của lượng tử hoá luôn rơi về **phía an toàn**.
 *
 * ★ Ca `b === buocGoc` trả thẳng `buocGoc`: đó là đường "không làm thưa". Không
 *   có nhánh ấy thì chính phép lượng tử hoá sẽ **đổi lưới hôm nay** ở những màn
 *   vốn đã đủ to (`/twin` một nhà máy, 27,75 px) — một bản vá không được đụng
 *   vào thứ nó không sửa.
 *
 * ★★★ VÌ SAO NẰM Ở ĐÂY: biểu thức này từng được **chép nguyên văn ở HAI tệp
 *   cảnh** (`CanhVanHanh.tsx` và `CanhThietKe.tsx` — đã đối chiếu, giống hệt
 *   từng ký tự). Hai bản sao của một bất biến là hai cơ hội để chúng lệch nhau
 *   mà không cổng nào kêu. Gom về một chỗ, và ghim bằng lưới ở
 *   `buocLuoi.unit.test.ts`.
 *
 * @param canh   cạnh tấm lưới (m) — `gridHelper` chia đều cạnh này
 * @param buocGoc bước của lưới HÔM NAY, trước khi làm thưa
 * @param b      bước mà thang màn hình vừa chọn
 * @returns bước THẬT SỰ vẽ được, luôn `>= b` (trừ ca không-làm-thưa)
 */
export const O_TOI_THIEU_CUA_LUOI = 4;

export function buocThucTheoSoO(canh: number, buocGoc: number, b: number): number {
  if (b === buocGoc) return buocGoc;
  return canh / Math.max(O_TOI_THIEU_CUA_LUOI, Math.floor(canh / b));
}
