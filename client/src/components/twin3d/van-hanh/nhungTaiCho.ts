/**
 * nhungTaiCho.ts — LUẬT của **XEM CHI TIẾT TẠI CHỖ** (Đợt 10 mục 5, §11e.5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VẤN ĐỀ ĐO ĐƯỢC MÀ MODULE NÀY GIẢI
 * ════════════════════════════════════════════════════════════════════════════
 * Yêu cầu nguyên văn của chủ sở hữu: *"Các phần khi xem chi tiết của máy/Line
 * không sử dụng redirect chuyển trang để xem rất bất tiện, cần sử dụng dialog
 * hoặc modal hiển thị thông tin/hiển thị trên panel đó luôn và có phím back
 * cũng được để ng dùng không cần rời màn hình 3D digital Twin"*.
 *
 * Hiện trạng đo được trước đợt này:
 *   `NganXuLy.tsx:528`  `onClick={() => onDieuHuong(n.href)}` + icon `ExternalLink`
 *   `TwinVanHanh.tsx:1721` `onDieuHuong={setLocation}`
 *   ⇒ bấm "Mở chức năng" = **rời hẳn `/twin`**. Cảnh 3D bị huỷ, camera mất,
 *     phạm vi mất, và đường về duy nhất là nút Back của trình duyệt.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RÀNG BUỘC KIẾN TRÚC: **NHÚNG**, KHÔNG DỰNG LẠI (§11b/§11c.7)
 * ════════════════════════════════════════════════════════════════════════════
 * Các đích (`/machine/:id`, `/robot/:id`, `/station-analysis/:id`) là **màn
 * KHÔNG ĐƯỢC XOÁ**: §11.4 ghi *"Giữ ở cockpit"* cho #24/#25/#27/#28, và
 * `MachineCockpit` có consumer NGOÀI Twin (`MachineWorkspace.tsx:17`).
 * ⇒ Việc đúng là **mở NỘI DUNG CỦA CHÍNH MÀN ĐÓ trong một ngăn trên `/twin`**,
 *   không phải chép sáu tính năng sang Twin (đó là G12 — hai bản cài đặt của
 *   cùng một thứ, và chúng sẽ lệch nhau).
 *
 * ★ Tiền lệ đã có sẵn trong repo: `MachineCockpit.tsx:720` export
 *   `MachineCockpitBody({machineId, embedded})` — chính là hình dạng cần, và
 *   `MachineWorkspace.tsx:78` đã nhúng nó thật. Đợt này áp cùng khuôn cho
 *   `RobotCockpit` và `StationAnalysis` (xem "PHÁT HIỆN" dưới).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÁT HIỆN ĐÁNG BÁO (đo 2026-09-07) — HAI MÀN **KHÔNG CÓ** THÂN NHÚNG
 * ════════════════════════════════════════════════════════════════════════════
 * | Màn                  | Thân nhúng | Nguồn id                       | DashboardLayout |
 * |----------------------|-----------|--------------------------------|-----------------|
 * | `MachineCockpit`     | **CÓ** `MachineCockpitBody` (`:720`) | tham số | ở wrapper `:1219` |
 * | `RobotCockpit`       | **KHÔNG** | `useRoute("/robot/:id")` `:304` | trong thân `:443,:452` |
 * | `StationAnalysis`    | **KHÔNG** | `useParams()` `:159`            | trong thân `:334,:347` |
 *
 * Hai màn sau **tự đọc route** ⇒ không thể nhúng: đặt chúng vào `/twin` thì
 * `useRoute("/robot/:id")` không khớp, `robotId = NaN`, và màn hiện "Invalid
 * robot id" — một chế độ hỏng **CÂM** (không lỗi, chỉ nội dung sai).
 * ⇒ Cách rẻ nhất và duy nhất không đổi hành vi màn cũ: **tách thân** theo đúng
 *   khuôn `MachineCockpitBody` — id thành THAM SỐ, `DashboardLayout` lùi ra
 *   wrapper `default export`. Route `/robot/:id` và `/station-analysis/:id`
 *   (`App.tsx:454`, `:336`) vẫn trỏ tới `default` nên **0 thay đổi hành vi**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TRẠNG THÁI NGĂN PHẢI VÀO URL — VÀ VÌ SAO KHOÁ RIÊNG `xem=`
 * ════════════════════════════════════════════════════════════════════════════
 * F5 giữa lúc đang xem chi tiết mà mất ngăn = đúng thứ bất tiện chủ sở hữu than
 * phiền, chỉ đổi nguyên nhân. Nên ngăn mở phải mã hoá được vào URL.
 *
 * ★ Dùng khoá RIÊNG `xem=` thay vì thêm một ô vào `TrangThaiTwinUrl`:
 *   `tronTrangThaiUrl` (`duongDanTwin.ts:313`) chỉ đụng 5 khoá nó biết
 *   (`pv/chon/cam/lop/tg`) và **giữ nguyên mọi tham số lạ** — nên `xem=` sống
 *   sót qua mọi lần ghi URL của tầng cảnh, và ngược lại. Hai module ghi cùng
 *   một query string mà không cần biết nhau: đó là lý do khoá riêng ĐÚNG hơn
 *   là mở rộng hợp đồng chung.
 *
 * ★ Module THUẦN — không react, không `window`, không three. `vitest` chạy
 *   `environment: "node"` cho `*.unit.test.ts` (RB-8.1), nên mọi luật phân
 *   tích/ghép chuỗi nằm ở đây thì mới canh được bằng test.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ URL LÀ ĐẦU VÀO KHÔNG TIN ĐƯỢC (cùng luật `duongDanTwin.ts`)
 * ════════════════════════════════════════════════════════════════════════════
 * `?xem=robot:abc`, `?xem=<script>`, `?xem=machine:-1` đều phải rơi về "không
 * mở ngăn nào", KHÔNG được ném và KHÔNG được lặng lẽ "sửa" thành thứ trông hợp
 * lệ. Danh sách loại là ĐÓNG: một loại đã bị gỡ ở phiên bản sau không được đi
 * tiếp vào trạng thái ứng dụng.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. KIỂU                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Loại nội dung nhúng được **tại chỗ** trên `/twin`.
 *
 * ⚠ Danh sách này KHÔNG phải "mọi đích điều hướng". Nó là tập con có **thân
 *   nhúng thật** (`*Body`). Một đích không nhúng được (ví dụ `/control-plane`,
 *   `/andon` — màn có bộ lọc/tab riêng, chưa tách thân) vẫn đi đường cũ, và
 *   người dùng thấy đúng một hành vi khác NHÌN RA ĐƯỢC (icon `ExternalLink`),
 *   thay vì một ngăn mở ra rỗng. Trung thực hơn một ngăn giả.
 */
