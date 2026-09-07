/**
 * boChonNap.ts — BỘ CHỌN "NẠP CÁI GÌ" (Đợt 10 lô F, mục F1/F2/F3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — LÔ E ĐO ĐƯỢC, KHÔNG PHẢI SUY ĐOÁN
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinVanHanh.tsx` trước bản này nạp `factories[0]` → `toaNha[0]` → `tangs[0]`
 * — **ba chỉ số `[0]` viết cứng**. Hậu quả đo được ở lô E (§11e.6):
 *
 *   • Không đường nào trong UI hiện hơn MỘT tầng, của MỘT toà, của MỘT nhà máy.
 *     Màn `/twin` là màn DUY NHẤT trong hệ **0 `<select>`, 0 `[role=combobox]`**
 *     (đối chứng `FactoryFloorEditor.tsx` có 9).
 *   • Banner "**373 máy chưa xếp chỗ**" ở nhà máy 549 máy: máy tầng 2/3 **có**
 *     hàng `twin_dat_cho` thật, nhưng truy vấn chỉ hỏi `tangIds=[tang[0]]` nên
 *     client không thấy chúng và **khai sai** rằng chúng chưa được xếp chỗ.
 *     Ablation lô E: dồn 549 máy vào 1 tầng ⇒ banner biến mất; trải 176/187/186
 *     ⇒ banner trở lại đúng **187+186 = 373**.
 *
 * ⇒ Vấn đề KHÔNG phải hiệu năng. Lô E đo 549 máy/tầng: **3 draw call, 57–59 FPS**
 *   — ngân sách §4 (≤150 call, ≥30 FPS) đạt rộng rãi. Nên module này **KHÔNG có
 *   ngưỡng chặn nào theo số máy**. Thêm một giới hạn "để an toàn" ở đây là bịa
 *   ra một ràng buộc mà phép đo đã bác bỏ (G5: cổng xanh trên tập rỗng).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ "NẠP" KHÁC "PHẠM VI" — HAI TRỤC, KHÔNG PHẢI MỘT
 * ════════════════════════════════════════════════════════════════════════════
 * `PhamVi` (§10C.2, `duongDanTwin.ts`) trả lời *"đang NHÌN cấp nào"* — nó quyết
 * định camera và độ mờ. `LuaChonNap` ở đây trả lời *"đang HỎI dữ liệu của cái
 * nào"* — nó quyết định `tangIds` gửi lên `twinCanh.canhThietKe`.
 *
 * Trộn hai thứ này là sai: `pv=line:1` vẫn phải nạp CẢ tầng chứa line 1 (người
 * dùng cần thấy hàng xóm để định vị), còn `pv=tapdoan` thì camera lùi ra xa
 * nhưng **vẫn chỉ có dữ liệu của tập đã nạp** — chính là lời nói dối F3 mà
 * `phamViThuc()` bên dưới chấm dứt.
 *
 * ★ Module THUẦN — không react, không three, không `window`. `vitest` chạy
 *   `environment: "node"` và chỉ thu `.unit.test.ts` (RB-8.1).
 */

import type { CapPhamVi, PhamVi } from "./duongDanTwin";

/** Một mục chọn được trong ô chọn — id + nhãn hiện cho người dùng. */
export interface MucChon {
  id: number;
  nhan: string;
}

/**
 * Lựa chọn NẠP đã phân giải: ba id, hoặc `null` khi cấp đó chưa có gì để chọn.
 *
 * `tangId === null` **không** đồng nghĩa "chưa tải xong": nó cũng là câu trả lời
 * đúng khi toà nhà thật sự không có tầng nào `isActive`. Người gọi phân biệt hai
 * ca đó bằng cờ tải của truy vấn, không bằng ô này.
 */
export interface LuaChonNap {
  nhaMayId: number | null;
  toaNhaId: number | null;
  tangId: number | null;
}

