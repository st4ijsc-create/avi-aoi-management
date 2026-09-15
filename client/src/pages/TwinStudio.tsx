/**
 * `/twin-studio` — Màn THIẾT KẾ (dựng nhà xưởng, đặt máy) của Nhà máy 3D Digital Twin.
 *
 * ★ QUYỀN (§6.4 + bài học Khối D): route này gate `settings_factory`, và mục nav
 * tương ứng trong `navigation.tsx` khai ĐÚNG chuỗi đó. Lớp lỗi phải tránh là "một
 * lối vào rồi TỪ CHỐI" — mục nav khai quyền X trong khi route đích đòi quyền Y, nên
 * người dùng THẤY dòng menu rồi bị chặn khi bấm vào.
 *   `RouteGuard navHref="/twin-studio"` là cách repo cưỡng chế điều đó: guard không
 * tự khai quyền mà TRA từ chính `navGroups`, nên hai bên không thể lệch nhau.
 *   Router ghi (`twinCanh`) mở RỘNG HƠN — `settings_factory` HOẶC `machine_control`
 * theo §6.4. Rộng hơn ở đường GHI trong khi đường VÀO hẹp hơn là an toàn theo hướng
 * đúng: không ai thấy menu rồi bị chặn. Chiều ngược lại mới là lỗi Khối D.
 *
 * ⚠ Phép đo quyền cho màn này PHẢI thực hiện bằng tài khoản KHÔNG phải admin — admin
 * bypass `requirePermission`, nên đo bằng admin chứng minh số 0 (§6.4).
 *
 * ── ĐỢT 3 lắp phần DỰNG NHÀ XƯỞNG (§10A) ─────────────────────────────────────
 *   Con đường B (§10A.2) — `DungNhaXuong`: form 3 bước, nhập mét, lưu milimét.
 *   Con đường A (§10A.1) — `NhapBanVe`: nhập CAD, hộp thoại hiệu chỉnh BẮT BUỘC.
 * Ba vùng của §7.1, gizmo, cây phân cấp, bộ 12 công cụ, thư viện asset thuộc ĐỢT 4.
 *
 * ⚠ KHÔNG dựng `<Canvas>` ở màn này trong Đợt 3 (RB-4: một context WebGL sống tại
 *   một thời điểm; chỗ đó thuộc về khung cảnh chính của Đợt 4). Xem trước của Đợt 3
 *   là SVG đúng tỉ lệ — đủ để thấy tầng chồng nhau và đối chiếu hình người 1,7 m.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, FileUp, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { useCanWrite } from "@/components/PermissionGate";
import { isScopeEmpty } from "@/lib/scopeEmpty";
import DungNhaXuong from "@/components/twin3d/thiet-ke/DungNhaXuong";
import NhapBanVe from "@/components/twin3d/thiet-ke/NhapBanVe";
import XuongThietKe from "@/components/twin3d/thiet-ke/XuongThietKe";
import { HopThoaiChuaLuu } from "@/components/twin3d/thiet-ke/HopThoaiChuaLuu";
import { giaiNapThietKe } from "@/components/twin3d/thiet-ke/napStudio";
import { tinhQuyenXuong } from "@/components/twin3d/thiet-ke/quyenXuong";
import { BoChonNapUI } from "@/components/twin3d/van-hanh/BoChonNapUI";
import { chieuCaoTruDinh, useTruDinhKhung } from "@/components/twin3d/van-hanh/useTruDinhKhung";

/**
 * Một Ý MUỐN đổi lượt nạp — thứ `xinDoiNap` giữ lại trong lúc hỏi người dùng.
 *
 * ★ Ba nhánh, không phải một `tangId`: đổi nhà máy/toà cũng KÉO THEO đổi tầng
 *   (id cũ không còn trong danh sách ⇒ `giaiNapThietKe` rơi về phần tử đầu),
 *   nên cả ba đều làm mất buffer y như nhau.
 *
 * ★★★ V-14(1) — NHÁNH THỨ TƯ `tab`: Radix `Tabs` **UNMOUNT** nội dung tab không
 *   hoạt động (chỗ này CỐ Ý dựa vào điều đó — RB-4, xem docblock cạnh
 *   `TabsTrigger value="thiet-ke"`). Nên bấm sang tab khác cũng tháo
 *   `XuongThietKe` và vứt buffer y hệt đổi tầng: **cùng lớp mất mát, khác cửa
 *   vào**. Nó mang `tab: string` chứ không `id: number` vì đích của nó là một
 *   giá trị tab, không phải một hàng trong cơ sở dữ liệu.
 */