export type LoaiNhung = "machine" | "robot" | "station";

/** Ngăn nhúng đang mở: loại + id thực thể. */
export interface NganNhungMo {
  loai: LoaiNhung;
  id: number;
}

/** Mọi loại nhúng hợp lệ — dùng để KIỂM, không để đoán. */
const LOAI_NHUNG_HOP_LE: readonly LoaiNhung[] = ["machine", "robot", "station"];

/** Khoá query string dành riêng cho ngăn nhúng. Một chỗ, không chép tay. */
export const KHOA_XEM = "xem";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. ĐỌC / GHI URL                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Số nguyên dương từ chuỗi; `null` với mọi thứ khác (kể cả `"1.5"`, `"-2"`, `"1e3"`). */
function soNguyenDuong(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Đọc `xem=` → ngăn nhúng. `null` khi vắng, sai khuôn, loại lạ, hoặc id không
 * hợp lệ.
 *
 * `xem=machine` (thiếu id) là HỎNG, không phải "máy nào cũng được" — mở ngăn
 * cho một máy tuỳ ý là nói dối về thứ người dùng gửi.
 */
export function docNganNhung(raw: string | null | undefined): NganNhungMo | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const [loai, phanId, ...du] = s.split(":");
  if (du.length > 0 || phanId === undefined) return null;
  if (!(LOAI_NHUNG_HOP_LE as readonly string[]).includes(loai)) return null;
  const id = soNguyenDuong(phanId);
  return id === null ? null : { loai: loai as LoaiNhung, id };
}

/** Ghi ngăn nhúng → chuỗi `xem`. Nghịch đảo của {@link docNganNhung}. */
export function ghiNganNhung(n: NganNhungMo): string {
  return `${n.loai}:${n.id}`;
}

/**
 * Đọc ngăn nhúng ra từ MỘT query string đầy đủ (`?pv=…&xem=…` hoặc không có `?`).
 *
 * Tách khỏi {@link docNganNhung} vì tầng gọi có sẵn cả query string, và để test
 * ghim được ca "tham số lạ đứng cạnh không làm hỏng phép đọc".
 */
export function docXemTuQuery(queryString: string): NganNhungMo | null {
  const sp = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString,
  );
  return docNganNhung(sp.get(KHOA_XEM));
}

/**
 * Trộn ngăn nhúng vào một query string SẴN CÓ, **giữ nguyên mọi tham số khác**.
 *
 * ★★★ ĐÂY LÀ ĐIỂM MẤU CHỐT CỦA CẢ MODULE. `/twin` không sở hữu độc quyền query
 *   string: `duongDanTwin.ts` ghi `pv/chon/cam/lop/tg`, công cụ theo dõi gắn
 *   `utm_*`. Ghi đè cả chuỗi sẽ **nuốt phạm vi và camera** — nghĩa là mở ngăn
 *   chi tiết làm mất đúng ngữ cảnh 3D mà cả tính năng này sinh ra để giữ.
 *
 * Truyền `null` để ĐÓNG ngăn (xoá khoá khỏi URL, không để lại `xem=` rỗng).
 */
