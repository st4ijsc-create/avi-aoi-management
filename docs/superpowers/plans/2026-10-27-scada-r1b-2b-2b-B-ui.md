# SCADA R1b-2b-2b · Phần B (scada-ui) — Giao diện và mục rủi ro thấp — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm phần GIAO DIỆN của R1b-2b-2b, trên hợp đồng máy chủ do scada-master giữ:
- không chờ ai: i18n `TRPC_GIOI_HAN_THU_TUC` (40), DOM test I-2 cho mọi hộp `SCADA_AI_LEVEL_TOO_HIGH` (30), quyền của ngăn tag M10 (39), tìm kiếm bảng kênh + ca biên ô chọn adapter M12 (3a), màn admin mở khoá TOTP (38);
- chờ hợp đồng Phần A: cảnh báo nguồn cho tag ứng viên (3b ⇐ C3), chip "Truyền thông n/m" + hiển thị endpoint / lỗi bị che (4, 6 ⇐ C2), nhật ký `/scada/journal` + nhãn "sim" (1, 10 ⇐ C1), Lab "thử đọc một địa chỉ" (5 ⇐ C4), "Điều kiện cho phép" (2 ⇐ C5);
- chờ R1b-2b-2a Task 9: hiển thị posture `theoBuoc` + i18n tên bước + làm tươi posture (54).

**Architecture:**
- **Chỉ client.** Mọi task sửa `client/src/**` + locales + test client. Không task nào sửa máy chủ; dữ liệu đến từ thủ tục CÓ SẴN (đường, hình, quyền ghi ở từng task) hoặc từ thủ tục HỢP ĐỒNG của Phần A (`docs/superpowers/plans/2026-10-27-scada-r1b-2b-2b-A.md`, task C1–C5).
- **Quyền ở client chỉ là tiện lợi** (ẩn nút / không gọi query); ranh giới bảo mật là máy chủ. Không bao giờ suy phạm vi ở client.
- **Câu hiển thị luôn qua i18n** (vi / en / zh); lỗi máy chủ qua `mapTrpcError` (`client/src/lib/trpcErrors.ts:207`).

**Tech Stack:** React 19, tRPC 11 client (`@/lib/trpc`), react-i18next, vitest + jsdom (`*.dom.test.tsx`, `// @vitest-environment jsdom`), Testing Library.

**Spec:**
1. Kế hoạch R1b-2b-2b Phần A `docs/superpowers/plans/2026-10-27-scada-r1b-2b-2b-A.md` — hợp đồng C1–C5 (tên thủ tục, zod vào / ra, quyền, phạm vi) là RÀNG BUỘC.
2. Thiết kế đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html` (:428 chip "Truyền thông n/m — bấm mở M10"; bảng màu trạng thái :582).
3. Báo cáo nghiệm thu R1b-2a `docs/superpowers/plans/2026-10-25-scada-r1b-2a-bao-cao-nghiem-thu.md` §11 mục 1, 2, 3, 4, 5, 10, 30, 38, 39, 40, 54.

**Phụ thuộc và chờ hợp đồng:**

| Task | Chờ | Dấu hiệu sẵn sàng |
|---|---|---|
| B-T1, B-T2, B-T4, B-T5, B-T10 | không | bắt đầu ngay |
| B-T3 | R1b-2b-2a Task 9 trên main (`EngineeringHub.tsx`, locales posture) | điều phối báo commit 2a T9 đã lên main |
| B-T6 | Phần A **C3** | điều phối báo commit C3 trên main |
| B-T7 | Phần A **C2** | commit C2 trên main |
| B-T8 | Phần A **C1** | commit C1 trên main |
| B-T9 | Phần A **C4** | commit C4 trên main |
| B-T11 | Phần A **C5** (chạy sau R1b-2b-2a) | commit C5 trên main |

Trước task chờ hợp đồng: gộp main vào nhánh (`git merge <main>`, không rebase), chạy lại test client của các task đã xong + client census; xung đột trong tệp CẤM ⇒ dừng, báo scada-master.

---

## Global Constraints

- **Nơi làm và nhánh.** Worktree `D:\SOURCES\_scada_ui_wt`, nhánh `feat/scada-r1b2b2-ui` (tạo từ main `2f0a99fc0`). Không sửa cây chính, worktree khác, nhánh khác. **Không push. Không gộp vào main** (điều phối gộp).
- **Commit.** Pathspec: `git add <tệp…>` rồi `git commit -m "…" -- <tệp…>` (hook BG-124 chặn commit trần). Cuối message một dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không heredoc, không `node -e` có backtick.
- **Không `.env`, không DB, không docker, không :3000 / :8091 / GPU.** Không chạy máy chủ. Không cờ / biến môi trường mới.
- **scada-ui ĐƯỢC sửa:** `client/src/pages/ScadaDiag.tsx`, `client/src/pages/ScadaKenh.tsx`, trang mới `client/src/pages/ScadaNhatKy.tsx`, `client/src/components/scada/**` TRỪ các tệp cấm bên dưới, `client/src/pages/EngineeringHub.tsx` (chỉ B-T3), `client/src/pages/Users.tsx` (chỉ B-T10), `client/src/lib/trpcErrors.ts` (chỉ B-T1), `client/src/lib/navigation.tsx` + `client/src/App.tsx` (chỉ route / mục `/scada/journal`, B-T8), `client/src/i18n/locales/{vi,en,zh}.json` (khoá `scada.*`, `oversight.posture.buoc.*`, `users.totp.*`, `errors.TRPC_GIOI_HAN_THU_TUC`), test client mới / sửa của chính các tệp ấy, và test DOM của 6 bề mặt AI ở B-T2 (chỉ test; sửa thành phần AI CHỈ khi test lộ lỗi — xem B-T2).
- **scada-ui KHÔNG ĐƯỢC sửa (cấm tuyệt đối):**
  - mọi tệp `server/**`, `shared/**`, `drizzle/**`, `scripts/**` (thủ tục mới / đổi là việc của Phần A — task hợp đồng);
  - cụ thể (nhắc lại cho rõ): dispatch `server/services/ot/commandDispatcher*`, mọi driver `server/services/ot/drivers/**`, `server/services/ot/otDeviceWrite*`, `server/services/scada/lenhHmi*`, `server/services/scada/troLaiKenh*`, `server/_core/rateLimitConfig*`, `server/_core/context.ts`, `server/_core/trpc.ts`, `server/_core/moduleGate*`, router / service interlock (`server/routers/interlock*`, `server/services/interlock/**`), `server/services/ot/stopPin*`, mọi tệp ghim census phạm vi / quyền (`server/routers/phamViDocCensus.test.ts`, `phamViGhiCensus.test.ts`, `phamViTuyenCensus.test.ts`, `congGiayPhepAiCensus.test.ts`, `server/_core/trpcGioiHanThuTuc.census.test.ts`, mọi `server/**/*census*`);
  - client STOP / lệnh: `client/src/components/scada/DungMay.tsx`, `KhoiDungKhanCap.tsx`, `HopThoaiLenh.tsx`, `HopMaTotpTroLai.tsx`, `client/src/components/CongDoiMatKhau.tsx`, `client/src/components/scada/ketQuaLenh.ts` (đọc được, không sửa);
  - `client/src/pages/DeviceAdapterManagement.tsx` (49b là của scada-master) và mọi trang / thành phần interlock (`client/src/pages/InterlockRuleManagement.tsx`, …);
  - các ghim census client (`client/src/lib/rawErrorMessageCensus.unit.test.ts`, `client/src/lib/navLicenseFieldsCensus.unit.test.ts`): được CHẠY, không sửa ghim; cần đổi ghim ⇒ dừng, hỏi scada-master.
  - Cần một thay đổi máy chủ / tệp cấm mà kế hoạch không có ⇒ DỪNG, ghi vào báo cáo task, báo scada-master (qua điều phối). Không "sửa tạm".
- **Test.**
  - DOM: `*.dom.test.tsx`, docblock `// @vitest-environment jsdom`, mock `@/lib/trpc` theo khuôn `client/src/pages/ScadaDiag.dom.test.tsx:68` (ghi `{proc, vars}` mỗi lượt gọi), bundle i18n THẬT (`vi.json`; ca đa ngôn ngữ đổi sang en / zh thật — khuôn `ScadaDiag.dom.test.tsx:235`). Không mock i18n.
  - Mỗi câu hiển thị mới có khoá ở cả vi / en / zh, placeholder khớp; `npm run i18n:check` sạch sau mỗi task.
  - Client census xanh sau mỗi task: `npx vitest run client/src/lib/navLicenseFieldsCensus.unit.test.ts client/src/lib/rawErrorMessageCensus.unit.test.ts client/src/i18n` + mọi `client/src/**/*census*`.
  - `npx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`) không lỗi mới trước khi bàn giao task.
  - **Luật điều phối:** trong task chỉ chạy test của task + client census + thư mục liên quan nêu ở bước "Chạy lại". KHÔNG chạy `luoi-truoc-gop`, KHÔNG chạy cây unit đầy đủ. Toàn bộ chỉ ở B-T12, sau khi điều phối nói "OK chạy ngay".
