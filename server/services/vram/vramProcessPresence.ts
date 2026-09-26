/**
 * ★★★ Pha 10 Task 1 — **KÊNH BẰNG CHỨNG PHỤ: "PID CÓ MẶT TRONG HĐH KHÔNG?", KHÔNG SINH TIẾN TRÌNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — MỘT SỰ CỐ SẢN XUẤT ĐO ĐƯỢC, KHÔNG PHẢI MỘT LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ quét hàng ma (`vramAdoption.lapKeHoachNhanNuoi` → `vramReconciler.donHangMa`) **đã tồn tại từ
 * Pha 3 Task 4 và nó ĐÚNG**. Nhưng toàn bộ bằng chứng của nó đến từ **MỘT** cái cửa:
 * `vramGpuHolders.readProcTable()` — một lượt `execFile("powershell.exe", … Get-CimInstance
 * Win32_Process …)`. Và cửa đó **hỏng 100% số nhịp trong tiến trình sản xuất**:
 *
 *   • đo ngày 2026-08-19 trên `app13.log` của tiến trình đang chạy (pid 38432): **20+ nhịp LIÊN
 *     TIẾP** in `"[vram] KHÔNG đọc được bảng tiến trình (powershell lỗi/timeout)"`, không một nhịp
 *     nào đọc được;
 *   • cùng lúc, cùng máy, **cùng chuỗi lệnh y nguyên** chạy từ một tiến trình Node khác:
 *     **413–467 ms, 0 lỗi, 130 KB JSON** (và 669–787 ms khi ép 6 lượt song song). Tức lệnh KHÔNG
 *     sai, `PATH` KHÔNG thiếu (`powershell.exe` giải được), hạn 10 s KHÔNG chật;
 *   • hệ quả: `trangThaiTienTrinh()` trả `"khong-biet"` cho **mọi** hàng ⇒ `xoaHangMa` **luôn
 *     RỖNG** ⇒ hàng ma **không bao giờ** bị dọn. Đo được: 107 hàng / 54.755 MiB hộ ma (2026-08-19),
 *     dư địa **−19.054 MiB**, **mọi** lượt gọi model bị từ chối. Và sau khi chủ dự án dọn tay,
 *     **4 hàng ma vẫn nằm lại 2 ngày** (1.231 MiB, đo lại lúc 10:36 cùng ngày).
 *
 * ⇒ Bài học không phải *"sửa PowerShell"* — mà là: **một vị từ AN TOÀN có đúng một nguồn bằng
 * chứng, và nguồn ấy hỏng CÂM, thì cái "an toàn" chỉ còn là "không bao giờ hành động"**. Chiều
 * chặt (`procs === null` ⇒ không kết luận) VẪN ĐÚNG và **không được đảo**; thứ thiếu là một **cửa
 * thứ hai** để câu hỏi còn trả lời được khi cửa thứ nhất câm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CỬA NÀY TRẢ LỜI ĐƯỢC **MỘT NỬA** CÂU HỎI, VÀ ĐÓ LÀ ĐIỀU PHẢI ĐỌC TRƯỚC KHI DÙNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `process-not-proven-dead` nhận **HAI** loại bằng chứng (xem `vramAdoption` đầu file):
 *   1. **VẮNG MẶT khỏi bảng tiến trình** — PID không tồn tại;
 *   2. **`ctime`/`CreationDate` ĐỔI** — PID đã được HĐH **cấp lại** cho tiến trình KHÁC.
 *
 * Module này chỉ làm được **(1)**. Nó **KHÔNG** đọc được mốc tạo, nên một PID được cấp lại sẽ hiện
 * ra là `"co"` (có mặt) ⇒ người gọi phải trả `"khong-biet"` ⇒ **KHÔNG xoá**. Đó là chiều đúng, và
 * nó cũng nói thẳng giới hạn: 4 hàng ma còn lại hôm nay đều thuộc loại **(2)**, nên cửa này
 * **không** dọn được chúng — chỉ `readProcTable()` mới dọn được. Cửa này cứu đúng cái **thảm hoạ**:
 * 104/107 hàng của sự cố 2026-08-19 là loại **(1)** (đúng tiêu chí mà chủ dự án đã dùng để dọn tay).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `kill(pid, 0)` "SỚM GIẢ" — BÀI HỌC PHA 3 TASK 1, VÀ VÌ SAO NÓ **KHÔNG** CẤM CÁCH DÙNG NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `llamaVisionSidecar` đo được và ghi thành luật: *"`kill(pid,0)` KHÔNG PHẢI một quan sát cái chết
 * — nó SỚM GIẢ. Đừng dùng nó làm bằng chứng 'đã nhả' ở bất cứ đâu trong Pha 3."* Con số: `ESRCH`
 * về ở **10,9 / 16,6 ms** trong khi handle chỉ báo hiệu ở **514,8 / 559,9 ms** (tiến trình CUDA
 * giữ 7,8 GB tháo dỡ mất ~0,5 s).
 *
 * Luật đó nói về câu hỏi ***"BYTE đã rời card chưa?"***. Ở đây câu hỏi khác hẳn: ***"PID này có
 * còn trong bảng tiến trình không?"*** — và với câu ấy `ESRCH` là câu trả lời TRỰC TIẾP, không
 * phải một suy diễn. Nhưng cửa sổ ~0,5 s vẫn có thật, và xoá một hàng trong cửa sổ đó là **NỚI**
 * dư địa đúng bằng byte của hàng — chiều bị cấm. ⇒ Người gọi **BẮT BUỘC** phải cộng thêm một
 * **hàng rào TUỔI** (`vramAdoption.tuoiToiThieuKenhPhuMs`): chỉ tin cửa này cho hàng đã **đứng im
 * lâu hơn nhiều lần cửa sổ ấy**. Hai thứ cộng lại thì bài học Pha 3 được tôn trọng nguyên vẹn chứ
 * không phải bị lách.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA GIÁ TRỊ, KHÔNG PHẢI `boolean` — cùng kỷ luật `TrangThaiTienTrinh`. Ép về hai là dựng lại đúng
 * lớp lỗi *"`null` bị đọc thành 0"* mà cả module VRAM tồn tại để diệt.
 */
