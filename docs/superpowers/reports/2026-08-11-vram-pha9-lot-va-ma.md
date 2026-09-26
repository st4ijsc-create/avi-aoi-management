# Pha 9 — lượt vá mã: I-5 · M-4 · ca đỏ `api.test.ts` · nửa còn lại của I-3 · hạn cookie phiên

**Nhánh** `feat/hmi-dep` · **HEAD trước** `9d81e382` · **HEAD sau** `9f055d8e`
**Ngày** 2026-08-12 · **Máy chủ** cổng 3000, PID **12860** (sau triển khai lại), `GET /` = **200**

---

## 0. Bảng kết quả 5 mục

| # | Mục | Phán quyết | Commit | Đột biến ⇒ tên ca ĐỎ |
|---|-----|-----------|--------|----------------------|
| 1 | **I-5** — `quetDiemXacThuc` tin theo TÊN + hình dạng thứ ba vô hình | **ĐÃ VÁ** (cả hai nửa) | `32c92a5f` | 4 ca (bảng §1.4) |
| 2 | **M-4** — 7 tuyến REST gộp mọi nguyên nhân về một mã | **ĐÃ VÁ** — 3 lớp mã | `db5f9663` | 2 ca (bảng §2.4) |
| 3 | `api.test.ts › Factory Router › should reject non-admin` | **ĐÃ VÁ** kỳ vọng (sản phẩm ĐÚNG) | `32e6e57d` | 1 ca (§3.3) |
| 4 | **`tieuMaTrongSo`** — bỏ đồng hồ NGƯỜI GỌI | **ĐÃ VÁ** trọn (cả `donSo`) | `489ed1aa` | 2 ca (§4.4) |
| 5 | Cookie phiên TTL — hạ khỏi 1 năm | **ĐÃ VÁ** — **30 ngày** | `9f055d8e` | 1 ca (§5.5) |

**Không mục nào bị bác bỏ. Không mục nào hoãn.**
Brief lệch trạng thái thật **1 lần** ở lượt này (mục 5, xem §5.1) — và lệch theo hướng **nhẹ hơn sự
thật**: `SESSION_TTL_DAYS` không phải *"có sẵn nhưng chưa đặt"*, nó là **mã chết**.

---

## 1. Mục 1 — I-5

### 1.1 Đo trước khi sửa (probe AST trên `9d81e382`, đã hoàn nguyên)

```
quetDiemXacThuc("server/routes/gia.ts", <getSessionByToken + getUserById>)      ⇒ []
quetDiemXacThuc("server/routes/gia2.ts", <cùng thân, tên hàm = thuXacThucRest>) ⇒
   [{ loai:"xt", boQua:false, tuCanh:false, tuTraSo:false, tuKiemTaiKhoan:false }]
số file sx = 999 · tổng điểm = 14 (xt 13 · phien 1)
```

⇒ **Hai lỗ, cả hai xác nhận:**
1. Một bề mặt HTTP tự phân giải danh tính bằng `getSessionByToken` + `getUserById` cho **0 điểm** —
   vô hình với **cả ba** lượng từ ∀ (`buocDoiMatKhauMoiBeMat` · `thuHoiPhienMoiBeMat` ·
   `taiKhoanBiTatMoiBeMat`).
2. Cùng thân ấy, đặt tên hàm là `thuXacThucRest` ⇒ được **cả ba vị từ phủ xếp là ĐƯỢC PHỦ**
   (`loai==="xt"` ∧ điểm chung bật), **và** cộng vào cầu chì §3 *"≥12 điểm `xt`"*.
   Một lỗ làm **thiết bị đo khoẻ lên**.

### 1.2 Bản vá

* **Nửa 1 — hình dạng thứ ba vào chính bộ suy dùng chung** (`TEN_TRA_SO_PHIEN` +
  `TEN_LAY_HANG_USER`), xếp `loai: "phien"` ⇒ **không** vị từ nào của ba lưới phải đổi công thức.
  Ba lưới nhận thêm **một ca `MA_HO`** (đáp số: HỞ) và **một ca `MA_KIN`** (đáp số: THA).