- **Mỗi task.** Test đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task làm đỏ ≥ 1 test** (chạy, ghi tệp:dòng + kết quả vào báo cáo, hoàn tác, `git diff` rỗng) → commit → bàn giao (giao thức dưới).
- **Màu / thành phần.** Chỉ token sẵn có (ISA / `--packml-*`, thành phần `@/components/patterns`, `@/components/ui/*`). Không thêm thư viện.

## Giao thức bàn giao và rà soát (ràng buộc)

1. **Sau mỗi task**, scada-ui viết `.superpowers/sdd/2026-10-27-scada-r1b-2b-2b-B/task-<N>-report.md` (trong worktree của mình): commit (hash), tệp đổi, lệnh test đã chạy + số pass / fail, đột biến (tệp:dòng, test đỏ), i18n:check, client census, tsc, lệch khỏi kế hoạch (nếu có) và lý do, câu hỏi mở. Cập nhật `progress.md` cùng thư mục một dòng.
2. **Báo scada-master** (qua điều phối): "B-T<N> sẵn sàng rà soát — <hash>". Không bắt đầu task phụ thuộc cùng tệp trước khi có kết quả rà soát.
3. **scada-master rà soát kỹ thuật** (đúng hợp đồng, đúng quyền, i18n, test thật sự phân biệt): `ĐẠT` / `CẦN SỬA (danh sách)`. Cần sửa ⇒ scada-ui sửa trên cùng nhánh, commit mới (không amend), báo lại.
4. **kiem-dinh rà soát ĐỘC LẬP** sau khi scada-master ĐẠT (theo lô do điều phối chọn); kiem-dinh có thể chạy đột biến riêng. Phát hiện ⇒ như bước 3.
5. **Task đóng** chỉ khi cả hai ĐẠT. Điều phối gộp nhánh vào main. scada-ui không gộp, không push.
6. Phát hiện lỗi máy chủ / hợp đồng sai trong lúc làm ⇒ dừng task, báo scada-master kèm tái hiện (ca test đỏ) — scada-master sửa ở Phần A.

## Review Focus

1. **Người giám sát (không phải kỹ sư) mở M10 sau C2** ⇒ endpoint / lỗi là `null` từ máy chủ ⇒ ô hiện "—" với `title` rỗng, không lỗi render, không chữ "null" / "undefined". Test ở B-T7.
2. **Nhật ký có hàng của adapter stub và hàng lần thử bị từ chối có `lyDo`** ⇒ nhãn "sim" chỉ ở hàng `laStub`, lần thử hiện mã từ chối đã dịch + lý do, phân trang không trùng / không sót khi bấm "Tải thêm". Test ở B-T8.
3. **Lỗi 429 của bộ giới hạn thủ tục (`TRPC_GIOI_HAN_THU_TUC`) ở một form không phải SCADA** ⇒ câu đã dịch "… thử lại sau 30 giây" ở vi / en / zh, không phải câu tiếng Việt thô của máy chủ. Test ở B-T1.
4. **Người có `machine_monitoring.canView` mà không có `machine_control.canView` mở ngăn tag M10** ⇒ không gọi `scadaKenh.danhSach` (không lỗi FORBIDDEN đỏ), hiện một dòng "không có quyền xem kênh". Test ở B-T4.
5. **Kỹ sư Lab gửi đọc địa chỉ thiếu lý do / bị trần / adapter edge** ⇒ nút gửi khoá khi lý do < 5 ký tự; lỗi `rateLimited` / `adapterOwnedByEdge` / `adapterNotRunning` hiện câu đã dịch; không có ô / nút nào gửi GHI. Test ở B-T9.

---

### B-T1: i18n `TRPC_GIOI_HAN_THU_TUC` (mục 40)

**Hợp đồng máy chủ (CÓ SẴN, không đổi):** middleware `server/_core/trpcGioiHanThuTuc.ts:246-253` ném TRPCError 429 với `data = { code: "TOO_MANY_REQUESTS", httpStatus: 429, appCode: "TRPC_GIOI_HAN_THU_TUC", nhom: "2fa" | "auth", retryAfterGiay: number }` — tham số ở MỨC TRÊN của `data`, KHÔNG trong `appParams`; mã này KHÔNG có trong `server/_core/appErrorCodes.ts`. Áp cho mọi thủ tục thuộc nhóm (`NHOM_THU_TUC_NHAY_CAM`, `:40-92`).

