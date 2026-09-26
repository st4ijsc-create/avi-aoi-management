# Vá review TOÀN NHÁNH Pha 8 — báo cáo

**Nhánh:** `feat/hmi-dep` · **Từ:** `3add9595` → **`711b2334`** (7 commit)
**Ngày:** 2026-08-10 · **Máy chủ sau redeploy:** PID **13592** (`node dist/index.js`, khớp chính xác)
**Nguồn:** `docs/superpowers/reports/2026-08-10-vram-pha8-review-toan-nhanh.md` (2 Critical · 3 Important · 4 Minor)

---

## 0. Hiệu chuẩn thước TRƯỚC KHI TIN BẤT KỲ SỐ NÀO

| Thiết bị | Sự kiện có ĐÁP SỐ BIẾT TRƯỚC | Kết quả |
|---|---|---|
| `psql` (owner `aoi`, cổng 5434) | `information_schema` trên **cả hai** DB | `deviceName varchar(255)` · `ipAddress varchar(45)` · `sessionToken text` ⇒ 0317 đã áp |
| `curl` không kèm xác thực | `GET /api/external/health` | **401** ⇒ mọi 200 bên dưới không phải "tuyến vốn công khai" |
| `GET /api/observability/metrics` | quét **TRƯỚC** redeploy | **0** dòng `soPhien` ⇒ bộ đếm mới chưa tồn tại |
| cùng bề mặt ấy | quét **SAU** redeploy | 2 bộ đếm hiện ra, đọc `0` ⇒ **bản dựng đang chạy LÀ bản vừa build** |
| `grep` trên `dist/index.js` | 4 định danh mới | cả 4 **CÓ** ⇒ bản vá thật sự nằm trong bundle |
| bộ đếm `soPhien_chanDaThuHoi_total` | một lượt Bearer với phiên **ĐANG SỐNG** | **KHÔNG nhích** ⇒ nó không đếm bừa |

⚠ **Một lượt thiết bị nói dối trong chính lượt này:** ô nghiệm thu C-1 đầu tiên gọi `auth.logout` bằng
`curl -X POST` **không kèm `Content-Type: application/json`** ⇒ **HTTP 415**, lượt đăng xuất **không hề
xảy ra**, và bộ đếm đứng yên. Đọc vội thì đó là *"bản vá không chạy"*. Chạy lại với header đúng ⇒ 200 và
bộ đếm nhích. **Kết quả gây sốc ⇒ nghi thiết bị trước.**

---

## 1. Bảng finding × kết quả

| # | Mức | Kết quả | Commit | Ca ĐỎ khi đột biến |
|---|---|---|---|---|
| **C-1** thu hồi phiên hở trên 58 tuyến `/api/external/*` | Critical | **ĐÃ VÁ** + nghiệm thu sống | `0466059a` | `thuHoiPhienMoiBeMat §4` · (Task 1) `buocDoiMatKhauMoiBeMat §4` |
| **C-2** UA dài đúc phiên không thu hồi được | Critical | **ĐÃ VÁ 3/4 đường** (đường 2 = `.DRAFT`, đường 4 = **DỪNG, BÁO**) | `c9f828ae` | `tranCotSoPhien §2a · §2b · §4b` |
| **I-1** tập "người đọc `user_secrets`" suy từ MỘT đường dẫn | Important | **ĐÃ VÁ** | `13b0c4c1` | `hangRaoKhongAiCanh §4b · §4c` |
| **I-2** `hoTuyenSongSong §3` lọt bằng biến trung gian | Important | **ĐÃ VÁ** | `c79888ca` | `hoTuyenSongSong §3` |
| **I-3** `buocDoiMatKhauMoiBeMat §1a` tự thoả | Important | **ĐÃ VÁ** | `d3273299` | `buocDoiMatKhauMoiBeMat §1a` |
| **M-1** `0317` tự khai một khoản nợ sổ sách không tồn tại | Minor | **ĐÃ VÁ** | `61146859` | — (chú thích) |
| **M-2** D3 gán cứng `bang: "users"` | Minor | **ĐÃ VÁ** | `61146859` | `xoaHangKhongGioiHan §1d` |
| **M-3** ô `password` là trang trí với tài khoản SSO | Minor | **ĐÃ VÁ (ghi rõ), KHÔNG siết** | `61146859` | — (docstring) |
| **M-4** hai bề mặt client song song | Minor | **VÁ MỘT NỬA** (`isCurrent`), nửa hợp nhất **HOÃN** | `61146859` | — |