* **Nửa 2 — phép NEO NHẬP** (`neoNhapThieu()` + `CHU_CUA_TEN`) và lưới mới
  `server/_core/neoTenXacThuc.test.ts`, sao khuôn `totpReplayScan.test.ts`, dùng lại `phanGiaiToi`
  — phép **NỐI ĐƯỜNG DẪN**, không so chính tả (bài học R1b).

> **Vì sao phép neo KHÔNG nhét vào `quetDiemXacThuc()`** (đo trước khi quyết): ba lưới ∀ hiệu chuẩn
> vị từ của mình bằng **mã tổng hợp không có lượt nhập nào** (`"tong-hop.ts"`). Bắt bộ nhận diện đòi
> một lượt nhập ⇒ mọi ô §1 của cả ba lưới thấy `diem.length === 0` ⇒ **ba lưới đỏ cùng lúc vì hạ
> tầng** — đúng cái bẫy brief cảnh báo (*"đổi bộ suy mà không xem người dùng nó"*).

Vùng mù §2 của `buocDoiMatKhauMoiBeMat.test.ts` (*"quan sát, không phải bất biến"*) được **ĐÓNG** và
viết lại đúng phạm vi còn hở (một cơ chế phiên **thứ tư**, ví dụ `db.select()` thô trên
`user_sessions` — đo được **0** chỗ hôm nay).

### 1.3 Đo sau bản vá

* **0** vi phạm neo nhập trên `server/**` sản xuất (999 file).
* **0** hình dạng thứ ba trong `server/**` sản xuất.
⇒ Cả hai là **cổng thật**, không phải ảnh chụp nợ cũ.

### 1.4 Đột biến (file MỚI `server/routes/__dotBienI5.ts`, ghi bằng Node, đã xoá)

Một tuyến REST tự phân giải danh tính, hàm giúp việc đặt tên `thuXacThucRest`, không nhập chủ:

| Lưới | Tên ca ĐỎ |
|------|-----------|
| `neoTenXacThuc.test.ts` | `★★★★ §2 ∀ file sản xuất server/**: mọi tên xác thực đều NHẬP từ CHỦ của nó` |
| `buocDoiMatKhauMoiBeMat.test.ts` | `§4 ∀ điểm xác thực trong mã sản xuất server/**: cờ buộc-đổi-mật-khẩu ĐƯỢC KIỂM` |
| `thuHoiPhienMoiBeMat.test.ts` | `§4 ∀ điểm xác thực trong mã sản xuất server/**: phiên ĐÃ THU HỒI bị chặn` |
| `taiKhoanBiTatMoiBeMat.test.ts` | `§4 ∀ điểm xác thực trong mã sản xuất server/**: tài khoản bị TẮT bị chặn` |

Thông điệp đỏ ghim đúng hai vị trí: `__dotBienI5.ts:7 [phien]` (hình dạng thứ ba) ·
`__dotBienI5.ts:14 gọi \`thuXacThucRest\` mà KHÔNG nhập từ \`server/routes/_xacThucRest.ts\``.

**Đối chứng dương:** xoá file ⇒ 4 file / **62 ca XANH**.

### 1.5 ⚠ THIẾT BỊ ĐO NÓI DỐI — lần thứ 33 và 34, trong cùng một probe

Bảng tra `CHU` dạng **object literal** ⇒ `CHU["toString"]` trúng `Object.prototype.toString`
⇒ probe báo **308 vi phạm ma**. Đổi sang `new Map(...)` nhưng **vẫn tra bằng `CHU[ten]`** ⇒ trúng
`Map.prototype.get`/`has`/`keys`/`delete`/`set`/`values` ⇒ **4.621 vi phạm ma**. Số thật là **0**.
⇒ `CHU_CUA_TEN` trong mã sản phẩm là `Map` + `.get()`, và lý do được ghi tại chỗ.