**Files:** Modify `client/src/lib/trpcErrors.ts` `getAppError` `:129-140`; locales (`errors.TRPC_GIOI_HAN_THU_TUC`). Test: `client/src/lib/trpcErrors.gioiHanThuTuc.unit.test.ts` (mới).

**Interfaces:** `getAppError` (nội bộ) — khi `data.appCode === "TRPC_GIOI_HAN_THU_TUC"` và `appParams` vắng ⇒ `appParams = { retryAfterGiay: <số nguyên ≥ 1 từ data.retryAfterGiay, mặc định 60> }`. Khoá: vi "Quá nhiều lần thử thao tác nhạy cảm — thử lại sau {{retryAfterGiay}} giây.", en / zh dịch, cùng placeholder. `ketQuaLenh.ts:199-206` (nhận diện 429 cho SCADA) KHÔNG đổi.

- [ ] **Step 1: Test đỏ.**

```ts
// trpcErrors.gioiHanThuTuc.unit.test.ts
const loi = { message: "Quá nhiều lần thử thao tác nhạy cảm (2fa). Thử lại sau 30 giây.", data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, appCode: "TRPC_GIOI_HAN_THU_TUC", nhom: "2fa", retryAfterGiay: 30 } };
it("vi: câu đã dịch có 30 giây (Review Focus 3)", async () => {
  await i18n.changeLanguage("vi");
  expect(mapTrpcError(loi)).toBe("Quá nhiều lần thử thao tác nhạy cảm — thử lại sau 30 giây.");
});
it("en / zh: không còn câu tiếng Việt của máy chủ, có số 30", async () => {
  for (const lng of ["en", "zh"]) {
    await i18n.changeLanguage(lng);
    const s = mapTrpcError(loi);
    expect(s).toContain("30");
    expect(s).not.toMatch(/Quá nhiều|giây/);
  }
});
it("retryAfterGiay vắng / không phải số ⇒ 60", () => { /* … */ });
```

- [ ] **Step 2–4:** đỏ → cài → chạy lại `client/src/lib/trpcErrors*` + `client/src/lib/errorCodes*` + `client/src/components/scada/ketQuaLenh.unit.test.ts` + client census + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ nhánh nâng `retryAfterGiay` ⇒ ca vi đỏ (placeholder trống). Hoàn tác.
- [ ] **Step 6: Commit** `fix(ui): dich loi TRPC_GIOI_HAN_THU_TUC (429 gioi han thu tuc) vi/en/zh voi so giay thu lai (R1b-2b-2b B T1, muc 40)`.

### B-T2: DOM test I-2 cho MỌI hộp `SCADA_AI_LEVEL_TOO_HIGH` (mục 30)

**Hợp đồng máy chủ (CÓ SẴN):** `aiCopilot.confirmAction` từ chối vĩnh viễn lệnh AI mức ≥ 4 bằng `FORBIDDEN`, `appCode "SCADA_AI_LEVEL_TOO_HIGH"`, `appParams { ma, level }` (`server/_core/appErrorCodes.ts:190`). Client: `client/src/lib/loiXacNhanAi.ts` (`laTuChoiAiMucCao`, `tuChoiTuLoiXacNhan` ⇒ `{ state: "denied", message }`).

**Files (chỉ test, trừ khi test lộ lỗi):** mới, một tệp mỗi bề mặt: `client/src/components/AIActionInbox.mucQuaCao.dom.test.tsx`, `client/src/components/AILocalChatBubble.mucQuaCao.dom.test.tsx`, `client/src/pages/AIChatPage.mucQuaCao.dom.test.tsx`, `client/src/pages/ApprovalsInbox.mucQuaCao.dom.test.tsx`, `client/src/pages/ExecutiveMobile.mucQuaCao.dom.test.tsx` (khuôn `client/src/components/AIGuidedActionCards.mucQuaCao.dom.test.tsx`, bề mặt thứ 6 đã có).

Chốt (mỗi bề mặt, cùng ba khẳng định): confirm trả lỗi `SCADA_AI_LEVEL_TOO_HIGH` `{level: 4}` ⇒ (1) thẻ / hàng chuyển `denied`, nút Xác nhận KHÔNG còn bấm được; (2) câu `errors.SCADA_AI_LEVEL_TOO_HIGH` (vi thật, có "mức tác động 4") hiện ĐÚNG một lần; (3) bấm lại (nếu còn phần tử) ⇒ `confirmAction` không được gọi lần hai. Bề mặt nào không đạt ⇒ sửa tối thiểu trong CHÍNH thành phần đó bằng `tuChoiTuLoiXacNhan` (không đổi `loiXacNhanAi.ts`), ghi rõ trong báo cáo — đây là ngoại lệ được phép duy nhất ngoài SCADA.

- [ ] **Step 1: Viết 5 tệp test.** **Step 2: Chạy** — ghi bề mặt nào xanh ngay (lưới hồi quy), bề mặt nào đỏ (lỗi thật).
- [ ] **Step 3:** sửa bề mặt đỏ (nếu có). **Step 4: Chạy lại** 6 tệp `*.mucQuaCao.dom.test.tsx` + `client/src/lib/loiXacNhanAi.unit.test.ts` + client census. Xanh.
- [ ] **Step 5: Đột biến:** ở từng bề mặt, bỏ nhánh `tuChoiTuLoiXacNhan` trong `catch` ⇒ ca của bề mặt ấy đỏ (6 đột biến, ghi kết quả từng cái). Hoàn tác.
- [ ] **Step 6: Commit** `test(ui): DOM test I-2 cho moi hop SCADA_AI_LEVEL_TOO_HIGH (5 be mat con lai) - denied, cau dich mot lan, khong goi lai (R1b-2b-2b B T2, muc 30)`.

### B-T3: Posture — hiện `theoBuoc`, i18n tên bước, làm tươi posture (mục 54) — SAU 2a Task 9