export type SuHienDien = "co" | "vang" | "khong-biet";

/** Cắm đầu dò giả trong test. `null` ⇒ về đầu dò THẬT. */
let dauDoOverride: ((pid: number) => SuHienDien) | null = null;

/** Chỉ dùng trong test. */
export function __setDauDoHienDienForTests(f: ((pid: number) => SuHienDien) | null): void {
  dauDoOverride = f;
}

/**
 * ★★★ VỊ TỪ MỘT PID. **Không sinh tiến trình, không I/O, không ném.**
 *
 * `process.kill(pid, 0)` không gửi tín hiệu nào — nó chỉ hỏi HĐH *"mở được handle tới PID này
 * không?"* (trên Windows là `OpenProcess`). Ba mã lỗi, ba nghĩa KHÁC NHAU:
 *   • `ESRCH` ⇒ PID **KHÔNG TỒN TẠI** ⇒ `"vang"` — đây là bằng chứng (1) của
 *     `process-not-proven-dead`, đúng nguyên văn tiêu chuẩn ấy, chỉ đo bằng một thiết bị khác.
 *   • `EPERM` ⇒ PID **CÓ TỒN TẠI** nhưng ta không đủ quyền ⇒ `"co"`. ⚠ Đọc nó thành `"vang"` là
 *     lỗi fail-open kinh điển: một tiến trình chạy dưới tài khoản khác sẽ bị tuyên bố đã chết.
 *   • còn lại ⇒ `"khong-biet"` — không bịa.
 *
 * ⚠⚠ `pid <= 0` bị CHẶN THẲNG và đây là một điều kiện AN TOÀN, không phải một phép vệ sinh đầu
 * vào: trên POSIX `process.kill(0, sig)` gửi cho **CẢ NHÓM TIẾN TRÌNH**, và `-1` gửi cho **MỌI
 * tiến trình mà ta có quyền**. Tín hiệu `0` hôm nay không giết ai, nhưng một lượt sửa sau đổi
 * `0` thành `"SIGTERM"` sẽ biến hàm này thành một quả bom. `pid` đến từ chuỗi `processKey` do một
 * tiến trình KHÁC ghi vào CSDL — tức **đầu vào không tin được**.
 */