---

## 2. Mục 2 — M-4

### 2.1 Tự đếm lại (đọc `server/_core/sdk.ts`, không tin brief)

Brief nói *"7 tuyến REST trả sai mã trạng thái"* và nhắc *"C-1 vừa thêm `ACCOUNT_DISABLED`"*.
Đếm thật: **SÁU nguyên nhân** đi qua cái `catch` ấy, thuộc **BA lớp**:

| nguyên nhân (thứ tự chạy trong `xacThucTho`) | ném | mã ĐÚNG |
|---|---|---|
| cookie thiếu/rác ⇒ `"Invalid session cookie"` | `ForbiddenError` | **401** |
| `SESSION_NOT_IN_LEDGER` / `"Session has been revoked"` | `ForbiddenError` | **401** |
| `"Failed to sync user info"` / `"User not found"` | `ForbiddenError` | **401** |
| `ACCOUNT_DISABLED` (C-1, `chanNeuTaiKhoanBiTat`) | `ForbiddenError` | **403** |
| `MUST_CHANGE_PASSWORD` (Pha 8 T1, `chanNeuPhaiDoiMatKhau`) | `ForbiddenError` | **403** |
| DB không với tới | **KHÔNG** `HttpError` | **500** |

⚠ Cả năm phán quyết đều là `ForbiddenError` ⇒ `statusCode === 403` cho **tất cả** ⇒ `statusCode`
**không** phân biệt được chúng. `sdk.ts` cố ý nhét `MUST_CHANGE_PASSWORD:` / `ACCOUNT_DISABLED:` vào
đầu thông điệp *"để lượt gỡ lỗi phân biệt được"*; lượt này biến chú thích ấy thành **hợp đồng được
canh**.

### 2.2 Vì sao không gộp tất cả thành 401

* **401 nghĩa là *"đăng nhập lại thì vào được"***. Trả 401 cho tài khoản **đã bị vô hiệu hoá** hay
  người **đang bị buộc đổi mật khẩu** là bảo họ làm đúng cái việc **KHÔNG cứu được họ** — client
  (`useAIStream`, `useKbChatStream`) đá họ về màn đăng nhập, nơi `authService` từ chối họ **lần
  nữa**. Một vòng lặp không lối ra.
* **500 cho sự cố DB là câu trung thực**: gộp nó vào 401 là dán nhãn *"lỗi của bạn"* lên sự cố máy
  chủ **và giấu** nó khỏi mọi bảng theo dõi 5xx — đúng lớp lỗi A6 vừa vá theo chiều ngược lại.

**Fail-closed KHÔNG đổi một ly**: cả ba lớp đều là *"dừng, không đi tiếp"*.
`xacThucBeMatRest.test.ts` §2 (*"401|403, không 5xx"*) vẫn xanh — nó đo tình huống *"không cookie"*,
nơi **chỉ nguyên nhân thứ nhất** xảy ra được. **Đó cũng chính là lý do §2 không thể thấy lỗi này.**

### 2.3 i18n

Thân phản hồi mang **mã máy-đọc-được** (`code`); `client/src/lib/restAuthError.ts` (MỘT chủ, dùng
bởi cả hai hook) tra `errors.<code>` qua `translateAppError`. Bốn mã (`AUTH_REQUIRED` ·
`MUST_CHANGE_PASSWORD` · `ACCOUNT_DISABLED` · `DB_UNAVAILABLE`) **đã có** trong
`server/_core/appErrorCodes.ts` **và** trong cả **ba** locale ⇒ **0 khoá mới, 0 câu tiếng Anh cứng
mới**. Ô `error` giữ nguyên `"Unauthorized"` cho lớp 401 ⇒ client chưa di trú không hồi quy.
`npm run i18n:check` sạch.