**Hợp đồng máy chủ (CÓ SẴN):** `oversight.posture` (`server/routers/oversightRouter.ts:742-786`, `machine_monitoring.canView`, lọc phạm vi nhà máy R1b-2a T12) ⇒ `stopQuaHan24h: { count: number; theoBuoc: Record<string, number>; khongGhiSo: { count: number; theoBuoc: Record<string, number>; batDauLuc: string } | null; degraded: boolean }` (`:566-618`). Khoá `theoBuoc` là tập ĐÓNG: `db | het_han_tong_truoc_handler | pham_vi | doc_may | vai_tro | doc_adapter | doc_ghim | dong_cho | adapter` (`server/services/scada/lenhHmi.ts:1493-1503`); khoá `khongGhiSo.theoBuoc`: `xac_thuc | cong_doi_mat_khau | giay_phep | pham_vi_tenant | db | ghi_so_loi` (`server/_core/hanStopHmi.ts` `BuocKhongGhiSo`). Sau 2a T9 posture có thêm `nganSachPoolStop` (2a hiển thị nó — B-T3 KHÔNG đụng dòng đó).

**Files:** Modify `client/src/pages/EngineeringHub.tsx` (`usePosture` `:306`; khối `stopQuaHan` `:348-350`); locales `oversight.posture.buoc.<khoá>` (15 khoá trên). Test: `client/src/pages/EngineeringHub.dom.test.tsx`.

Chốt:
- Dưới dòng "STOP HMI bị từ chối vì quá hạn (24 h): N" (khi `N > 0`): danh sách `buoc: số` sắp theo số giảm dần, nhãn `t("oversight.posture.buoc.<khoá>")`; khoá lạ (không trong 15 khoá) ⇒ nhãn chung `oversight.posture.buoc.khac` + khoá thô trong `title`. `khongGhiSo` có ⇒ một dòng "Không ghi được sổ (từ <batDauLuc>): M" + danh sách như trên.
- Làm tươi: `staleTime` 30 000 → 10 000 và `refetchOnWindowFocus: true` (mục 54 "đổi phạm vi người dùng ⇒ số cũ tới 30 s"; client không biết phạm vi đổi — chọn rút cửa sổ thay vì đoán).
- `degraded` ⇒ giữ câu degraded hiện có, không danh sách.

- [ ] **Step 1: Test đỏ (DOM, bundle vi thật):** posture `{count: 5, theoBuoc: {doc_ghim: 3, db: 2}}` ⇒ thấy nhãn vi của `doc_ghim` trước `db`, số 3 / 2; khoá `"zzz"` ⇒ nhãn "khác"; `khongGhiSo {count:1, theoBuoc:{giay_phep:1}}` ⇒ dòng không ghi sổ; en / zh: nhãn đổi ngôn ngữ; `useQuery` nhận `staleTime: 10000`, `refetchOnWindowFocus: true` (mock ghi tuỳ chọn).
- [ ] **Step 2–4:** đỏ → cài + i18n → chạy lại `client/src/pages/EngineeringHub*` + client census + `npm run i18n:check`. Xanh.
- [ ] **Step 5: Đột biến:** sắp tăng dần ⇒ ca thứ tự đỏ; bỏ nhánh khoá lạ ⇒ ca "zzz" đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ui): posture hien theoBuoc STOP qua han + khong ghi so, i18n ten buoc, lam tuoi 10 s (R1b-2b-2b B T3, muc 54)`.

### B-T4: Ngăn tag M10 không gọi kênh khi thiếu `machine_control.canView` (mục 39)

**Hợp đồng máy chủ (CÓ SẴN):** `scadaKenh.danhSach({ adapterId })` đòi `machine_control.canView` (`server/routers/scadaKenhRouter.ts:417-419`); trang M10 chỉ đòi `machine_monitoring.canView` (`scadaDiag.danhSach`, `scadaDiagRouter.ts:199`; nav `client/src/lib/navigation.tsx:919-926`).

**Files:** Modify `client/src/components/scada/NganTagAdapter.tsx:239-240` (`usePermissions` như `ScadaDiag.tsx:18,44`); locales `scada.diag.khongQuyenKenh`. Test: `client/src/components/scada/NganTagAdapter.quyenKenh.dom.test.tsx` (mới).

Chốt: `enabled: coBang && hasPermission("machine_control","canView")`; thiếu quyền ⇒ cột / khối kênh thay bằng dòng `scada.diag.khongQuyenKenh` ("Không có quyền xem cấu hình kênh — giá trị và chất lượng vẫn hiện."); bảng giá trị (`scadaDiag.tagCuaAdapter`) không đổi.

- [ ] **Step 1–6:** test đỏ (người không canView ⇒ 0 lượt `scadaKenh.danhSach`, thấy dòng; có quyền ⇒ 1 lượt) → cài → chạy lại `client/src/components/scada/NganTagAdapter*` + `client/src/pages/ScadaDiag*` + census + i18n → đột biến (bỏ điều kiện quyền ⇒ ca 0 lượt đỏ) → commit `fix(ui): ngan tag M10 khong goi scadaKenh.danhSach khi thieu machine_control.canView (R1b-2b-2b B T4, muc 39)`.

### B-T5: M12 — tìm kiếm bảng kênh + ca biên ô chọn adapter (mục 3, phần không chờ)

**Hợp đồng máy chủ (CÓ SẴN):** `scadaKenh.danhSach({ adapterId })` (output `scadaKenhRouter.ts:433-456`: `tagKey`, `displayName`, `dataType`, `loaiKenh`, …); `scadaKenh.cheDo.danhSach` (máy + `kenh` + `kenhAn`); `scadaDiag.danhSach` (adapter trong phạm vi). Không đổi.

**Files:** Modify `client/src/components/scada/BangKenh.tsx` (ô tìm), `client/src/components/scada/KenhCheDoMay.tsx:60-66` (khởi tạo ô chọn), `client/src/pages/ScadaKenh.tsx` (ô chọn adapter của trang); locales `scada.kenh.timKiem.*`. Test: `client/src/components/scada/BangKenh.timKiem.dom.test.tsx` (mới), `client/src/pages/ScadaKenh.dom.test.tsx`.

**Interfaces:** `export function khopTimKiem(hang: { tagKey: string; displayName: string | null }, q: string): boolean` (`client/src/components/scada/kenhHienThi.ts`) — so không phân biệt hoa thường VÀ dấu tiếng Việt (`normalize("NFD")` bỏ dấu, `đ` → `d`), khớp chuỗi con trên `tagKey` hoặc `displayName`; `q` rỗng / chỉ khoảng trắng ⇒ true.

Chốt:
- Ô tìm lọc tại client; số "Hiện n / m"; không kết quả ⇒ `EmptyState` với câu `scada.kenh.timKiem.khongCo`. Giữ chuỗi tìm khi đổi adapter? — KHÔNG (xoá khi đổi adapter).
- Ô chọn adapter trong hộp đặt kênh chế độ: (a) danh sách tới SAU lần render đầu ⇒ chọn adapter của kênh hiện có nếu nằm trong danh sách, ngược lại phần tử đầu (không kẹt `null`); (b) kênh hiện có thuộc adapter KHÔNG có trong danh sách (`kenhAn`) ⇒ không chọn sẵn, hiện placeholder `scada.kenh.dialog.chonAdapter`; (c) danh sách rỗng ⇒ ô khoá + câu `scada.kenh.dialog.khongAdapter`, nút Lưu khoá.

- [ ] **Step 1: Test đỏ.**

```ts
it("khopTimKiem: không dấu, không hoa thường, tagKey hoặc displayName", () => {
  expect(khopTimKiem({ tagKey: "spd_set", displayName: "Tốc độ đặt" }, "toc do")).toBe(true);
  expect(khopTimKiem({ tagKey: "SPD_SET", displayName: null }, "spd")).toBe(true);
  expect(khopTimKiem({ tagKey: "x", displayName: "Đầu đọc" }, "dau")).toBe(true);
  expect(khopTimKiem({ tagKey: "x", displayName: null }, "  ")).toBe(true);
  expect(khopTimKiem({ tagKey: "x", displayName: null }, "y")).toBe(false);
});
```

  - DOM: 30 tag, gõ "toc" ⇒ 2 hàng + "Hiện 2 / 30"; hộp kênh chế độ: danh sách adapter tới sau 1 nhịp ⇒ ô chọn = adapter kênh hiện có; `kenhAn` ⇒ placeholder; rỗng ⇒ Lưu khoá.
- [ ] **Step 2–4:** đỏ → cài → chạy lại `client/src/components/scada` + `client/src/pages/ScadaKenh*` + census + i18n. Xanh.
- [ ] **Step 5: Đột biến:** `khopTimKiem` bỏ khử dấu ⇒ ca "toc do" đỏ; khởi tạo ô chọn quay về `useState(... ?? null)` một lần ⇒ ca "tới sau 1 nhịp" đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ui): M12 tim kiem bang kenh (khong dau, khong hoa thuong) + ca bien o chon adapter cua hop kenh che do (R1b-2b-2b B T5, muc 3)`.