export function hienDienCuaPid(pid: number): SuHienDien {
  if (dauDoOverride !== null) return dauDoOverride(pid);
  if (!Number.isInteger(pid) || pid <= 0) return "khong-biet";
  try {
    process.kill(pid, 0);
    return "co";
  } catch (err) {
    const ma = (err as NodeJS.ErrnoException)?.code;
    if (ma === "ESRCH") return "vang";
    if (ma === "EPERM") return "co";
    return "khong-biet";
  }
}

/**
 * Quét một tập PID, trả về **đúng những PID CHỨNG MINH ĐƯỢC LÀ VẮNG MẶT**.
 *
 * ⚠ Tập trả về là một lời khẳng định DƯƠNG (*"những cái này chắc chắn không còn"*), KHÔNG phải
 * phần bù của "còn sống". PID `"khong-biet"` **không** có mặt ở đây, và người gọi vì thế không có
 * đường nào hiểu nhầm im lặng thành bằng chứng.
 * ⚠ Bỏ qua PID của CHÍNH tiến trình này: hàng của ta do sổ CỤC BỘ làm chủ (`lapKeHoachNhanNuoi`
 * đã loại `selfKey` từ trước), và tự hỏi mình còn sống không là một câu hỏi vô nghĩa.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ DƯỚI VITEST, KHÔNG CÓ ĐẦU DÒ CẮM TAY ⇒ **TẬP RỖNG**. ĐÂY LÀ MỘT HÀNG RÀO ĐO ĐƯỢC.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không có dòng này, kết quả của bộ test **phụ thuộc vào không gian PID của máy đang chạy**: ca
 * `D-7` của `adoption.test.ts` dựng một hàng của `api:900:1000`, và pid 900 **tình cờ không tồn
 * tại** trên máy này ⇒ `ESRCH` ⇒ hàng bị dọn ⇒ ca ĐỎ. Trên một máy mà pid 900 có thật thì cùng ca
 * ấy XANH. Một lưới đổi màu theo máy là một lưới **không phát biểu được điều gì** — và nó sẽ đổi
 * màu vào đúng lúc không ai ngờ.
 *
 * ⚠ Đây đúng khuôn đã có trong repo, không phải một ngoại lệ mới: `vramGpuHolders.readProcTable()`
 * tắt theo `VRAM_GPU_HOLDER_SCAN` mà `vitest.setup.ts` đặt `off`, và
 * `vramSharedLedgerStore.layGateway()` trả `null` thẳng khi `process.env.VITEST`.
 * ⚠ Hàng rào này **KHÔNG** biến cơ chế thành mã chết: `hienDienCuaPid()` vẫn chạy đường THẬT trong
 * test (ca `P-1`…`P-3` đo đúng nó), và ca nào cần cả chuỗi thì **cắm đầu dò tường minh** qua
 * `__setDauDoHienDienForTests()` — lúc đó nhánh này nhường đường.
 */
export function quetPidVangMat(pids: Iterable<number>): ReadonlySet<number> {
  const vang = new Set<number>();
  if (dauDoOverride === null && process.env.VITEST) return vang;
  for (const pid of new Set(pids)) {
    if (pid === process.pid) continue;
    if (hienDienCuaPid(pid) === "vang") vang.add(pid);
  }
  return vang;
}