/** Tập id có thật ở mỗi cấp, để phân giải một yêu cầu từ URL. */
export interface TapCoSan {
  nhaMay: readonly MucChon[];
  toaNha: readonly MucChon[];
  tang: readonly MucChon[];
}

/** Yêu cầu đọc từ URL — mỗi ô `null` khi tham số vắng hoặc hỏng. */
export interface YeuCauNap {
  nhaMayId: number | null;
  toaNhaId: number | null;
  tangId: number | null;
}

/**
 * Phân giải yêu cầu URL trên tập có thật.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT: MỘT ID KHÔNG CÓ TRONG DANH SÁCH **KHÔNG** ĐƯỢC IM LẶNG DÙNG
 * ════════════════════════════════════════════════════════════════════════════
 * `?toa=9999` khi nhà máy chỉ có toà 3 và 4: nếu ta cứ gửi 9999 lên server thì
 * truy vấn trả rỗng và màn hình hiện một nhà máy TRỐNG — lời khai sai về thế
 * giới (NT-3). Rơi về phần tử đầu là hành vi ĐÚNG ở đây, và nó khác hẳn ba chỉ
 * số `[0]` cũ ở chỗ: **có một ô chọn để đi chỗ khác**, và lựa chọn ấy vào URL.
 *
 * ⚠ Thứ tự phân giải là DÂY CHUYỀN, không phải ba phép độc lập: toà phải thuộc
 *   nhà máy đã chọn, tầng phải thuộc toà đã chọn. Người gọi bảo đảm điều đó bằng
 *   cách truyền `TapCoSan` đã lọc theo cấp trên (`toaNha` của đúng nhà máy đang
 *   chọn). Hàm này KHÔNG tự truy phân cấp — nó không có dữ liệu để làm việc đó,
 *   và giả vờ làm được sẽ sinh nguồn sự thật thứ hai.
 */
export function phanGiaiNap(yc: YeuCauNap, san: TapCoSan): LuaChonNap {
  const chon = (muon: number | null, ds: readonly MucChon[]): number | null => {
    if (ds.length === 0) return null;
    if (muon !== null && ds.some((m) => m.id === muon)) return muon;
    return ds[0].id;
  };
  return {
    nhaMayId: chon(yc.nhaMayId, san.nhaMay),
    toaNhaId: chon(yc.toaNhaId, san.toaNha),
    tangId: chon(yc.tangId, san.tang),
  };
}

/**
 * Yêu cầu URL có bị BỎ QUA không (id trỏ vào thứ không tồn tại)?
 *
 * Dùng để nói THẲNG với người dùng "link bạn mở trỏ tới một tầng không còn nữa,
 * đang hiện tầng khác" thay vì im lặng hiện thứ khác. Một link cũ sau khi ai đó
 * xoá tầng là ca có thật, và im lặng đổi nội dung là đúng lớp lỗi G5 ở phía UI:
 * người dùng tin mình đang xem thứ họ gửi đi.
 */