### B-T6: M12 — cảnh báo nguồn cho tag ỨNG VIÊN trước khi lưu (mục 3, phần chờ) — CHỜ C3

**Hợp đồng máy chủ (Phần A C3):** `scadaKenh.danhSach({ adapterId })` — mỗi tag thêm `canhBaoNguon: "deadband" | "edge" | "bao_khi_doi" | "poll_cham" | null` (cùng luật máy chủ `canhBaoCua`). Quyền / phạm vi / NOT_FOUND không đổi.

**Files:** Modify `client/src/components/scada/KenhCheDoMay.tsx:85-87` (nguồn cảnh báo khi chọn tag), `:143-145` (khối cảnh báo trong hộp). Test: `client/src/components/scada/KenhCheDoMay.ungVien.dom.test.tsx` (mới).

Chốt: `canhBao = tagDangChon?.canhBaoNguon ?? (trungKenhHienCo ? may.canhBaoNguon : null)` — tag ứng viên dùng cảnh báo của CHÍNH nó; vẫn dùng `CanhBaoNguonKenh` + khoá `scada.kenh.canhBaoNguonLoai.*` có sẵn (không khoá mới). Cảnh báo không khoá nút Lưu (chỉ cảnh báo, như hôm nay).

- [ ] **Step 1–6:** test đỏ (chọn tag ứng viên `canhBaoNguon:"deadband"` ⇒ khối cảnh báo deadband hiện TRƯỚC khi bấm Lưu; tag `null` ⇒ không; tag của adapter edge ⇒ "edge") → cài → chạy lại `client/src/components/scada/KenhCheDoMay*` + `client/src/pages/ScadaKenh*` + census → đột biến (dùng lại `may.canhBaoNguon` cho mọi tag ⇒ ca ứng viên đỏ) → commit `feat(ui): M12 canh bao nguon cho tag ung vien truoc khi luu kenh che do (dung canhBaoNguon tung tag cua may chu) (R1b-2b-2b B T6, muc 3)`.

### B-T7: Chip "Truyền thông n/m" + hiển thị endpoint / lỗi bị che (mục 4, 6) — CHỜ C2

**Hợp đồng máy chủ (Phần A C2):**
- `scadaDiag.tomTatTruyenThong` — query, không input, `machine_monitoring.canView` + giấy phép `MOD_OT_CONTROL`, phạm vi nhà máy ⇒ `{ ketNoi, dangNoi, mat, khac, tong, edge, tinhLuc }` (adapter bật trong phạm vi; edge đếm riêng).
- `scadaDiag.danhSach` — `endpoint: string | null`, `loi: string | null` (null với người không phải kỹ sư có `machine_control.canEdit`).

**Files:** Create `client/src/components/scada/ChipTruyenThong.tsx`. Modify `client/src/pages/ScadaDiag.tsx`, `client/src/pages/ScadaKenh.tsx` (đặt chip ở đầu trang — Q-B1), `client/src/components/scada/BangTruyenThong.tsx:187-188, :206-207`, `client/src/components/scada/NganTagAdapter.tsx:256`; locales `scada.truyenThong.chip.*`. Test: `client/src/components/scada/ChipTruyenThong.dom.test.tsx` (mới), `client/src/pages/ScadaDiag.dom.test.tsx`.

**Interfaces:** `export function ChipTruyenThong(): JSX.Element | null` — `trpc.scadaDiag.tomTatTruyenThong.useQuery(undefined, { refetchInterval: 15_000, retry: false })`; đang tải / lỗi ⇒ `null`; `tong === 0 && edge === 0` ⇒ `null`; ngược lại nhãn "Truyền thông {{ketNoi}}/{{tong}}" (+ "· edge {{edge}}" khi > 0); `mat > 0` ⇒ màu trạng thái "mất" (token tím mức 4 của bảng thiết kế :582), `dangNoi > 0` ⇒ màu "đang nối lại", còn lại trung tính; là liên kết tới `/scada/diag`.

Chốt: `endpoint` / `loi` `null` ⇒ "—", `title` rỗng (không "null"); kỹ sư thấy như cũ.