export function tronXemVaoQuery(
  queryStringHienTai: string,
  ngan: NganNhungMo | null,
): string {
  const sp = new URLSearchParams(
    queryStringHienTai.startsWith("?") ? queryStringHienTai.slice(1) : queryStringHienTai,
  );
  if (ngan === null) sp.delete(KHOA_XEM);
  else sp.set(KHOA_XEM, ghiNganNhung(ngan));
  return sp.toString();
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. HREF → NGĂN NHÚNG                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ánh xạ một `href` của {@link import("./nganXuLyLogic").nutDieuHuongCho} sang
 * ngăn nhúng tương ứng, hoặc `null` nếu đích đó **chưa nhúng được**.
 *
 * ★★★ VÌ SAO PHÂN TÍCH HREF THAY VÌ THÊM Ô VÀO `NutDieuHuong`
 * `nutDieuHuongCho` là **bảng đích đo được từ `App.tsx`/`navigation.tsx`** —
 * `href` ở đó là nguồn sự thật đã được kiểm. Thêm một ô `nhung` cạnh nó tạo
 * NGUỒN SỰ THẬT THỨ HAI về "nút này trỏ đi đâu", và hai ô sẽ lệch nhau ngay lần
 * đầu ai đó đổi một `href` mà quên ô kia (G12 — đúng lớp lỗi "hai bản cài đặt").
 * Suy từ chính `href` thì không có đường nào để lệch.
 *
 * ⚠ Chỉ khớp đường dẫn **CHÍNH XÁC** `/machine/:id`, `/robot/:id`,
 *   `/station-analysis/:id`. Cố ý KHÔNG khớp:
 *     • `/device-monitor?tab=health` — màn danh sách toàn hệ, không thuộc một máy
 *     • `/history?machineId=` `/traceability?machineId=` — màn có bộ lọc/khoảng
 *       ngày riêng, chưa tách thân
 *     • `/control-plane?machineId=` `/command-console?robotId=` — **màn ra lệnh
 *       OT**. Nhúng một mặt ra lệnh vào cạnh cảnh 3D là mời gọi bấm nhầm; và
 *       §11 xếp chúng vào "mở đường tới nơi thao tác", không phải "kéo về Twin".
 *   Mọi đích trên vẫn mở được bằng lối thoát phụ (tab mới) — không mất chức năng.
 */
export function nhungChoHref(href: string): NganNhungMo | null {
  // Cắt query + fragment: chỉ phần đường dẫn mới quyết định loại.
  const duong = href.split("?")[0].split("#")[0];
  const doan = duong.split("/").filter((x) => x !== "");
  if (doan.length !== 2) return null;

  const [dau, phanId] = doan;
  const id = soNguyenDuong(phanId);
  if (id === null) return null;

  if (dau === "machine") return { loai: "machine", id };
  if (dau === "robot") return { loai: "robot", id };
  if (dau === "station-analysis") return { loai: "station", id };
  return null;
}

/**
 * `true` nếu `href` mở được TẠI CHỖ. Đường tắt đọc dễ cho tầng component; nó
 * KHÔNG phải phép tính thứ hai — nó gọi thẳng {@link nhungChoHref}.
 */
export function nhungDuoc(href: string): boolean {
  return nhungChoHref(href) !== null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 4. TIÊU ĐỀ NGĂN                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Khoá i18n cho tiêu đề ngăn theo loại. Một chỗ, để nhãn không lệch giữa hai nơi. */
const KHOA_TIEU_DE: Readonly<Record<LoaiNhung, string>> = {
  machine: "twin3d.vanHanh.nhung.tieuDeMay",
  robot: "twin3d.vanHanh.nhung.tieuDeRobot",
  station: "twin3d.vanHanh.nhung.tieuDeTram",
};

/** Nhãn dự phòng khi i18n chưa có khoá — tiếng Việt, khớp `defaultValue` ở component. */
const NHAN_DU_PHONG: Readonly<Record<LoaiNhung, string>> = {
  machine: "Chi tiết máy",
  robot: "Buồng lái robot",
  station: "Phân tích trạm",
};

/** Khoá i18n cho tiêu đề của một ngăn. */
export function khoaTieuDeNhung(loai: LoaiNhung): string {
  return KHOA_TIEU_DE[loai];
}

/** Nhãn dự phòng cho tiêu đề của một ngăn. */
export function nhanDuPhongNhung(loai: LoaiNhung): string {
  return NHAN_DU_PHONG[loai];
}

/**
 * `href` gốc của một ngăn — dùng cho **lối thoát phụ** ("mở màn đầy đủ").
 *
 * ★ Sinh từ cùng bảng loại nên nó là **nghịch đảo thật** của
 *   {@link nhungChoHref}: `nhungChoHref(hrefGocCuaNgan(n))` phải cho lại `n`.
 *   Test ghim tính khứ hồi đó — nếu không, nút "mở màn đầy đủ" có thể trỏ đi
 *   một nơi khác với nội dung đang hiện, và không lỗi nào nổ.
 */
export function hrefGocCuaNgan(n: NganNhungMo): string {
  switch (n.loai) {
    case "machine":
      return `/machine/${n.id}`;
    case "robot":
      return `/robot/${n.id}`;
    case "station":
      return `/station-analysis/${n.id}`;
  }
}