type YDinhDoiNap =
  | { loai: "nha-may"; id: number }
  | { loai: "toa-nha"; id: number }
  | { loai: "tang"; id: number }
  | { loai: "tab"; tab: string };

export default function TwinStudio() {
  const { t } = useTranslation();
  /*
   * ★★★ ĐỢT 35 (Pareto #4) — CHIỀU CAO ĐO TỪ VỊ TRÍ THẬT, KHÔNG `h-[calc(100vh-5rem)]`.
   *   QA Đợt 32 đo: đỉnh khung này là **133 px** (không phải 80) ⇒ đáy 953 > 900 và 773 > 720,
   *   thư viện asset/bảng thuộc tính bị cắt dưới mép. Cùng bài học Đợt 30 (Line) — xem docblock
   *   `useTruDinhKhung`. Biến RIÊNG `--twin-studio-top`.
   */
  const khungRef = useRef<HTMLDivElement | null>(null);
  useTruDinhKhung(khungRef, "--twin-studio-top");
  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ PH-15 — QUYỀN TÁCH THEO ĐÚNG CỔNG SERVER, KHÔNG PHẢI MỘT CỜ
   * ════════════════════════════════════════════════════════════════════════
   * Tab "Thêm toà nhà" gọi `twinCanh.dungNhaXuong` = `quyenThietKe("canCreate")`
   * (`twinCanhRouter.ts:839-840`). QA lần 11 ô E6 đo được: vai có `canEdit` mà
   * **0 `canCreate`** vẫn đi hết ba bước tới nút "Create building" render +
   * enabled, và chỉ nhận 403 SAU khi bấm — đúng lớp "một lối vào rồi TỪ CHỐI".
   *
   * ★ ẨN cả tab, không disable nút cuối: người dùng không có quyền tạo thì ba
   *   bước nhập liệu kia cũng vô nghĩa với họ. Bảng nút × cổng ở `quyenXuong.ts`.
   */
  const ghiSettings = useCanWrite("settings_factory");
  const ghiMayMoc = useCanWrite("machine_control");
  const quyen = tinhQuyenXuong({
    /* ⚠ `canView` ở màn này không gác gì (mọi người vào được đều xem được ba tab);
       khai `false` để KHÔNG dựng một cổng giả — `TwinStudio` chỉ đọc `quyen.tao`. */
    settingsFactory: { ...ghiSettings, canView: false },
    machineControl: { ...ghiMayMoc, canView: false },
    // `usePermissions` bypass cho admin ⇒ `useCanWrite` đã trả true hết; màn này
    // không cần cờ admin riêng (chỉ `sinhTuDong` trong `XuongThietKe` mới cần).
    laAdmin: false,
  });

  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ PH-14 — BA Ô CHỌN, KHÔNG CÒN HAI CHỈ SỐ `[0]` VIẾT CỨNG
   * ════════════════════════════════════════════════════════════════════════
   * Bản trước: `factoryId` trong state + `toaNhaQ.data[0]` + `tangs[0]` ⇒ với
   * kịch bản 4 toà × 7 tầng, **326/371 máy (88 %) không thể xếp chỗ bằng màn
   * này** (`.qa-tapdoan/BANG-DE.md` ô 22). Luật phân giải và bộ ba `<select>`
   * đều TÁI DÙNG của màn xem (`van-hanh/boChonNap.ts` + `BoChonNapUI.tsx`) —
   * xem docblock `thiet-ke/napStudio.ts` về cái gì tái dùng và cái gì KHÔNG.
   *
   * ★ Ba `useState` giữ Ý MUỐN của người dùng, không phải kết quả: `giaiNapThietKe`
   *   phân giải ý muốn ấy trên tập CÓ THẬT ở mỗi lượt render. Nhờ vậy đổi nhà
   *   máy tự động rơi về toà đầu của nhà máy mới (id toà cũ không còn trong
   *   danh sách) mà không cần một `useEffect` đồng bộ nào — và không có
   *   `useEffect` nghĩa là không có khoảnh khắc hai ô nói hai chuyện.
   */
  const [nhaMayMuon, setNhaMayMuon] = useState<number | null>(null);
  const [toaNhaMuon, setToaNhaMuon] = useState<number | null>(null);
  const [tangMuon, setTangMuon] = useState<number | null>(null);

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ H1 — ĐỔI TẦNG KHI CÒN THAY ĐỔI CHƯA LƯU KHÔNG ĐƯỢC MẤT TRONG IM LẶNG
   * ════════════════════════════════════════════════════════════════════════
   * Đo sống vòng 2: bật Lock một khối ⇒ *"1 unsaved changes"*; đổi tầng ⇒ đếm
   * về 0, KHÔNG hộp thoại, KHÔNG toast, quay lại tầng cũ KHÔNG khôi phục.
   * `<XuongThietKe key={tangDangChon.tangId}>` remount ⇒ buffer bị vứt.
   *
   * ★★★ VÌ SAO CHẶN Ý MUỐN, KHÔNG PHẢI GỠ `key` — `key` là thứ giữ cho một cú
   *   "Lưu" không ghi hàng của tầng CŨ xuống tầng ĐANG CHỌN (xem docblock cạnh
   *   `key=` bên dưới). Gỡ nó là đổi một lỗi mất-buffer lấy một lỗi GHI SAI BẢN
   *   GHI — tệ hơn hẳn. Nên bản vá này không đụng tới `key`: nó chặn ở chỗ ý
   *   muốn đổi mới SINH RA, tức TRƯỚC khi có bất kỳ lượt remount nào. Hệ quả
   *   đo được: `luu()` của "Lưu rồi chuyển" luôn chạy khi xưởng còn mounted với
   *   `tangId` CŨ — đúng tầng của những hàng trong buffer.
   *
   * ★ `useRef` chứ không `useState` cho số thay đổi: nó là thứ ta HỎI lúc người
   *   dùng bấm ô chọn, không phải thứ vẽ ra màn hình mỗi nhịp. Đưa vào state sẽ
   *   bắt cả cây `/twin-studio` render lại mỗi lần kéo một máy.
   */
  const refChuaLuu = useRef<{ so: number; luu: () => Promise<boolean> }>({
    so: 0,
    luu: async () => true,
  });
  const baoThayDoiChuaLuu = useCallback(
    (trangThai: { so: number; luu: () => Promise<boolean> }) => {
      refChuaLuu.current = trangThai;
    },
    [],
  );
  const [yDinhDoi, setYDinhDoi] = useState<YDinhDoiNap | null>(null);
  const [dangLuuRoiDoi, setDangLuuRoiDoi] = useState(false);

  /**
   * ★★★ V-14(1) — TAB ĐANG MỞ NAY LÀ STATE, KHÔNG CÒN `defaultValue`.
   *   `defaultValue` để Radix tự giữ tab đang mở, nên trang KHÔNG có chỗ nào để
   *   từ chối một lượt đổi tab. Controlled là điều kiện cần để cổng
   *   `xinDoiNap` chặn được lối vào thứ tư này.
   */
  const [tabDangMo, setTabDangMo] = useState("thiet-ke");

  /** Thi hành một ý muốn đổi — ĐÚNG những `setState` mà ba ô chọn vẫn làm. */
  const apDoiNap = useCallback((y: YDinhDoiNap) => {
    if (y.loai === "tab") {
      setTabDangMo(y.tab);
      return;
    }
    if (y.loai === "nha-may") {
      setNhaMayMuon(y.id);
      // Ý muốn cũ ở hai cấp dưới đã hết nghĩa: giữ lại chỉ làm
      // `phanGiaiNap` phải bỏ qua chúng mỗi lượt render.
      setToaNhaMuon(null);
      setTangMuon(null);
      return;
    }
    if (y.loai === "toa-nha") {
      setToaNhaMuon(y.id);
      setTangMuon(null);
      return;
    }
    setTangMuon(y.id);
  }, []);

  /**
   * Cổng DUY NHẤT của ba ô chọn. Cả ba đều đổi TẦNG ĐANG MỞ (đổi nhà máy/toà
   * kéo theo tầng đầu của nhánh mới), nên cả ba phải đi qua đây — gác mỗi ô
   * `chon-tang` sẽ để nguyên hai lối vào còn lại cho đúng lớp lỗi ấy.
   */
  const xinDoiNap = useCallback(
    (y: YDinhDoiNap) => {
      if (refChuaLuu.current.so > 0) {
        setYDinhDoi(y);
        return;
      }
      apDoiNap(y);
    },
    [apDoiNap],
  );

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ V-14(1) — ĐỔI TAB ĐI QUA ĐÚNG CỔNG CỦA ĐỔI TẦNG
   * ════════════════════════════════════════════════════════════════════════
   * Bộ tab gỡ nội dung tab không hoạt động khỏi cây, nên đổi tab cũng vứt
   * buffer y như đổi tầng — cùng lớp lỗi, khác cửa vào (QA lần 11, V-14 số 1).
   *
   * ★ Gọi thẳng `xinDoiNap` chứ KHÔNG chép lại phép so `so > 0`: một luật hai
   *   bản sao là hai chỗ để chúng lệch nhau, và lệch âm thầm (mỗi bên có lưới
   *   riêng, cả hai xanh). Cổng vẫn là MỘT.
   *
   * ★ Và vẫn KHÔNG đụng `key={tangDangChon.tangId}`: chặn ở Ý MUỐN đổi nghĩa là
   *   xưởng còn nguyên trong cây lúc người dùng chọn "Lưu rồi chuyển", nên lượt
   *   ghi vẫn xuống ĐÚNG mặt sàn đang mở.
   */
  const xinDoiTab = useCallback(
    (tabMoi: string) => xinDoiNap({ loai: "tab", tab: tabMoi }),
    [xinDoiNap],
  );

  const luuRoiDoi = useCallback(async () => {
    const y = yDinhDoi;
    if (!y) return;
    setDangLuuRoiDoi(true);
    let daGhiXong = false;
    try {
      daGhiXong = await refChuaLuu.current.luu();
    } finally {
      setDangLuuRoiDoi(false);
    }
    // ★ Ghi hỏng ⇒ GIỮ hộp thoại và GIỮ tầng. Đổi tầng sau một lượt ghi thất
    //   bại là lại mất dữ liệu trong im lặng — đúng thứ bản vá này đang chữa.
    if (!daGhiXong) return;
    setYDinhDoi(null);
    apDoiNap(y);
  }, [yDinhDoi, apDoiNap]);

  const boThayDoiRoiDoi = useCallback(() => {
    const y = yDinhDoi;
    setYDinhDoi(null);
    if (y) apDoiNap(y);
  }, [yDinhDoi, apDoiNap]);

  const factoryId = useMemo(
    () =>
      giaiNapThietKe(
        { nhaMayId: nhaMayMuon, toaNhaId: null, tangId: null },
        { nhaMay: factories, toaNha: [], tang: [] },
      ).nhaMayId,
    [nhaMayMuon, factories],
  );

  const toaNhaQ = trpc.twinCanh.danhSachToaNha.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId !== null },
  );

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ THƯỜNG-2(b) — "CHƯA CÓ NHÀ MÁY" ≠ "CHƯA ĐƯỢC GÁN NHÀ MÁY"
   * ════════════════════════════════════════════════════════════════════════
   * Đo được 2026-09-06: tài khoản không-admin KHÔNG có hàng trong
   * `user_factory_assignments` mở màn này thì `factory.list` trả `[]` ⇒
   * `factoryId` ở nguyên `null` ⇒ nhánh `factoryId === null` render **`null`**,
   * tức MÀN HÌNH TRẮNG không một chữ giải thích. Người dùng không phân biệt được
   * "hệ thống chưa có nhà máy nào" với "tôi chưa được gán".
   *
   * ★ `canhThietKe` là truy vấn CÙNG MÀN có mang nhãn phạm vi (server đã đính ba
   *   ô qua `resolveTenantFactoryScope`). Đây đúng là khuôn mà `withScopeLabels`
   *   dặn: thủ tục trả mảng không mang được nhãn qua tRPC, nên giao diện lấy lý
   *   do từ truy vấn có nhãn cùng màn.
   *
   * ⚠ `enabled` khi CHƯA có nhà máy — đó chính là ca cần hỏi. Truyền `factoryId:
   *   0` là hợp lệ với `positive()`? KHÔNG. Nên chỉ chạy khi thật sự rỗng và
   *   dùng `factoryId` giả 1 chỉ để LẤY NHÃN, không dùng dữ liệu trả về.
   */
  const nhanPhamViQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: 1, tangIds: [] },
    { enabled: factoryId === null && !factoriesQ.isLoading, retry: false },
  );
  const phamViRong = isScopeEmpty(
    (nhanPhamViQ.data as { scopeEmptyReason?: string | null } | undefined)?.scopeEmptyReason,
  );

  /**
   * ĐỢT 4 — toà nhà ĐANG CHỌN, để lấy TẦNG và KÍCH THƯỚC SÀN.
   *
   * ★★★ PH-14: "đang chọn", KHÔNG còn "đầu tiên". `giaiNapThietKe` phân giải
   *   ý muốn của người dùng trên danh sách có thật; id không tồn tại (link cũ,
   *   vừa đổi nhà máy) rơi về phần tử đầu — khác `[0]` viết cứng ở chỗ **có một
   *   ô chọn để đi chỗ khác**.
   *
   * ★ `numeric(14,3)` về từ drizzle là **string**; `Number(...)` tường minh nằm
   *   trong `sanCuaTang()`. Cộng thẳng hai giá trị string sẽ NỐI CHUỖI
   *   ("38400"+"0" = "384000") — không throw, và nhà xưởng to gấp 10 lần.
   */
  const dsToaNha = useMemo(
    () =>
      (toaNhaQ.data ?? []) as Array<{
        id: number;
        ma?: string | null;
        ten?: string | null;
        rongMm: string | number;
        sauMm: string | number;
      }>,
    [toaNhaQ.data],
  );
  const toaNhaId = useMemo(
    () =>
      giaiNapThietKe(
        { nhaMayId: null, toaNhaId: toaNhaMuon, tangId: null },
        { nhaMay: [], toaNha: dsToaNha, tang: [] },
      ).toaNhaId,
    [toaNhaMuon, dsToaNha],
  );

  const chiTietQ = trpc.twinCanh.chiTietToaNha.useQuery(
    { id: toaNhaId ?? 0 },
    { enabled: toaNhaId !== null },
  );

  /*
   * ★ #43 — TẦNG MANG THEO CẢ TRẠNG THÁI ẢNH NỀN.
   *   `traToaNhaKemTang` đã trả `anhNenUrl`/`tiLeMmMoiPx`/`daHieuChuan` (nó
   *   spread nguyên hàng `twin_tang`), nên không cần truy vấn thứ hai. Gọi thêm
   *   một truy vấn cho cùng dữ liệu là mở đường cho hai chỗ hiện hai trạng thái
   *   hiệu chuẩn khác nhau — và người dùng không biết tin cái nào.
   */
  const dsTang = useMemo(
    () =>
      (chiTietQ.data?.tangs ?? []) as Array<{
        id: number;
        capSo?: number | null;
        ten?: string | null;
        anhNenUrl?: string | null;
        tiLeMmMoiPx?: number | string | null;
        daHieuChuan?: boolean | null;
      }>,
    [chiTietQ.data],
  );

  /** Lượt nạp ĐÃ PHÂN GIẢI — ba id + ba danh sách cho ô chọn + hình sàn. */
  const nap = useMemo(
    () =>
      giaiNapThietKe(
        { nhaMayId: nhaMayMuon, toaNhaId: toaNhaMuon, tangId: tangMuon },
        { nhaMay: factories, toaNha: dsToaNha, tang: dsTang },
      ),
    [nhaMayMuon, toaNhaMuon, tangMuon, factories, dsToaNha, dsTang],
  );
  const tangDangChon = nap.san;

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * ★★★ V-14(2) — TẦNG ĐANG MỞ BIẾN MẤT THÌ PHẢI NÓI, KHÔNG ĐƯỢC IM
   * ═════════════════════════════════════════════════════════════════════════
   * Lối mất dữ liệu thứ BA, và là lối KHÔNG AI BẤM GÌ: một lượt nạp lại nền trả
   * danh sách tầng mới thiếu tầng đang mở ⇒ `giaiNapThietKe` rơi về tầng đầu ⇒
   * `key` đổi ⇒ xưởng remount ⇒ buffer bị vứt — **không đi qua `xinDoiNap`**, nên
   * hộp thoại ba nút không cứu được. Ở đây chỉ còn cách nói cho người dùng biết.
   *
   * ★★★ SỐ THAY ĐỔI ĐỌC Ở LƯỢT RENDER, KHÔNG ĐỌC TRONG HIỆU ỨNG — ĐO ĐƯỢC,
   *   KHÔNG SUY ĐOÁN: bản đầu của chính bản vá này đọc `refChuaLuu.current.so`
   *   ngay trong `useEffect` và cảnh báo **không bao giờ kêu** (khối ⑥ đỏ 2/2).
   *   Lý do: React chạy lượt dọn của CON trước hiệu ứng của CHA, mà
   *   `XuongThietKe` dọn lời khai về 0 khi bị tháo (`XuongThietKe.tsx:607`) — tới
   *   lúc hiệu ứng ở đây chạy thì bằng chứng đã bị xoá. Lượt render này xảy ra
   *   TRƯỚC mọi lượt dọn ấy, nên là chỗ duy nhất còn đọc được con số thật.
   */
  const soChuaLuuLucNap = refChuaLuu.current.so;
  /** Id tầng đã cảnh báo rồi — một lượt mất dữ liệu = MỘT câu, không mỗi nhịp một câu. */
  const refDaBaoTangRoi = useRef<number | null>(null);
  useEffect(() => {
    if (!nap.tangBienMat) {
      // Người dùng đã chọn lại một tầng có thật ⇒ mở lại cửa cho lượt rơi sau.
      refDaBaoTangRoi.current = null;
      return;
    }
    if (refDaBaoTangRoi.current === tangMuon) return;
    refDaBaoTangRoi.current = tangMuon;
    // ★ Chỉ kêu khi THẬT SỰ MẤT GÌ: tầng biến mất mà buffer rỗng thì không có
    //   thiệt hại nào để báo, và một cảnh báo kêu oan là cách để người dùng thôi đọc.
    if (soChuaLuuLucNap > 0) {
      toast.warning(
        t(
          "twin3d.studioUi.tangBienMat",
          "Tầng bạn đang thiết kế không còn trong danh sách nữa. Các thay đổi chưa lưu đã mất, màn hình đã chuyển về tầng đầu.",
        ),
      );
    }
  }, [nap.tangBienMat, tangMuon, soChuaLuuLucNap, t]);

  return (
    <div
      ref={khungRef}
      /*
       * ★★★ ĐỢT 45 (mục 7) — KHỐI TIÊU ĐỀ 2 HÀNG, CẢNH ≥ 55 % VÙNG LÀM VIỆC.
       *   QA Đợt 44 (D-7 mục 13) đo @1600: tiêu đề + mô tả 2 dòng + "Toà nhà: 1" + thanh tab h-12 +
       *   đệm = ~187 px trước khi tới tab; canvas 726×373 = 50 % vùng làm việc. @1280 vùng cảnh còn
       *   193 px, canvas sàn 320 chui ra ngoài, mini-map che nút. Cùng nội dung xếp lại thành HAI hàng:
       *     hàng 1: [tiêu đề · mô tả MỘT dòng (cắt, title đủ)]                [Nhà máy ▾]
       *     hàng 2: [Thêm toà nhà | Chọn tệp bản vẽ | Thiết kế] · Toà nhà: 1
       *   Không bỏ chữ nào (mô tả vẫn đọc đủ qua title; đếm toà nhà giữ testid) — chỉ đổi chỗ đứng.
       */
      className="flex flex-col gap-2 px-4 pb-3 pt-3"
      style={{ height: chieuCaoTruDinh("--twin-studio-top") }}
      data-testid="man-twin-studio"
    >
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 text-lg font-semibold text-foreground">{t("twin3d.studio.tieuDe")}</h1>
          <p
            className="hidden min-w-0 truncate text-sm text-muted-foreground lg:block"
            title={t("twin3d.studio.moTa")}
            data-testid="mo-ta-studio"
          >
            {t("twin3d.studio.moTa")}
          </p>
        </div>
        {/*
          ★★★ PH-14 — BA Ô CHỌN, TÁI DÙNG NGUYÊN KIT CỦA MÀN XEM.
            `BoChonNapUI` là chỗ gọi thứ HAI của cùng component mà `/twin` dùng
            (`chon-nha-may` / `chon-toa-nha` / `chon-tang`, bọc trong `bo-chon-nap`).
            Viết lại ba `<select>` ở đây sẽ là bản sao thứ hai của cùng một luật
            a11y + "ô ≤1 mục vẫn phải hiện" — và bản sao thứ hai là chỗ để lỗi
            `[0]` quay lại mà không ai thấy.

          ★ Đổi bất kỳ ô nào cũng chỉ ghi Ý MUỐN; `giaiNapThietKe` phân giải lại
            toàn bộ dây chuyền ở lượt render kế. Đổi nhà máy ⇒ id toà/tầng cũ
            không còn trong danh sách ⇒ tự rơi về phần tử đầu của nhà máy mới.
        */}
        <div className="flex shrink-0 items-center gap-2">
          <BoChonNapUI
            nhaMay={nap.mucNhaMay}
            toaNha={nap.mucToaNha}
            tang={nap.mucTang}
            nhaMayId={nap.nhaMayId}
            toaNhaId={nap.toaNhaId}
            tangId={nap.tangId}
            /* ★★★ H1 — cả ba ô đi qua `xinDoiNap`: nó hỏi trước khi vứt việc
               chưa lưu của người dùng (xem docblock `refChuaLuu`). */
            onDoiNhaMay={(id) => xinDoiNap({ loai: "nha-may", id })}
            onDoiToaNha={(id) => xinDoiNap({ loai: "toa-nha", id })}
            onDoiTang={(id) => xinDoiNap({ loai: "tang", id })}
            dangTai={factoriesQ.isLoading || toaNhaQ.isLoading || chiTietQ.isLoading}
          />
        </div>
      </header>

      {/* ★★★ V-14(1) — `value` + `onValueChange={xinDoiTab}`: mọi lượt đổi tab đi
          qua cổng chặn mất dữ liệu. `defaultValue` (uncontrolled) KHÔNG có chỗ
          để từ chối, nên nó là lối mất buffer thứ hai. */}
      <Tabs value={tabDangMo} onValueChange={xinDoiTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <TabsList className="h-9">
            {/*
              ★★★ PH-15 — CON ĐƯỜNG B GỌI `dungNhaXuong` = `canCreate`. ẨN, KHÔNG
                DISABLE (§6.4; khuôn đúng ở `van-hanh/nganXuLyLogic.ts:102-111`).
                Ẩn CẢ TAB chứ không riêng nút "Tạo" ở bước 3: ba bước nhập kích
                thước chỉ để đi tới lượt ghi ấy, nên với người không bao giờ tạo
                được thì cả ba bước là một lối đi cụt — đúng thứ QA đo ở ô E6.
            */}
            {quyen.tao ? (
              <TabsTrigger value="dien-kich-thuoc" data-testid="tab-con-duong-b">
                <Building2 className="mr-1.5 h-4 w-4" />
                {t("twin3d.toaNha.themMoi")}
              </TabsTrigger>
            ) : null}
            {/*
              ⚠ CON ĐƯỜNG A **KHÔNG** gác theo `canCreate`, và đó là kết luận từ
                phép đo chứ không phải bỏ sót: `NhapBanVe.tsx` có **0 `trpc.*`**,
                0 mutation — nó đọc tệp CAD và vẽ xem trước tại chỗ, chưa nối vào
                `twin_vat_the` (§10A.1, còn nợ). Gác một màn không ghi gì bằng
                quyền GHI là bịa ra ràng buộc mà phép đo đã bác bỏ.
                ⇒ Ai nối con đường A vào đường ghi: thêm cổng ở ĐÚNG lượt đó.
            */}
            <TabsTrigger value="nhap-ban-ve" data-testid="tab-con-duong-a">
              <FileUp className="mr-1.5 h-4 w-4" />
              {t("twin3d.banVe.chonTep")}
            </TabsTrigger>
            {/* ★★★ ĐỢT 4 (§7) — xưởng dựng bố cục. ĐÂY là tab mang `<Canvas>`.
                RB-4: Radix Tabs UNMOUNT nội dung tab không hoạt động, nên chỉ một
                WebGL context sống tại một thời điểm — cùng cơ chế mà
                `TwinHub.tsx:8-9` cố ý dựa vào. `window.__soCanvas` đo được điều
                đó, và `KhungCanh` tự console.error nếu > 1. */}
            <TabsTrigger value="thiet-ke" data-testid="tab-thiet-ke">
              <LayoutGrid className="mr-1.5 h-4 w-4" />
              {t("twin3d.studioUi.thietKe")}
            </TabsTrigger>
          </TabsList>
          {/* Đếm RỖNG khác đếm bằng 0 (NT-3.5): chưa tải xong hiện "—", không hiện 0. */}
          <p className="text-xs text-text-2" data-testid="dem-toa-nha">
            {t("twin3d.toaNha.tieuDe")}:{" "}
            {toaNhaQ.isLoading || factoryId === null ? "—" : (toaNhaQ.data?.length ?? 0)}
          </p>
        </div>

        <TabsContent value="dien-kich-thuoc" className="mt-4">
          {/* ★ Nửa thứ hai của cổng PH-15: tab đã ẩn thì thân cũng không dựng —
              `defaultValue` hay một `?tab=` tương lai không được là cửa sau. */}
          {quyen.tao && factoryId !== null && (
            <DungNhaXuong
              factoryId={factoryId}
              onXongTao={(ket) => {
                void toaNhaQ.refetch();
                // ★ Toà vừa dựng là thứ người dùng muốn thiết kế NGAY. Không
                //   nhảy tới nó thì họ vừa tạo xong lại phải đi tìm trong ô chọn.
                setToaNhaMuon(ket.toaNhaId);
                setTangMuon(ket.tangIds[0] ?? null);
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="nhap-ban-ve" className="mt-4">
          {/* Đợt 4 nối kết quả hiệu chỉnh vào `twin_vat_the` (vỏ nhà) hoặc vào
              chính form con đường B (tách tầng — §10A.3 `cumTangSangDongNhap`). */}
          <NhapBanVe />
        </TabsContent>

        <TabsContent
          value="thiet-ke"
          className="mt-2 min-h-0 flex-1 overflow-hidden rounded-md border data-[state=inactive]:hidden"
        >
          {factoryId === null ? (
            /* ★★★ THƯỜNG-2(b) — nói RÕ vì sao trống, thay cho `null` câm. */
            factoriesQ.isLoading || nhanPhamViQ.isLoading ? null : phamViRong ? (
              <div className="p-4" data-testid="dai-pham-vi-rong">
                <EmptyState scopeEmptyReason="no_factory_assignment" />
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground" data-testid="chua-co-nha-may">
                {t("twin3d.studioUi.chuaCoNhaMay", "Chưa có nhà máy nào để thiết kế.")}
              </p>
            )
          ) : tangDangChon === null ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="chua-co-tang">
              {t("twin3d.studioUi.chuaCoTang")}
            </p>
          ) : (
            <XuongThietKe
              /* ★★★ PH-14 — `key` ép dựng LẠI xưởng khi đổi tầng: `datChoSua`,
                 lịch sử hoàn tác và tập đang chọn đều thuộc về MỘT mặt sàn.
                 `DatChoDauVao` có mang `tangId`, nên KHÔNG giữ `key` thì sau một
                 lượt đổi tầng, ô "N thay đổi chưa lưu" vẫn đếm các hàng của tầng
                 CŨ và một cú "Lưu" sẽ ghi chúng xuống tầng CŨ trong khi người
                 dùng đang nhìn tầng MỚI — một lượt ghi không ai thấy.

                 ★★★ H1 — NỢ TRÊN ĐÃ TRẢ (đợt này): đổi tầng lúc CÒN thay đổi
                 chưa lưu trước đây VỨT chúng đi mà không hỏi. `beforeunload`
                 (§7.3) chỉ chặn lượt rời TRANG. Nay `onThayDoiChuaLuu` đưa
                 `thayDoi.length` lên đây và `xinDoiNap` chặn ý muốn đổi TRƯỚC
                 khi `key` kịp đổi — nên `key` vẫn còn nguyên và lượt "Lưu rồi
                 chuyển" vẫn ghi xuống ĐÚNG tầng cũ. */
              key={tangDangChon.tangId}
              factoryId={factoryId}
              tangId={tangDangChon.tangId}
              sanRongMm={tangDangChon.rongMm}
              sanSauMm={tangDangChon.sauMm}
              anhNenUrl={tangDangChon.anhNenUrl}
              tiLeMmMoiPx={tangDangChon.tiLeMmMoiPx}
              daHieuChuan={tangDangChon.daHieuChuan}
              onDaGhiTang={() => void chiTietQ.refetch()}
              onThayDoiChuaLuu={baoThayDoiChuaLuu}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* ★★★ H1 — cửa chặn lượt đổi tầng. Nó đứng ở đây (không trong
          `XuongThietKe`) vì chỉ màn này biết CẢ ý muốn đổi lẫn số thay đổi. */}
      <HopThoaiChuaLuu
        mo={yDinhDoi !== null}
        soThayDoi={refChuaLuu.current.so}
        dangLuu={dangLuuRoiDoi}
        onLuuRoiDoi={() => void luuRoiDoi()}
        onBoThayDoi={boThayDoiRoiDoi}
        onHuy={() => setYDinhDoi(null)}
      />
    </div>
  );
}