**Năm mục *"đã nghi rồi RÚT LẠI"* của reviewer: KHÔNG đụng tới.** Không mục nào bị vá lại.

### ➕ Một finding review KHÔNG có — lượt chạy cổng với `--sequence.shuffle.tests` bắt được

| # | Mức | Kết quả | Commit | Ca ĐỎ |
|---|---|---|---|---|
| **X-1** `phienTrungTrongMotGiay §1` **phụ thuộc thứ tự trong file** | Important (theo tôi) | **ĐÃ VÁ** | `711b2334` | chính nó, dưới `--sequence.shuffle.tests` |

§1 đọc `hangCuaToi()` — **mọi** hàng của `uid` — rồi ghim `=== 2`, trong khi §3 và §4 **cũng** ghi hàng cho
**cùng** `uid`. Ô chỉ xanh khi nó chạy **trước** hai ô kia. Đo được **3/3** lượt shuffle:
`expected 4 to be 2`, và câu lỗi **đổ oan** cho *"lượt thứ hai rơi vào catch (23505)"* trong khi **cả hai
lượt ghi đều thành công** — đúng lớp **"màu ĐỎ nói dối"**.
⚠ `git diff 3add9595 HEAD -- <file>` **RỖNG** ⇒ lỗi **có trước** lượt vá này, không phải hồi quy của tôi.
**Vá:** khoá phép đo vào **đúng hai vé vừa đúc** (`ve.includes(h.sessionToken)`) ở cả ô đếm và ô kiểm
thu-hồi-độc-lập — đúng bài học Task 3 (*"khoá lượt đo vào DẤU RIÊNG của chính nó"*), lần này áp cho lượt
**ĐỌC** thay vì lượt **XOÁ**. Bất biến giữ nguyên: mất nonce ⇒ `a === b` đỏ; lượt ghi thứ hai vỡ `23505`
⇒ `hang.length` = 1 ⇒ đỏ.

---

## 2. C-1 — thu hồi phiên có hiệu lực trên nhánh Bearer

### Cái đã làm

`sdk.chanNeuPhienDaThuHoi(token)` — **một chủ** cho vị từ *"phiên này còn dùng được không"*, gọi từ:
- `sdk.xacThucTho` (nơi khối inline cũ đứng — thay bằng một lượt gọi),
- nhánh `Authorization: Bearer` của `validateExternalAuth` (`_core/index.ts`), **TRƯỚC** `chanNeuPhaiDoiMatKhau`.

Bộ nhận diện điểm xác thực chuyển khỏi file test thành mã sản xuất
**`server/_core/quetDiemXacThuc.ts`** — vì nó có **người tiêu thụ thứ hai**, và hai bản sao thì bản yếu hơn
quyết định lưới nào đỏ (lớp lỗi đã đẻ ba Critical trong chuỗi pha này).

Lưới mới **`server/_core/thuHoiPhienMoiBeMat.test.ts`** (14 ca): ∀ điểm xác thực trong `server/**` suy từ
ĐĨA+AST · §1a hiệu chuẩn **đúng vị từ §4 dùng** · §1c *"điểm chung TẮT ⇒ mọi điểm `xt` thành HỞ"* ·
§4c **M3** (tuyến REST mới trong FILE chưa tồn tại) · §5 hành vi sống trên DB thật.

### Đột biến ⇒ ĐỎ (commit TRƯỚC, đột biến SAU; chèn theo **chỉ số dòng** bằng Node)

| Đột biến | Ca ĐỎ |
|---|---|
| gỡ `await chanNeuPhienDaThuHoi(token)` khỏi nhánh Bearer (`index.ts:1680`) | `thuHoiPhienMoiBeMat.test.ts › §4 ∀ điểm xác thực trong mã sản xuất server/**: phiên ĐÃ THU HỒI bị chặn` — câu lỗi trỏ đúng `server/_core/index.ts:1658 [phien]` |
| thêm **tuyến REST MỚI trong FILE MỚI** `server/routes/dotBienTuyenMoi.ts` không tra sổ | `thuHoiPhienMoiBeMat §4` **VÀ** `buocDoiMatKhauMoiBeMat §4` (2 lưới, 2 trục) |
| **ĐỐI CHỨNG DƯƠNG**: cùng file mới ấy **CÓ** hai phép chặn | **28/28 XANH** |