- [ ] **Step 1: Test đỏ (DOM, vi thật):** `{ketNoi:3,dangNoi:0,mat:1,khac:0,tong:4,edge:1}` ⇒ "Truyền thông 3/4 · edge 1", màu "mất", `href="/scada/diag"`; lỗi query ⇒ không render; `tong 0, edge 0` ⇒ không render; M10 với `endpoint:null, loi:null` ⇒ "—" và không chuỗi "null" trong DOM (Review Focus 1); en / zh nhãn đổi.
- [ ] **Step 2–4:** đỏ → cài → chạy lại `client/src/components/scada` + `client/src/pages/ScadaDiag*` + `client/src/pages/ScadaKenh*` + census + i18n. Xanh.
- [ ] **Step 5: Đột biến:** chip lấy `tong` gồm cả edge ⇒ ca "3/4" đỏ; `BangTruyenThong` in `String(h.endpoint)` ⇒ ca "null" đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ui): chip Truyen thong n/m (tomTatTruyenThong, bam mo M10) + hien endpoint/loi bi che la "—" (R1b-2b-2b B T7, muc 4, 6)`.

### B-T8: Nhật ký lệnh `/scada/journal` + nhãn "sim" (mục 1, 10) — CHỜ C1

**Hợp đồng máy chủ (Phần A C1):** `commandLog.nhatKy` — query; giấy phép `MOD_OT_CONTROL` + `machine_control.canView`; input `{ machineId?, adapterId?, nguon: "tat_ca"|"lenh"|"thu" = "tat_ca", trangThai?: status[] (≤ 8), tu?, den?, conTro?: string (≤ 64), gioiHan: 1..200 = 50 }`; output `{ hang: Array<{ nguon, id, at, machineId, adapterId, adapterCode, laStub, tagKey, commandType, trangThai, reasonCode, lyDo, nguoi: {id, ten} | null, triggerKind, giaTri, commandLogIds, requestId, loi }>, conTro: string | null }`; `machineId` / `adapterId` ngoài phạm vi ⇒ NOT_FOUND (`machine` / `adapter`) như không tồn tại; `loi` null với người không phải kỹ sư. Route `/scada/journal` ĐÃ có trong `shared/module-registry.ts` (C1 thêm).
- Danh sách máy cho bộ lọc: `scadaKenh.cheDo.danhSach` (CÓ SẴN, `machine_control.canView`, máy trong phạm vi).

**Files:** Create `client/src/pages/ScadaNhatKy.tsx`, `client/src/pages/ScadaNhatKy.dom.test.tsx`. Modify `client/src/App.tsx` (lazy + `<Route path="/scada/journal">` cạnh `:582-583`, `RouteGuard navHref`), `client/src/lib/navigation.tsx` (mục cạnh `:919-937`: `requiredPermission: "machine_control"`, `permissionCategory: "machine_control"`, `section: "connect"`, `engineerOriented: false`), locales `nav.scadaNhatKy*`, `scada.nhatKy.*`.

Chốt:
- Bộ lọc: máy, nguồn (tất cả / lệnh / lần thử), trạng thái (nhiều), khoảng thời gian; đổi bộ lọc ⇒ về trang đầu. "Tải thêm" gửi `conTro` của trang trước; `conTro: null` ⇒ ẩn nút.
- Cột: thời gian · nguồn · máy / adapter (`adapterCode`) + nhãn **"sim"** khi `laStub` (Badge outline, `scada.nhatKy.sim`, `title` = `scada.nhatKy.simGiaiThich` "Adapter mô phỏng — lệnh không tới thiết bị thật") · tag · trạng thái (dịch: lệnh dùng `scada.lenh.ketQua.*` có sẵn; lần thử `scada.nhatKy.thu.<stage>.<outcome>`) · mã từ chối (dịch qua `errors.*` / `scada.nhatKy.ma.<reasonCode>` — mã lạ ⇒ hiện mã thô) · lý do · người · liên kết lần thử → lệnh (`commandLogIds`).
- `loi` null ⇒ không cột lỗi cho hàng ấy ("—"). NOT_FOUND khi lọc máy (máy bị gỡ khỏi phạm vi giữa chừng) ⇒ câu `mapTrpcError` + xoá bộ lọc máy.
- Trang `CommandAuditLog` cũ KHÔNG đổi.

- [ ] **Step 1: Test đỏ (DOM, vi thật):** trang 1 có 1 hàng stub (`laStub:true`) + 1 hàng thật + 1 lần thử `{trangThai:"dispatch:rejected", reasonCode:"CHUA_GHIM_STOP", lyDo:"x"}` ⇒ đúng một nhãn "sim" trên hàng stub, lần thử hiện câu đã dịch của `CHUA_GHIM_STOP` + "x"; "Tải thêm" ⇒ lượt gọi 2 có `conTro` = `conTro` của trang 1, hàng nối không trùng id (Review Focus 2); `conTro:null` ⇒ không nút; lọc máy ⇒ `vars.machineId`; NOT_FOUND ⇒ câu lỗi + bộ lọc máy bị xoá; mục nav "/scada/journal" có mặt với người `machine_control.canView`.
- [ ] **Step 2–4:** đỏ → cài → chạy lại `client/src/pages/ScadaNhatKy*` + `client/src/lib/navLicenseFieldsCensus.unit.test.ts` + `client/src/lib/navigation*` + census + i18n. Xanh.
- [ ] **Step 5: Đột biến:** nhãn "sim" theo `trangThai === "simulated"` thay vì `laStub` ⇒ ca stub đỏ; "Tải thêm" không gửi `conTro` ⇒ ca trùng id đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ui): nhat ky lenh /scada/journal (commandLog.nhatKy - lenh + lan thu, loc, tai them theo con tro) + nhan "sim" cho adapter stub (R1b-2b-2b B T8, muc 1, 10)`.

### B-T9: Lab "thử đọc một địa chỉ" (mục 5) — CHỜ C4

**Hợp đồng máy chủ (Phần A C4):** `scadaDiag.thuDocDiaChi` — mutation; admin / engineer + 2FA + giấy phép `MOD_OT_CONTROL` + `machine_control.canEdit` (quyết định cuối ở Phần A Q1); input `{ adapterId, address: 1..128 ký tự, dataType: "bool"|"int"|"float"|"string", lyDo: 5..300 }`; output `{ quality, raw, giaTri, statusCode, reason, ms }`; adapter ngoài phạm vi ⇒ NOT_FOUND `adapter`; lỗi có mã `OPERATION_FAILED {operation:"scadaLabRead", reason: "adapterOwnedByEdge" | "adapterNotRunning" | "protocolNotSupported" | "rateLimited" | "labDisabled"}` (câu dịch do Phần A thêm ở `errors.*`). Audit ghi ở máy chủ.

**Files:** Create `client/src/components/scada/KhoiThuDocDiaChi.tsx`, `client/src/components/scada/KhoiThuDocDiaChi.dom.test.tsx`. Modify `client/src/components/scada/NganTagAdapter.tsx` (đặt khối, chỉ khi `canAct` — cùng điều kiện `ScadaDiag.tsx:47`); locales `scada.lab.thuDoc.*`.