### 2.4 Đột biến (`_xacThucRest.ts`, chèn theo chỉ số dòng bằng Node — đã đọc lại chỗ chèn)

`return "AUTH_REQUIRED";` ở **dòng 110**, ngay đầu thân `phanLoai` (KHÔNG rơi vào khối bình luận —
đã in lại dòng 107–116 để xác nhận):

| Tên ca ĐỎ | Thông điệp |
|---|---|
| `★★★★ §8a lượt ném THẬT của hai phép chặn ⇒ 403, và HAI mã PHÂN BIỆT ĐƯỢC` | `expected [401,'AUTH_REQUIRED'] to deeply equal [403,'ACCOUNT_DISABLED']` |
| `★★★★ §8b phiên hỏng ⇒ 401 · lỗi KHÔNG phải HttpError ⇒ 500` | `expected [401,'AUTH_REQUIRED'] to deeply equal [500,'DB_UNAVAILABLE']` |

**Đối chứng dương:** hoàn nguyên ⇒ **22/22 XANH**.

### 2.5 ⚠ GOTCHA đã trả giá khi viết §8a

Một **namespace ESM chỉ có getter**: `Cannot set property phaiDoiMatKhau of [object Module]`. Ghi đè
`db.*` để dựng lượt ném là **bất khả VÀ sai** (nó đo một hàm KHÁC hàm sản phẩm). Bản cuối đặt hai
mốc mật khẩu trên **hàng `users` THẬT** của file test rồi gọi **chính** `chanNeuPhaiDoiMatKhau`.

---

## 3. Mục 3 — ca đỏ cuối cùng của cổng

### 3.1 Đo

```
npx vitest run server/api.test.ts -t "reject non-admin"
Expected: "Admin access required"
Received: "Bạn không có quyền create cho module \"settings_factory\""
```

RBAC **vẫn từ chối** — nó chỉ thôi nói tiếng Anh, từ **AI Sprint 5** (`appError` +
`errors.PERMISSION_DENIED`, `server/_core/accessControl.ts:191-196`). **Kỳ vọng là cái cũ.**

### 3.2 Bản vá — ghim CƠ CHẾ, không ghim HIỂN THỊ

* **KHÔNG** nới thành *"ném bất cứ gì cũng được"* (biến một ca thật thành ca trang trí: xanh cả khi
  thủ tục ném vì DB rớt / zod / `TypeError`).
* **KHÔNG** ghim câu tiếng Việt (một lượt đổi bản dịch làm ca đỏ trong khi bất biến an ninh không hề
  đổi — **đúng cái bẫy vừa mắc, chỉ khác ngôn ngữ**).

⇒ Ghim **hợp đồng máy-đọc-được** mà chính `appError` sinh ra để tồn tại:
`code === "FORBIDDEN"` ∧ `appCode === "PERMISSION_DENIED"` ∧ `appParams.action === "canCreate"`.
Đối chứng dương nằm ngay trên (`should allow admin to create factory`): cùng thủ tục, cùng đầu vào,
chỉ đổi vai ⇒ ca này **không thể** xanh bằng một bản vá *"chặn tất"*.

### 3.3 Đột biến (`accessControl.ts`, chèn `if (true) return next({ ctx });` **trước** `if (!hasAccess)`)

* Ca ĐỎ: `Factory Router › should reject non-admin from creating factory`
* Thông điệp: `vai user TẠO ĐƯỢC nhà máy ⇒ cổng RBAC đã biến mất: expected null not to be null`
* **Đối chứng dương:** hoàn nguyên ⇒ **16/16 XANH** (trước lượt vá: `1 failed | 15 skipped`).

---

## 4. Mục 4 — nửa còn lại của I-3

### 4.1 Đọc dàn chứng minh Task 5 TRƯỚC khi sửa (đúng yêu cầu brief)