export function yeuCauBiBoQua(yc: YeuCauNap, kq: LuaChonNap): boolean {
  return (
    (yc.nhaMayId !== null && yc.nhaMayId !== kq.nhaMayId) ||
    (yc.toaNhaId !== null && yc.toaNhaId !== kq.toaNhaId) ||
    (yc.tangId !== null && yc.tangId !== kq.tangId)
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ F2 — ĐỐI SOÁT PHẢI TÍNH TRÊN **TẬP ĐÃ NẠP**, KHÔNG TRÊN CẢ NHÀ MÁY
 * ════════════════════════════════════════════════════════════════════════════
 * `twinCanh.canhThietKe` trả `may` của **cả nhà máy** nhưng `datCho` chỉ của
 * `tangIds` được hỏi. Đem hai tập lệch phạm vi đó so với nhau (`doiSoatCanh`)
 * cho ra câu "**373 máy chưa xếp chỗ**" — trong khi 373 máy ấy ĐÃ có hàng
 * `twin_dat_cho` thật, chỉ là ở tầng không được hỏi.
 *
 * Đây đúng họ G7: **đếm ĐẦU VÀO ≠ ĐẦU RA**. Phép sửa không phải "đừng hiện
 * banner" mà là **cho hai vế cùng một phạm vi**: chỉ đối soát những máy mà lượt
 * nạp này thật sự có thẩm quyền phát biểu.
 *
 * ⚠ Và "máy thuộc tầng nào" KHÔNG đọc được từ `machines` — bảng đó không có cột
 *   tầng. Thứ duy nhất nói máy nào ở tầng nào là chính hàng `twin_dat_cho`
 *   (`tangId`). Nên tập-để-đối-soát = **máy có hàng đặt chỗ trong lượt nạp này**
 *   ∪ **máy chưa có hàng đặt chỗ ở bất kỳ tầng nào ta ĐÃ HỎI**.
 *
 * ★★★ VÀ PHẢI NÓI THẲNG GIỚI HẠN CỦA PHÉP ĐO NÀY (G9 — một phép đếm chỉ đúng
 *   trong phạm vi mẫu của nó): "mọi tầng ta đã hỏi" = mọi tầng của **toà đang
 *   chọn**, vì `canhThietKe` nhận `tangIds` và ta truyền đủ tầng của toà đó.
 *   Máy nằm ở TOÀ KHÁC vẫn không phân biệt được với máy chưa xếp chỗ bằng dữ
 *   liệu client có. Nên chúng KHÔNG bị khai là "chưa xếp chỗ" — chúng vào
 *   `soNgoaiLuotNap`, một con số riêng có nhãn riêng. Khai "chưa đo được" là
 *   câu đúng; khai "chưa xếp chỗ" là câu sai, và đó chính là 373.
 */
export interface TapDoiSoat {
  /** Id máy được phép có mặt trong phép đối soát của lượt nạp này. */
  idMay: number[];
  /** Máy bị loại vì thuộc lượt nạp khác — con số này phải NÓI RA, không giấu. */
  soNgoaiLuotNap: number;
}

/**
 * Lọc tập máy xuống đúng phạm vi mà lượt nạp này phát biểu được.
 *
 * @param idMayHoatDong  máy `isActive` của cả nhà máy (từ `canhThietKe.may`)
 * @param idTrenTangNay  máy có hàng `twin_dat_cho` **ở tầng đang hiện** — đây là
 *        tập đúng bằng tập được VẼ, nên đối soát nó với cảnh là so hai vế cùng
 *        phạm vi (chính là thứ bản cũ không làm)
 * @param idCoDatChoDaHoi máy có hàng đặt chỗ ở BẤT KỲ tầng nào ta ĐÃ HỎI (mọi
 *        tầng của toà đang chọn). Dùng để phân biệt "ở tầng khác" (đã có chỗ)
 *        với "chưa xếp chỗ" (không có chỗ ở đâu cả).
 * @param moiToaDaHoi `true` khi lượt hỏi đã phủ MỌI toà của nhà máy (nhà máy một
 *        toà). Chỉ khi đó "không có chỗ ở tầng nào ta hỏi" mới suy được thành
 *        "CHƯA XẾP CHỖ". `false` ⇒ khai "chưa đo được", không khai sai.
 */
export function tapDoiSoatTheoNap(
  idMayHoatDong: readonly number[],
  idTrenTangNay: readonly number[],
  idCoDatChoDaHoi: readonly number[],
  moiToaDaHoi: boolean,
): TapDoiSoat {
  const tangNay = new Set(idTrenTangNay);
  const daHoi = new Set(idCoDatChoDaHoi);
  const idMay: number[] = [];
  let ngoai = 0;
  for (const id of idMayHoatDong) {
    // Trên tầng đang hiện ⇒ được vẽ ⇒ đối soát nói đúng về nó.
    if (tangNay.has(id)) {
      idMay.push(id);
      continue;
    }
    // Có chỗ ở tầng KHÁC (trong lượt hỏi) ⇒ lượt nạp này KHÔNG phát biểu về nó.
    // ĐÂY LÀ 373 MÁY. Chúng đi vào một con số có nhãn riêng, không vào banner.
    if (daHoi.has(id)) {
      ngoai += 1;
      continue;
    }
    // Không có chỗ ở đâu ta hỏi. Chỉ khi đã hỏi hết mọi toà thì câu "chưa xếp
    // chỗ" mới đúng; còn toà chưa hỏi thì đây là "chưa đo được".
    if (moiToaDaHoi) idMay.push(id);
    else ngoai += 1;
  }
  return { idMay, soNgoaiLuotNap: ngoai };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ F3 — PHẠM VI PHẢI NÓI ĐÚNG THỨ ĐANG HIỆN
 * ════════════════════════════════════════════════════════════════════════════
 * Lô E đo được: `?pv=tapdoan` cho breadcrumb ghi "Tập đoàn" trong khi ô đếm chỉ
 * `549` máy — **1.592 máy của 3 nhà máy khác vắng mặt**. Breadcrumb khai một
 * đằng, dữ liệu một nẻo.
 *
 * Có hai lối thoát, và ta phải chọn một cách có căn cứ:
 *   (a) **Hiện đủ**: nạp cả 4 nhà máy. Nhưng `canhThietKe` nhận ĐÚNG MỘT
 *       `factoryId` (`twinCanhRouter.ts:646-651`) và `twin_dat_cho` không có
 *       đường truy vấn liên-nhà-máy. Làm (a) là đổi hợp đồng server — ngoài
 *       phạm vi lô F, và §11e.6 đã ghi §10C.6 có lỗi hình học riêng (bước lưới
 *       400 m làm 4 khối 3 km lồng vào nhau) chưa ai sửa.
 *   (b) **Nói đúng phạm vi nó đang hiện**: giữ dữ liệu một nhà máy, nhưng
 *       KHÔNG cho breadcrumb tự xưng "Tập đoàn".
 *
 * ⇒ Chọn (b), và **khai thẳng lý do trên giao diện** thay vì lặng lẽ hạ cấp:
 *   `phamViThuc()` hạ `tapDoan` xuống `nhaMay` và trả cờ `daHaCap` để người gọi
 *   hiện một dòng giải thích. Hạ cấp im lặng cũng là nói dối, chỉ theo chiều
 *   ngược lại.
 */
export interface PhamViThuc {
  pv: PhamVi;
  /** true ⇒ phạm vi yêu cầu đã bị hạ vì dữ liệu không với tới đó. */
  daHaCap: boolean;
  /** Cấp người dùng YÊU CẦU (để câu giải thích nêu đích danh). */
  capYeuCau: CapPhamVi;
}

/**
 * Hạ phạm vi xuống mức mà dữ liệu ĐÃ NẠP thật sự phát biểu được.
 *
 * Hiện chỉ có một luật: `tapDoan` cần dữ liệu nhiều nhà máy, mà đường nạp chỉ
 * cho một. Khi `soNhaMayDaNap >= soNhaMayCoThat` thì `tapDoan` là câu ĐÚNG (một
 * tập đoàn một nhà máy), nên không hạ — cũng chính là nghiệm thu §10C.6 mà lô E
 * chỉ ra đang hỏng: tạo nhà máy thứ hai phải làm hành vi này ĐỔI.
 */
export function phamViThuc(
  yeuCau: PhamVi,
  soNhaMayCoThat: number,
  soNhaMayDaNap: number,
): PhamViThuc {
  if (yeuCau.cap === "tapDoan" && soNhaMayCoThat > soNhaMayDaNap) {
    return { pv: { cap: "nhaMay", id: null }, daHaCap: true, capYeuCau: "tapDoan" };
  }
  return { pv: yeuCau, daHaCap: false, capYeuCau: yeuCau.cap };
}