⇒ Ca thứ hai là ca phân biệt *"lưới theo ĐƯỜNG THOÁT"* với *"lưới theo FILE"* — nó **đỏ ở một file mà
không lưới nào biết tên**.

### Nghiệm thu SỐNG sau redeploy (PID 13592, `engineer1` #51)

```
0) khong auth            GET /api/external/health              → 401     (đối chứng âm)
1) login engineer1                                             → 200 · hàng sổ 293 isActive=true
2) bộ đếm chanDaThuHoi                                         → 0
3) Bearer + phiên ĐANG SỐNG  GET /api/external/health          → 401 · bộ đếm VẪN 0   ← đối chứng ÂM
4) auth.logout                                                 → 200 · hàng 293 isActive=FALSE
5) Bearer + CHÍNH token đó   GET /api/external/health          → 401 · bộ đếm 0 → 1   ← PHÁN QUYẾT
```

⚠⚠ **VÌ SAO PHẢI ĐO BẰNG BỘ ĐẾM, KHÔNG BẰNG MÃ TRẠNG THÁI.** `engineer1` đang mang cờ
`passwordInvalidBefore` (chủ dự án đặt có chủ đích), nên nhánh Bearer trả **401 ở CẢ HAI phía** của lượt
đăng xuất — cổng mật khẩu che mất phán quyết. Đo được trước khi vá: bước (3) cũng **401**. Mã trạng thái
**không phân biệt được** hai nguyên nhân ⇒ một lượt nghiệm thu "nhìn một phát" sẽ khai PASS **cho một lý
do khác hẳn**. Bộ đếm là biến **duy nhất** đổi đúng theo giả thuyết, và nó có đối chứng âm ở bước (3).
Đây cũng chính là lý do phép tra sổ được đặt **TRƯỚC** cổng mật khẩu.