`totpLedgerDurable.test.ts` (16 ca) + `totpReplay.test.ts` (13 ca). Đo bằng cách **chạy thử bản vá**:
đúng **3 ca** vỡ — dưới ngưỡng *">5 ⇒ DỪNG"*.

### 4.2 Bản vá — CẢ HAI hàm cùng lúc, không vá một nửa

`nowMs` bị **gỡ khỏi chữ ký** của `tieuMaTrongSo` **và** `donSo`; `expiresAt` và cả hai phép so hạn
đọc `dongHoSo()` = `now()` của Postgres.

> **Đo được khi thử vá một nửa** (và vì sao không được): ghi `expiresAt` bằng đồng hồ DB trong khi
> `donSo` còn so bằng đồng hồ NGƯỜI GỌI ⇒ một lưới lái đồng hồ +1h **xoá ngay** mục vừa ghi của
> chính nó (`real+120s <= real+3600s`), đỉnh sổ = **1**. Hai đồng hồ dưới một bất biến là đúng lớp
> lỗi cả chuỗi pha đang trả nợ.

`nowMs` **vẫn còn** ở chữ ký công khai `verifyTotpOnce` nhưng nay **chỉ** lái đồng hồ `speakeasy`;
`@param` được viết lại đúng phạm vi mới.

### 4.3 Bất biến được NEO — `totpLedgerDurable.test.ts` §I-3b (4 ca)

> *"Một lượt gọi với đồng hồ lệch KHÔNG đổi được kết quả của người khác, và KHÔNG kéo dài/rút ngắn
> hiệu lực của chính mã mình."*

1. **HÀNH VI** — đồng hồ +1h ⇒ `expiresAt` **đọc từ DB** nằm trong `[dbNow, dbNow + HẠN + 5 s]`
   (trước bản vá: `dbNow + 1h + 120 s`). Cận dưới bắt bản vá *"ghi một mốc quá khứ"*.
2. **HÀNH VI** — đồng hồ +1h **KHÔNG thu lại được** mục CÒN SỐNG của chính mình ⇒ vẫn `phatLai`.
3. **CẤU TRÚC (AST, không đọc bình luận)** — chữ ký hai hàm không có tham số thời gian, **kèm đối
   chứng dương** chứng minh bộ dò THẤY một chữ ký còn `nowMs`.
4. **∀ điểm gọi SẢN XUẤT** của `verifyTotpOnce`: KHÔNG truyền `nowMs` (đo: **10** điểm, **0** vi phạm).

### 4.4 Ba ca dàn chứng minh phải đổi — và chúng MẠNH LÊN

| File | Ca | Đổi |
|---|---|---|
| `totpLedgerDurable` | `★★★ đỉnh nhiều mục ⇒ sau khi quá hạn, một lượt ghi kéo về ĐÚNG 1` | "nhảy qua hạn bằng `nowMs`" → **làm già hàng trong DB** |
| `totpLedgerDurable` | `★★★ ĐỐI CHỨNG DƯƠNG — lượt dọn VẪN dọn` | như trên |
| `totpReplay` | `★★★ mục quá hạn bị xoá ở lượt ghi kế tiếp` | như trên |

`UPDATE "totp_consumed" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second'` — ca
thôi phụ thuộc vào việc **người gọi có nói thật về giờ hay không**, và đo đúng đồng hồ phép dọn thật
sự đọc. **+1 ca thứ tư được SIẾT** (không phải sửa): I-3 *"…vẫn KHÔNG chạm người khác"* nay có cầu
chì `demCua(USER_BA) === 1` — trước đó nó xanh vì *"chẳng ai dọn gì"*, một chân lý rỗng.

### 4.5 Đột biến (chèn lại tham số `nowMs` vào `tieuMaTrongSo` + dùng nó cho `expiresAt`)