Chốt: các ô địa chỉ, kiểu (ô chọn 4 giá trị), lý do (`TruongLyDo` có sẵn, ≥ 5 ký tự); nút "Đọc" khoá khi thiếu / đang gửi; kết quả: chất lượng (dùng `chatLuongHienThi.ts` có sẵn), giá trị thô, giá trị giải mã, mã trạng thái, ms; câu cố định "Chỉ đọc — không ghi xuống thiết bị." (`scada.lab.thuDoc.chiDoc`). Không có nút ghi / sửa nào trong khối.

- [ ] **Step 1–6:** test đỏ (lý do 4 ký tự ⇒ nút khoá; gửi ⇒ đúng một `{proc:"thuDocDiaChi", vars:{adapterId, address:"40001", dataType:"int", lyDo}}`; kết quả `good` hiện giá trị + ms; ba lỗi có mã ⇒ câu dịch; khối không có khi `canAct` false; DOM không có phần tử nào chứa "Ghi"/"Write" trong khối — Review Focus 5) → cài → chạy lại `client/src/components/scada` + `client/src/pages/ScadaDiag*` + census + i18n → đột biến (bỏ khoá theo độ dài lý do ⇒ ca 4 ký tự đỏ) → commit `feat(ui): Lab thu doc mot dia chi o ngan tag M10 (scadaDiag.thuDocDiaChi, chi doc, ly do bat buoc) (R1b-2b-2b B T9, muc 5)`.

### B-T10: Màn admin mở khoá TOTP (mục 38 — CHUYỂN từ danh sách 2b, xem Q-B2)

**Lý do chuyển:** thủ tục máy chủ ĐÃ có đủ; phần còn thiếu chỉ là giao diện admin; rủi ro thấp (admin, có lý do, có audit, máy chủ cấm tự mở khoá).

**Hợp đồng máy chủ (CÓ SẴN):** `twoFactor.moKhoaTotp` (`server/routers/twoFactorRouter.ts:377-396`) — `adminProcedure`; input `{ userId: số nguyên dương, lyDo: 5..300 }`; output `{ success: boolean; daMoKhoa: boolean }`; tự mở khoá ⇒ `FORBIDDEN PERMISSION_DENIED {action:"adminAccess", reason:"totpSelfUnlock"}`; người không tồn tại ⇒ NOT_FOUND `user`; luôn ghi audit `totp.mo_khoa`; KHÔNG trả số lần sai.

**Files:** Modify `client/src/pages/Users.tsx` (hành động trên hàng người dùng, chỉ khi vai admin); locales `users.totp.moKhoa.*`. Test: `client/src/pages/Users.moKhoaTotp.dom.test.tsx` (mới).

Chốt: hộp xác nhận với ô lý do (≥ 5 ký tự); `daMoKhoa:true` ⇒ "Đã mở khoá xác thực hai lớp"; `false` ⇒ "Người này không bị khoá (đã ghi nhật ký)"; hàng của CHÍNH admin đang đăng nhập ⇒ không có hành động (máy chủ vẫn chặn); không hiện / không đoán số lần sai.

- [ ] **Step 1–6:** test đỏ (admin, hàng người khác ⇒ có hành động, gửi đúng `{userId, lyDo}`; hai kết quả ⇒ hai câu; hàng của chính mình ⇒ không có; vai không admin ⇒ không có) → cài → chạy lại `client/src/pages/Users*` + census + i18n → đột biến (hiện hành động cả hàng của chính mình ⇒ ca đỏ) → commit `feat(ui): admin mo khoa TOTP cua nguoi dung khac (twoFactor.moKhoaTotp, ly do bat buoc) (R1b-2b-2b B T10, muc 38)`.

### B-T11: "Điều kiện cho phép" trên faceplate (mục 2, M4) — CHỜ C5 (sau R1b-2b-2a)

**Hợp đồng máy chủ (Phần A C5):** `scadaCommands.dieuKienChoPhep` — query; giấy phép `MOD_OT_CONTROL`; input `{ adapterId, tagKey, value: number | boolean | string(≤ 256) }`; output `{ choPhep: true; canTotp: boolean; muc: 1|3|4|5; canhBao: string[] } | { choPhep: false; tuChoi: { ma: string; … } }` — CÙNG mã từ chối như `scadaCommands.request`; không ghi gì, không tiêu TOTP; trần 60 / phút / người (`OPERATION_FAILED {operation:"scadaDryRun", reason:"rateLimited"}`).

**Files:** Modify `client/src/components/scada/Faceplate.tsx` (khối "Điều kiện cho phép" phía trên nút Gửi; KHÔNG đổi luồng `request` / `confirm` / `huy`); locales `scada.dieuKien.*`. Test: `client/src/components/scada/Faceplate.dieuKien.dom.test.tsx` (mới).

Chốt: gọi `dieuKienChoPhep` khi giá trị nhập hợp lệ, debounce 400 ms, `retry: false`; hiện "Được phép — cần mã TOTP" / "Được phép" / "Không được phép: <câu dịch của `tuChoi.ma` — cùng hàm dịch mà faceplate dùng cho lỗi của `request`>"; KHÔNG khoá nút Gửi theo kết quả chạy khô (máy chủ là trọng tài ở `request`); lỗi `rateLimited` ⇒ ẩn khối (không chặn thao tác).

- [ ] **Step 1–6:** test đỏ (nhập 50 ⇒ sau 400 ms đúng một lượt `dieuKienChoPhep {adapterId, tagKey, value:50}`; ba kết quả ⇒ ba câu; `choPhep:false` mà nút Gửi vẫn bấm được và gửi `request`; gõ nhanh 5 ký tự ⇒ 1 lượt) → cài → chạy lại `client/src/components/scada/Faceplate*` + `client/src/components/scada/DungMay.dom.test.tsx` (hồi quy) + census + i18n → đột biến (khoá nút Gửi khi `choPhep:false` ⇒ ca "vẫn bấm được" đỏ; bỏ debounce ⇒ ca 1 lượt đỏ) → commit `feat(ui): faceplate hien Dieu kien cho phep (chay kho dieuKienChoPhep, khong khoa nut Gui) (R1b-2b-2b B T11, M4 muc 2)`.

### B-T12: Nghiệm thu Phần B

**Files:** Create `docs/superpowers/plans/2026-10-27-scada-r1b-2b-2b-B-bao-cao-nghiem-thu.md` (trong worktree của scada-ui).