⚠ Reviewer đo được **200** ở bước (5) trên cùng máy chủ trước lượt vá (khi #51 chưa mang cờ).

---

## 3. C-2 — không header nào đúc được phiên không thu hồi được

### Bốn đường, làm ba, dừng một

1. **Cắt tại nguồn — LÀM.** `server/db/catTheoTranCot.ts`: cắt **mọi** cột `varchar(n)` theo trần **SUY
   TỪ SCHEMA** (`getTableColumns` → `PgVarchar.length`), áp tại `createUserSession` — **người ghi duy
   nhất**. Không phải `slice(0,255)` viết tay: 0317 đã đóng **một** cột và không ai hỏi cột kế bên, mà
   câu `INSERT` có **bảy** cột chuỗi. `sessionToken` là `text` ⇒ **không có trần ⇒ không bị chạm** (cắt
   khoá phiên là tái tạo đúng lỗ C-2 theo một đường im lặng hơn — §1b ghim).
2. **`deviceName` → `text` — KHÔNG TỰ LÀM (cần DDL).**
   ⇒ **`drizzle/0318_session_device_name_text.sql.DRAFT`**, chờ chủ dự án. Đuôi `.DRAFT` nên
   `migrate-standalone.mjs` không nhặt. Bản vá đã ship **không phụ thuộc** nó; áp xong thì cột tự rời tập
   bị cắt (phép cắt đọc trần từ schema), không phải sửa dòng mã nào.
3. **Cắt đường im lặng — LÀM.** `server/_core/demSoPhien.ts` (chủ trung lập, không vòng nhập) +
   `GET /api/observability/metrics`: `soPhien_ghiSoLoi_total` · `soPhien_chanDaThuHoi_total`. Bề mặt ấy
   **đã có** phép xác thực (loopback **hoặc** phiên admin/supervisor) ⇒ không mở thêm cửa nào.
4. **Nhánh fail-open `sdk.ts` *"không có hàng ⇒ cho qua"* — 🔴 DỪNG, BÁO CHỦ DỰ ÁN.** Xem §6.

### Đột biến ⇒ ĐỎ

Gỡ `catTheoTranCot(...)` khỏi `createUserSession` (`db/auth.ts:541`, chèn theo chỉ số dòng):

| Ca ĐỎ | Nội dung |
|---|---|
| `tranCotSoPhien › §2a` | `ghiSoPhien` với **UA dài THẬT 3.770 ký tự** ⇒ `id === null`, **không có hàng sổ** |
| `tranCotSoPhien › §2b` | hàng ấy **không thu hồi được** (cầu chì `getSessionByToken` = `undefined`) |
| `tranCotSoPhien › §4b` | ∀ người ghi `user_sessions` phải đi qua phép cắt |

⚠ Ca dùng **UA dài thật** (`DAI_THAT = 3770`), có cầu chì `expect(UA_DAI.length).toBe(3770)` — một chuỗi
ngắn làm ô ấy **xanh vô nghĩa**, đúng cách ca 300-ký-tự cũ bị dời đi mà không ai hỏi cột kế bên.

### Nghiệm thu SỐNG sau redeploy

```
UA = 3.771 ký tự · max(id) trước = 293
1) login                                    → 200
2) hàng sổ MỚI                              → 294 | isActive=true | len(deviceName)=255 | len(ipAddress)=3
                                              (TRƯỚC bản vá: **0 rows**)
3) auth.me trước logout                     → đủ hồ sơ            (đối chứng)
4) auth.logout                              → 200 · hàng 294 isActive=FALSE
5) auth.me sau logout                       → **null**            (TRƯỚC bản vá: VẪN đủ hồ sơ)
6) soPhien_ghiSoLoi_total                   → 0                   (không lượt ghi nào bị nuốt)
```

⚠ **Lượt đo TRƯỚC bản vá cố ý KHÔNG chạy trên máy chủ sống.** Đúc thêm một vé không-thu-hồi-được cho
`engineer1` là tạo thêm nợ mà chính chủ dự án vừa phải xử lý bằng `passwordInvalidBefore`. Chuỗi nhân quả
được đo **độc lập, rủi ro bằng 0** bằng ba mảnh: (a) `information_schema` cả hai DB cho `varchar(255)`;
(b) `ghiSoPhien` + UA 3.770 trên DB test ⇒ `null`, không hàng (đột biến ở trên); (c) `establishSession`
nạp `deviceName: audit.userAgent` **không qua phép cắt nào**. Cộng lượt đo sống của reviewer.

---

## 4. I-1 / I-2 / I-3

### I-1 — lượng từ theo **KHÁI NIỆM**, không theo **ĐƯỜNG DẪN**

**Đo lại độc lập TRƯỚC khi vá:** tiêm vào một **FILE MỚI** (`server/routers/rotHatGiongN1Router.ts`) một
thủ tục tRPC đọc `userSecrets` thẳng bằng drizzle rồi **trả hạt giống TOTP** ⇒ **39/39 XANH**,
`npm run check` sạch. **Tái hiện đúng finding.**

- `nguoiDocBiMatCuaUserSecrets` quét `moiFileDuoi(goc,"server")`, không một đường dẫn ghim.
- `diemDocBiMatCuaUserSecrets` / `diemDocBiMatTrongNguon` — điểm đọc kèm hàm bao. ⚠ **Khe thật:** lượt đọc
  trong một **hàm mũi tên** (thân thủ tục tRPC) **không có tên để trả** nên rơi khỏi tập *"người đọc"*
  **theo cấu tạo** — mở rộng phạm vi quét **một mình không đủ**. §4b đóng khe ấy: *"∀ điểm đọc bí mật phải
  nằm trong một HÀM CÓ TÊN"*.
- `nhapUserSecrets` / `moiFileNhapUserSecrets` — **cầu chì ĐẢO LƯỢNG TỪ** trên **quyền truy cập**: ∀ file
  sản xuất `server/**` **CẦM** bảng phải nằm trong tập KHAI (hôm nay **đúng 2**: `db/auth.ts` ·
  `_core/publicUser.ts`). **Danh tính module hỏi bằng `phanGiaiToi()` — phép nối đường dẫn**, không bằng
  chính tả chuỗi; phủ **nhập TĨNH và nhập ĐỘNG**, và **tha `import type`** (đối chứng dương).

**Đột biến ⇒ ĐỎ:** cùng file tiêm ấy ⇒ `hangRaoKhongAiCanh › §4b` **và** `§4c` (hai trục độc lập).

### I-2 — `∀ TUYỆT ĐỐI` thôi lọt bằng một biến trung gian

**Đo lại độc lập TRƯỚC khi vá:** thay `return toPublicSessions(await db.getUserSessions(…))` bằng hai dòng
`const hang = …; return hang;` ⇒ **§3 XANH**, chỉ §7 đỏ. **Tái hiện đúng finding.**

`bangTraTho` nay theo dõi biến (một tầng, không phép chiếu) và **không** coi `as unknown as T` là phép
chiếu. §3b mới: 3 đột biến phải BẮT + 2 đối chứng dương phải THA (kể cả phép chiếu **qua biến**), chạy
trên một **FILE CHƯA TỒN TẠI** — M3 cho trục ĐỌC.

**Đột biến ⇒ ĐỎ:** đúng đột biến của reviewer ⇒ `hoTuyenSongSong › §3` (trước bản vá: §3 XANH).

### I-3 — §1a thôi TỰ THOẢ

**Đo lại độc lập TRƯỚC khi vá:** ép `const duocPhu = () => true` ⇒ **14/14 XANH**, kể cả §1a/§4/§4b —
**toàn bộ lượng từ chính tắt hoàn toàn mà không một ô nào đỏ. Tái hiện đúng finding.**

Vị từ tách `phuTheoHinhDang(d, diemChungBat)` ⊕ `laTuCanhGhim(d)`; `DIEM_CHUNG_CUONG_CHE` là **tham số**.
`MA_HO` tách làm **hai bảng theo đáp số biết trước** — 3 hình dạng **HỞ THẬT** (phải bị **xếp là vi phạm**)
và 2 hình dạng **CƯỠI ĐIỂM CHUNG** (phủ khi bật · **hở khi tắt**, ô §1a2 mới). Gộp hai nhóm vào một bảng
chính là **cách ô cũ trở nên tự thoả**. §1b nay dùng **cùng** công thức.

**Đột biến ⇒ ĐỎ:** ép `duocPhu ≡ true` ⇒ `buocDoiMatKhauMoiBeMat › §1a` (trước bản vá: 14/14 xanh).

---

## 5. Bốn Minor

- **M-1** — đếm lại: `__applied_migrations` **CÓ** hàng cho `0317` trên cả hai DB (`id=401` / `id=385`,
  `success=t`). Chú thích cũ khai ngược. Đã sửa **và** ghi lý do (một chú thích về trạng thái mà không ai
  đo lại là một cái bẫy có hạn dùng — trong chính pha này nó đã gây một kết luận sai).
- **M-2** — `bangTuLietKe()` suy tên bảng từ hàm liệt kê; **bảo thủ**: không nhận ra ⇒ `?<tên hàm>`, để
  câu lỗi nói *"không biết bảng nào"* thay vì nói **sai** một cái tên. Ca §1d ghim cả ba nhánh.
- **M-3** — hệ quả với tài khoản SSO được **nói ra ở cả hai tuyến**, kèm lý do **KHÔNG siết** (chống nhà
  tù) và lối siết đúng (**bước-up SSO**, quyết định sản phẩm). Kèm cảnh báo: `hoTuyenSongSong` xanh ở đây
  là *"khớp TẬP mà cả hai cùng hở"* — cặp ấy so **A với B**, không so **A với một chuẩn**.
- **M-4** — **vá nửa có hại**: `pages/SessionManagement.tsx` đoán *"phiên hiện tại"* bằng `index === 0`
  trong khi danh sách sắp theo `lastActivityAt desc`. Hệ quả thật: nút thu hồi bị **giấu** ở phiên không
  phải của bạn và **hiện** ở chính phiên bạn đang dùng. Nay đọc `isCurrent` do máy chủ suy ra.
  **Nửa HOÃN:** hợp nhất hai tuyến (`user.getSessions` ≡ `session.list`) về một hook, và một lượng từ cho
  trục client. Lý do hoãn: hai bề mặt nằm ở hai vỏ UI khác nhau (`App.tsx` route vs `Profile.tsx` tab) và
  gọi hai không-gian-tên tRPC khác nhau ⇒ đó là một lượt đổi IA, không phải một bản vá an ninh; gộp nó vào
  lượt này là trộn hai loại rủi ro. Ghi thành **nợ mới**.

---

## 6. 🔴 CHỜ CHỦ DỰ ÁN — hai mục, KHÔNG tự quyết

### (a) Đường vá 4 của C-2 — nhánh fail-open *"không có hàng ⇒ cho qua"* (`sdk.ts`)

**KHÔNG SIẾT.** Lý do đã đo, không phải suy đoán:

- `user_sessions` chỉ được ghi **từ khi cơ chế ra đời** ⇒ mọi JWT cũ hơn **không có hàng**.
- Đếm trên DB sản xuất ngay lượt này: `userId=51` còn **21 phiên `isActive=true`** mang id **241–276**,
  tức có trước lượt đo hôm nay. Siết fail-closed ⇒ **mọi vé không có hàng chết ngay**.
- Pha 7 đã ship đúng lớp ấy ra **nhà tù thật 4/4 tài khoản**.

⇒ Lối siết đúng mà reviewer đề xuất (*chỉ tha vé có `iat` cũ hơn một mốc cấu hình được*) là một **quyết
định vận hành**: cần chủ dự án **chọn mốc** và **chấp nhận số người phải đăng nhập lại**. Không phải một
dòng mã. Lỗ mà nhánh này để lại **đã hẹp đi đáng kể** ở đầu kia: từ lượt vá C-2 một lượt ghi sổ hỏng không
còn im lặng (cắt theo trần + `soPhien_ghiSoLoi_total` có bề mặt Prometheus).
Ô **`thuHoiPhienMoiBeMat › §5d`** ghim nhánh này để lượt siết không xảy ra **lặng lẽ**.

### (b) DDL `drizzle/0318_session_device_name_text.sql.DRAFT`

Chờ duyệt. Ba con số trong header còn để trống — **chủ dự án đo lại rồi dán vào trước khi áp**. Áp bằng
`node scripts/migrate-standalone.mjs`, **đừng** chạy tay bằng `psql` (0317 áp ngoài đường chuẩn và đã đẻ
ra M-1). Sau khi áp phải sửa `drizzle/schema/auth.ts:238` cho khớp — và lưới `tranCotSoPhien §1a` sẽ
**ĐỎ** ngay lúc đó, đúng như nó phải thế.

---

## 7. Cổng ra

| Cổng | Kết quả |
|---|---|
| `npm run check` | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **sạch** (0 mismatch · 0 NEW missing · 0 stale · 0 vi phạm) |
| §Cổng kiểm chung (48 đường) | **2349 passed / 1 failed** — đúng ca đỏ ĐÃ BIẾT, không sửa: `server/api.test.ts › Factory Router › should reject non-admin from creating factory` |
| …cùng cổng ấy + `--sequence.shuffle.tests` | **2349 passed / 1 failed** — **cùng một** ca đã biết. (Lượt shuffle ĐẦU cho **2 failed**; ca thứ hai là **X-1**, đã vá ở `711b2334`.) |
| `npm run build` | **exit 0** · `dist/index.js` 10,2 MB · 4/4 định danh mới có mặt trong bundle |

**`CONG` 46 → 48** · **`FILE_CANH` 109 → 111** — **tự đếm bằng cách để cổng đỏ rồi đọc số thật**
(`vramPha5Gate` báo `expected 110 to be 109` sau lưới C-1; số 111 đọc cùng cách sau lưới C-2).
Hai đường mới trong §Cổng kiểm chung: `server/_core/thuHoiPhienMoiBeMat.test.ts` ·
`server/_core/tranCotSoPhien.test.ts`.

---

## 8. Nợ mới (thành thật, không giấu)

1. **M-4 nửa sau chưa làm** — hai bề mặt client cho cùng một màn "phiên đăng nhập" vẫn tồn tại song song
   trên hai không-gian-tên tRPC; trục client vẫn **không có lượng từ nào**. (Lý do hoãn: §5.)
2. **Nhánh fail-open `sdk.ts` vẫn mở** — 21 phiên không-có-hàng-sổ của `userId=51` là số đo của cái giá
   phải trả nếu siết. Chờ chủ dự án (§6a).
3. **`deviceName` vẫn `varchar(255)`** — phép cắt ở tầng ứng dụng đóng lớp lỗi, nhưng UA dài vẫn bị **cắt
   mất** thông tin chẩn đoán. Đường vá đúng lớp nằm ở `.DRAFT` (§6b).
4. **Vùng mù được khai của §4b/§4c (I-1)** — một lượt đọc `user_secrets` bằng **SQL thô** (`sql\`…\``)
   không đi qua đối tượng bảng: §4c bắt được nếu file **nhập** bảng, nhưng một câu SQL thuần chuỗi thì
   **cả hai ô đều mù**. Chưa có lượng từ nào cho trục ấy.
5. **`bangTraTho` lan truyền MỘT tầng** — biến đi qua **hai** lần gán, hoặc thoát qua `res.json(<biến>)`
   ở tuyến REST, vẫn ngoài tầm §3. Trục ấy chỉ còn `userExposureScan §5` (theo giá trị) canh.
6. **Lượt redeploy suýt phá chính bộ dò tiến trình.** Ba cách khởi động đầu cho ba dòng lệnh **KHÁC** dòng
   cũ (`"C:\Program Files\nodejs\node.exe" dist/index.js` · `node  dist/index.js` (hai dấu cách) ·
   `"node" dist/index.js`) ⇒ bộ khớp **chặt** `-ceq 'node dist/index.js'` sẽ **không thấy** máy chủ ở lượt
   sau, và người đi sau rất dễ nới sang khớp lỏng — mà khớp lỏng **từng giết nhầm 12 sidecar MCP**.
   Đã khởi động lại bằng `Invoke-CimMethod Win32_Process Create` với `CommandLine` **nguyên văn**; PID
   13592 khớp chính xác. ⚠ Nợ: cách khởi động máy chủ nên được ghim thành một script, không phải một dòng
   gõ tay — mỗi cách gõ là một dòng lệnh khác.
7. **Cổng chưa BAO GIỜ được chạy shuffle trước lượt này?** X-1 là một phụ thuộc thứ tự **trong file** đã
   sống qua ít nhất một lượt cổng. Kế hoạch có ghi *"cộng một lượt `--sequence.shuffle.tests`"*, nhưng một
   lỗi hiển nhiên như thế còn sống nghĩa là lượt ấy **không** được chạy đều. ⇒ Đề nghị đưa cờ shuffle vào
   **chính khối lệnh** §Cổng kiểm chung, đừng để nó là một dòng ghi chú bên dưới.
8. **`server/_core/quetDiemXacThuc.ts` là mã sản xuất chỉ phục vụ lưới.** Có chủ ý (một bộ suy dùng chung
   không sống được trong `*.test.ts` vì `laFileTest` loại nó khỏi phạm vi quét và vitest sẽ đăng ký trùng
   suite), nhưng nó **nằm trong bundle** `dist/index.js`. Chi phí: vài KB + một lượt nhập `typescript`
   **chỉ khi** ai đó nhập module này — hôm nay **không** mã chạy nào nhập nó. Nên xem lại nếu bundle size
   thành vấn đề.

---

## 9. Kỷ luật đã giữ

- **KHÔNG** DDL / migration / seed / `kb:sync` / cấp quyền. Cần DDL ⇒ `.DRAFT`.
- **KHÔNG** đổi mật khẩu / cờ / vai / quyền của ai. `passwordInvalidBefore` của `engineer1` #51 **còn
  nguyên** — và nó chính là thứ làm lượt nghiệm thu C-1 phải đo bằng bộ đếm thay vì bằng mã trạng thái.
- **Dọn đúng thứ mình tạo:** 4 phiên lượt này đúc (`291`–`294`) đều đã `auth.logout` ⇒ `isActive=f`.
  21 phiên còn sống của #51 (`241`–`276`) **có trước** và **không bị đụng**.
- `git add` **tường minh từng file**, `git diff --cached --name-only` xác nhận mỗi lượt. **Không**
  `git add -A`. ~247 mục dirty ngoài phạm vi **không bị chạm**;
  `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` **RỖNG** ở cuối lượt.
- **Commit TRƯỚC, đột biến SAU**; mọi đột biến chèn bằng **Node theo chỉ số dòng** (repo trộn LF/CRLF,
  `cat -A` nói dối), và mọi đột biến đã hoàn nguyên bằng `git checkout HEAD -- <file>` / `rm`.
- **KHÔNG** spawn sub-agent.