| Tên ca ĐỎ | Thông điệp |
|---|---|
| `★★★★ đồng hồ +1h ⇒ expiresAt vẫn bám ĐỒNG HỒ DB, không bám đồng hồ người gọi` | `expiresAt (1786553008978) vượt trần đồng hồ DB (1786549413995)` |
| `★★★★ THEO CẤU TRÚC — nowMs không còn ĐƯỜNG NÀO tới sổ (AST, không đọc bình luận)` | `expected ['userId','tokenHash','luot',…(1)] to deeply equal ['userId','tokenHash','luot']` |

**Đối chứng dương:** hoàn nguyên ⇒ **20/20 XANH**.

---

## 5. Mục 5 — hạn cookie phiên

### 5.1 Đo sống TRƯỚC bản vá (máy chủ PID 36248, `POST /api/trpc/auth.login`, `engineer1` #51)

```
Set-Cookie: app_session_id=…; Max-Age=31536000; Expires=Thu, 12 Aug 2027 15:42:43 GMT
JWT { "exp": 1818085363 }  →  2027-08-12  →  TTL = 365,00 ngày
```

**⚠ PHÁT HIỆN NGOÀI BRIEF.** `SESSION_TTL_DAYS` không phải *"có sẵn nhưng chưa đặt"* — nó là **MÃ
CHẾT**. `signSession` chỉ dùng nó làm **mặc định** (`options.expiresInMs ?? …`), trong khi **cả
bốn** cửa đúc vé phiên truyền `expiresInMs: ONE_YEAR_MS` **tường minh**
(`authService.establishSession` · `oauth.ts` ×2 · `samlProvider.ts`). ⇒ Đặt biến ấy vào `.env`
**không đổi được một giây nào**. Người vận hành sẽ đặt nó, đọc lại tài liệu, và **tin rằng mình đã
siết** — một *"hàng rào không ai canh"* ở dạng tệ nhất: nó **trông như** một nút điều khiển.

### 5.2 Con số đã chọn: **30 ngày** — và lý do

1. **Repo ĐÃ chọn 30 ngày một lần rồi.** Thẻ Bearer của `/api/external/auth/login`
   (`_core/index.ts:1930`) dùng `30 * 24 * 60 * 60 * 1000`. Lấy cùng con số là **hợp nhất** hai bề
   mặt, thay vì đẻ ra con số thứ ba.
2. **Chính bình luận cũ ở `signSession` khuyến nghị `7–30 ngày`.** 30 là **đầu thận trọng** của
   khoảng ấy — ít rủi ro hồi quy nhất, mà vẫn cắt cửa sổ khai thác **12 lần** (365 → 30).
3. **Phiên KHÔNG gia hạn trượt.** `verifySession` chỉ kiểm `exp`; không cửa nào đúc lại vé cho một
   người đang dùng ⇒ TTL là hạn **TUYỆT ĐỐI** kể từ lúc đăng nhập, không phải *"30 ngày không hoạt
   động"*. Với nhà máy — ca kíp, trạm HMI dùng chung — **7 ngày = mỗi tuần một lượt đăng nhập lại
   trên mọi trạm**, đúng loại ma sát đẩy người vận hành sang **dùng chung tài khoản**. 30 ngày ≈
   **một lượt/tháng/thiết bị**.
4. **TTL là CẬN TRÊN cho một phiên KHÔNG AI ĐỂ Ý**, không phải cơ chế thu hồi. Ba cơ chế thu hồi có
   hiệu lực **NGAY** đã có: `chanNeuPhienDaThuHoi` (tra sổ mỗi request — Pha 8 C-1 + Pha 9 A2),
   `revokeAllSessions` khi tắt tài khoản (Pha 9 C-1), và `session.revoke` thủ công.

**KHÔNG chạm** thẻ Bearer của API ngoài: đó là **hợp đồng đã tài liệu hoá**
(`docs/API_REFERENCE.md` + OpenAPI, client thật `FactoryAlertSystem`), nên hạn của nó là một quyết
định sản phẩm — khai vào `HAN_RIENG` kèm lý do.

### 5.3 Bản vá