- [ ] **Step 1:** chạy lại mọi tệp test của B-T1–B-T11 3 lượt tuần tự; xanh.
- [ ] **Step 2: Đột biến hệ thống:** `ChipTruyenThong` hiện `tong` gồm edge VÀ `ScadaNhatKy` gắn "sim" theo `simulated` ⇒ ca B-T7 + B-T8 đỏ. Hoàn tác.
- [ ] **Step 3:** client census + `npm run i18n:check` + `npx tsc --noEmit` (12 GB).
- [ ] **Step 4: Báo cáo:** bảng task → commit → test → đột biến → kết quả rà soát scada-master / kiem-dinh; thay đổi nhìn thấy được (chip, nhật ký, Lab, posture theo bước, mở khoá TOTP, "Điều kiện cho phép", ô tìm M12); giới hạn; LOGIC · DỮ LIỆU · VẬN HÀNH.
- [ ] **Step 5: Chạy toàn bộ phía client — CHỈ sau "OK chạy ngay" của điều phối** (báo "sẵn sàng" trước): `node scripts/luoi-truoc-gop.mjs --nang client/src` + `npm run check` + `npm run i18n:check`. Phân loại mọi tệp đỏ (tải / có sẵn / của task) — không nới ngưỡng.
- [ ] **Step 6: Commit** `test(ui): nghiem thu R1b-2b-2b phan B - chip n/m, nhat ky, Lab doc, posture theo buoc, M12, mo khoa TOTP, dieu kien cho phep, i18n gioi han thu tuc, DOM I-2`.

---

## Mục đã đối chiếu với danh sách R1b-2b-2b

| Mục | Ở Phần B | Ghi chú |
|---|---|---|
| 1 M9 nhật ký (UI) | B-T8 | nợ phạm vi + thủ tục ở Phần A C1 |
| 2 M4 điều kiện cho phép (UI) | B-T11 | CHUYỂN THÊM: phần giao diện thấp rủi ro (không khoá nút, máy chủ là trọng tài); thủ tục ở C5 |
| 3 M12 tìm kiếm / deadband ứng viên / ô chọn adapter | B-T5, B-T6 | deadband ứng viên chờ C3 |
| 4 chip n/m | B-T7 | chờ C2 |
| 5 Lab thử đọc (UI) | B-T9 | chờ C4 |
| 6 che endpoint / lastError (hiển thị) | B-T7 | thủ tục ở C2 |
| 10 nhãn "sim" | B-T8 | cờ `laStub` từ C1 |
| 30 DOM I-2 | B-T2 | — |
| 38 màn admin mở khoá TOTP | B-T10 | CHUYỂN THÊM: thủ tục có sẵn, chỉ thiếu UI |
| 39 `NganTagAdapter` quyền | B-T4 | CHUYỂN THÊM: chỉ client (không gọi query khi thiếu quyền) |
| 40 i18n `TRPC_GIOI_HAN_THU_TUC` | B-T1 | — |
| 54 posture `theoBuoc` + i18n + làm tươi | B-T3 | CHUYỂN TOÀN BỘ: "cache 30 s" là `staleTime` của client (`EngineeringHub.tsx:306`), không phải bộ đệm máy chủ |

Không chuyển (ở Phần A, có lý do): 49b (tệp `DeviceAdapterManagement.tsx` chạm ghim STOP — scada-master giữ), 57 (chuỗi máy chủ của bộ đề xuất AI), 55 (công cụ `i18n-check` + census), 21 (hộp duyệt interlock — client interlock bị cấm), 7 / 8 / 9 (máy chủ).

## Tự rà soát (đã chạy)

1. **Phủ yêu cầu.** Tám mục điều phối gợi ý: M9 (B-T8), M12 (B-T5, B-T6), chip (B-T7), Lab (B-T9), "sim" (B-T8), i18n 429 (B-T1), `theoBuoc` (B-T3), DOM I-2 (B-T2). Chuyển thêm có lý do: 2 (UI), 38, 39, 54 (toàn bộ), 6 (hiển thị). Mỗi task ghi hợp đồng: thủ tục có sẵn (đường, vào / ra, quyền, phạm vi, NOT_FOUND) hoặc task hợp đồng Phần A mà nó chờ. Danh sách cấm ở Global Constraints. Giao thức bàn giao có mục riêng.
2. **Quét bước.** Mỗi bước có tệp, chữ ký / tên thành phần, giá trị (`refetchInterval` 15 000, debounce 400, `staleTime` 10 000, `retryAfterGiay` mặc định 60), khoá i18n, test và đột biến. Không thân hàm ngoài test.
3. **Nhất quán kiểu.** Tên thủ tục / trường khớp Phần A: `commandLog.nhatKy` (`hang`, `conTro`, `laStub`, `loi`), `scadaDiag.tomTatTruyenThong` (`ketNoi`, `dangNoi`, `mat`, `khac`, `tong`, `edge`), `scadaKenh.danhSach[*].canhBaoNguon`, `scadaDiag.thuDocDiaChi`, `scadaCommands.dieuKienChoPhep` (`choPhep`, `canTotp`, `tuChoi`).
4. **Review Focus.** Năm dòng, test ở B-T7, B-T8, B-T1, B-T4, B-T9.
5. **Tỷ lệ.** Khối code chỉ là test.

## Câu hỏi chỉ điều phối trả lời được — kèm khuyến nghị

- **Q-B1 (B-T7).** Chip "Truyền thông n/m" đặt ở đâu? Thiết kế ghi "thanh trên" (chung). *Khuyến nghị:* lát này chỉ ở đầu các màn SCADA (M10, M12, nhật ký) — `DashboardLayout` là tệp dùng chung toàn ứng dụng và chưa có số đo tải của lượt hỏi 15 s; đưa lên thanh chung sau (cùng Phần A Q5).
- **Q-B2 (B-T10).** Mục 38 (màn admin mở khoá TOTP) nằm ngoài màn SCADA (`Users.tsx`). Cho scada-ui làm? *Khuyến nghị:* có — thủ tục có sẵn, máy chủ cấm tự mở khoá, có audit; nếu điều phối muốn giữ mọi thứ liên quan xác thực ở scada-master thì B-T10 chuyển sang Phần A.
- **Q-B3 (B-T11).** "Điều kiện cho phép" có được khoá nút Gửi khi chạy khô nói "không được phép"? *Khuyến nghị:* KHÔNG khoá (chỉ hiển thị) — tránh lệch giữa chạy khô và `request`, máy chủ luôn là trọng tài.
- **Q-B4 (B-T8).** Mục điều hướng "/scada/journal" hiện cho mọi người có `machine_control.canView` (không chỉ kỹ sư)? *Khuyến nghị:* có (`engineerOriented: false`) — người vận hành cần xem lệnh của chính ca mình; chi tiết kỹ thuật đã bị máy chủ che.