Chủ duy nhất `server/_core/hanPhien.ts` (`hanPhienMs()` + `HAN_PHIEN_MAC_DINH_NGAY = 30`), đọc
`process.env` ở **mỗi lượt gọi**; giá trị rác (`""` · `"0"` · `"-1"` · `"abc"` · `"Infinity"`) rơi về
mặc định, **không** thành hạn 0 giây (*một cấu hình gõ sai không được biến thành nhà tù*).
Bốn cửa đúc **gỡ** `expiresInMs` tường minh và dùng `hanPhienMs()` cho **cả ba** thứ: `exp` của JWT,
`maxAge` của cookie, `expiresAt` của hàng sổ. `sessionRouter.ts` `TODO(doc 12 §12.5)` **ĐÓNG**.

### 5.4 NGHIỆM THU SỐNG sau triển khai lại (PID **12860**, `GET /` = **200**, đúng **1** tiến trình)

| Phép đo | Kết quả |
|---|---|
| Cookie đúc **TRƯỚC** triển khai (exp 2027) ⇒ `auth.me` | **`id: 51`** — phiên đang sống **KHÔNG ĐỨT** |
| Đối chứng âm (không cookie) ⇒ `auth.me` | `null` (⚠ mã trạng thái là thước hỏng — đếm `id`) |
| Đăng nhập MỚI ⇒ `Set-Cookie` | `Max-Age=2592000` = **30,00 ngày** · `Expires=Fri, 11 Sep 2026` |
| Đăng nhập MỚI ⇒ JWT `exp` | `2026-09-11T15:55:43Z` = **30,00 ngày** |
| Hàng sổ MỚI (`session.list` id 312) | `expiresAt` = **30,00 ngày** |
| Hàng sổ CŨ (311 · 306 · 276 · 275 · 274) | **364,99 / 364,86 / 361,97 …** — **không hàng nào bị chạm** |

⇒ *"Chỉ ảnh hưởng cookie MỚI"* **đo được**, không suy: không có lượt siết **hồi tố** nào.
**Dọn:** `session.revoke` cho cả hai phiên do lượt đo tạo (311, 312); kiểm lại **cả hai** cookie ⇒
`auth.me` = `null`; `GET /` = **200**.

### 5.5 Đột biến (chèn `expiresInMs: 365 * 24 * 60 * 60 * 1000` vào `establishSession`, dòng 419)

* Ca ĐỎ: `★★★★ ∀ cửa đúc vé phiên: KHÔNG tự khai expiresInMs (trừ hạn riêng ĐÃ KHAI)`
* Thông điệp: `expected 'server/_core/authService.ts:417 trong…' to be ''`
* **Đối chứng dương:** hoàn nguyên ⇒ **17/17 XANH**.

---

## 6. Trạng thái cổng ra — **XANH HOÀN TOÀN**

| Cổng | Kết quả |
|---|---|
| §Cổng kiểm chung (**56** đường) | **158 file / 2.470 ca — 0 đỏ** (55,8 s) |
| Cùng danh sách + `--sequence.shuffle.tests` | **158 file / 2.470 ca — 0 đỏ** (54,6 s) |
| `npm run check` | exit 0 |
| `npm run check:tests` | exit 0 |
| `npm run i18n:check` | 0 lệch placeholder · 0 khoá MỚI thiếu · 0 mục nền rữa |

`xacThucBeMatRest.test.ts` và `authService.test.ts › F9-Minor` — **không** quá hạn ở lượt này (cả hai
xanh trong cả hai lượt chạy cổng). **Không ngưỡng nào bị nới.**

### `CONG` / `FILE_CANH` — đọc SỐ THẬT bằng cách để cổng đỏ

Không tin con số brief đưa (55/119). Thêm `server/_core/neoTenXacThuc.test.ts` vào §Cổng kiểm chung
rồi chạy `vramPha5Gate.test.ts`:

```
expected 56 to be 55     ← CONG
expected 120 to be 119   ← FILE_CANH  (+ server/services/vram/wiring.trainers.test.ts)
```

⇒ **`CONG` 55 → 56** · **`FILE_CANH` 119 → 120**.

---

## 7. Nợ MỚI (khai ra, không để ngầm)

1. **Hình dạng phân giải danh tính THỨ TƯ** vẫn ngoài lượng từ: một `db.select().from(userSessions)`
   thô rồi tra `users`. Đo được **0** chỗ trong `server/**` sản xuất hôm nay — nhưng đó vẫn là một
   **quan sát**, đúng như câu vừa được đóng ở nửa 1. Đóng nó cần một bộ nhận diện đọc **bảng** chứ
   không đọc **tên hàm**.
2. **`errors.DB_UNAVAILABLE` nay là câu người dùng thấy cho lớp 500** của 7 tuyến REST. Câu hiện có
   (*"Không kết nối được cơ sở dữ liệu…"*) đúng cho nguyên nhân phổ biến nhất nhưng **hẹp hơn** lớp
   lỗi thật (*"một lỗi không phải phán quyết của tầng xác thực"*). Một mã riêng
   `AUTH_BACKEND_ERROR` sẽ chính xác hơn — cần thêm khoá ở 3 locale ⇒ để chủ dự án quyết.
3. **`AILocalChatBubble.tsx`** ném `HTTP ${res.status}` và **không** đọc `code`, nên nó không hưởng
   lượt bản địa hoá của M-4. Đo được: nó rơi về đường `ask` rồi hiện câu chung. Không sửa trong lượt
   này vì đó là một đường xử lý lỗi **khác hẳn** (có fallback hai nấc) — sửa nó là một quyết định UX.
4. **`_core/index.ts` (thẻ Bearer API ngoài)** giữ hạn riêng 30 ngày viết thẳng tại chỗ, **ngoài**
   tầm `SESSION_TTL_DAYS`. Hôm nay hai con số trùng nhau nên không ai thấy; ngày người vận hành đặt
   `SESSION_TTL_DAYS=7`, hai bề mặt sẽ lệch. Đã ghim vào `HAN_RIENG` kèm lý do ⇒ lệch **nói ra
   được**, nhưng **chưa được quyết**.
5. **Phiên không gia hạn trượt.** Với 30 ngày tuyệt đối, một người dùng hằng ngày vẫn bị đá ra mỗi
   tháng. Gia hạn trượt (đúc lại vé khi còn < N ngày) là lời giải đúng và là một **đổi hành vi
   phiên** ⇒ chủ dự án quyết.

---

## 8. Commit

```
32c92a5f  fix(vram/pha9): I-5 — bộ nhận diện biết HÌNH DẠNG THỨ BA, và tên xác thực phải NHẬP từ chủ
db5f9663  fix(vram/pha9): M-4 — 7 tuyến REST: BA lớp mã trạng thái, không một lớp; câu người dùng thấy qua i18n
32e6e57d  fix(vram/pha9): api.test.ts "reject non-admin" — sửa KỲ VỌNG, hành vi sản phẩm ĐÚNG
489ed1aa  fix(vram/pha9): I-3 nửa còn lại — đồng hồ của SỔ là đồng hồ của DB, `nowMs` không chạm sổ nữa
9f055d8e  fix(vram/pha9): hạn phiên 365 → 30 ngày, một chủ — và `SESSION_TTL_DAYS` thôi là MÃ CHẾT
```

**KHÔNG** DDL / migration / seed / `kb:sync` / cấp quyền. **KHÔNG** đổi mật khẩu / cờ / vai / quyền /
dữ liệu của ai (hai lượt `session.revoke` là dọn đúng hai phiên do lượt đo tự tạo).
`git diff --cached --name-only` được xác nhận trước **mỗi** lượt commit; ~245 mục dirty ngoài phạm vi
**không bị chạm**.
