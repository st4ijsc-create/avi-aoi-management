# Đợt F — Ngang hàng Claude Code: đăng nhập trong khung, thanh công cụ, đúng vị trí

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development`. Các bước dùng `- [ ]`.

**Mục tiêu:** Người dùng mở VSCode, thấy AI Local **ở đúng chỗ họ để Claude Code**, **đăng nhập
ngay trong khung**, và có **thanh công cụ** (chat mới · lịch sử) — không phải nhớ lệnh nào.

**Kiến trúc:** Không viết lại gì. Ba việc đều là *lối vào*: manifest khai thêm vùng chứa, webview
thêm trạng thái đăng nhập, và một lớp lưu hội thoại bền. Toàn bộ logic chat giữ nguyên
(`BangChat`), đúng kỷ luật một-nguồn-sự-thật đã giữ suốt năm đợt.

**Nền:** VSCode · TypeScript · esbuild · vitest · `@vscode/test-electron`.

---

## Hiện trạng ĐÃ ĐO (2026-09-03) — không đoán

| Sự thật | Bằng chứng |
|---|---|
| Thanh bên **đã chạy**: icon hiện, khung mở, gõ được câu hỏi | ảnh người dùng + host thật: mở bằng `<viewId>.focus` không ném lỗi |
| `htmlBang.ts` có **0** chỗ nhắc đăng nhập | `grep -c` = 0 ⇒ khung báo "chạy lệnh AI Local: Đăng nhập" rồi **bỏ mặc** |
| Đăng nhập **chỉ có ở bảng lệnh** | `extension.ts:151` đăng ký `aviAiLocal.dangNhap` |
| `this.lichSu` **chỉ trong RAM** | `bangChat.ts:152` — không `globalState`, không `workspaceState` |
| Extension ta khai **chỉ** `viewsContainers.activitybar` | `vscode-extension/package.json` |
| Claude Code khai **`viewsContainers.secondarySidebar`** + bản lùi `activitybar` chọn bằng `when` | đọc manifest `anthropic.claude-code-2.1.259` đang cài |
| Claude Code có **`menus.view/title` RỖNG** ⇒ đồng hồ và dấu `+` là **nó tự vẽ trong webview** | cùng manifest |

★ Vì `view/title` là đường **native** của VSCode (icon thật ở thanh tiêu đề khung, dùng chung cho
mọi vùng chứa, ít mã hơn), Đợt F **chọn `view/title`** thay vì bắt chước cách tự vẽ.

## Ràng buộc toàn cục

- ★★★ **KHÔNG mở đường ghi mới.** Census giữ **22/22**: đúng MỘT `applyEdit`/`WorkspaceEdit` tại
  `ui/apBanVa.ts`, lệnh ghi `fs.*` = **0**.
- ★★★ **KHÔNG chép bản sao thứ hai** của HTML hay logic chat. Mọi thứ đi qua `BangChat`.
- Lưới hiện **486 xanh** — phải xanh, cộng ca mới. `ext:check` sạch.
- `src/loi/` **không** import `vscode`. Tên hàm tiếng Việt không dấu; bình luận nói **VÌ SAO**.
- ★★★ **Vá xong kiểm NHÁNH KIA.** ★★★ **Đo KẾT CỤC người dùng thấy**, không đo cơ chế.
- **COMMIT SURGICAL** — `git add` từng đường dẫn (có tiến trình song song trên nhánh này).
- KHÔNG sửa `.env`, KHÔNG migration, KHÔNG ghi `sandbox-projects/`, KHÔNG commit `.vscode-test/`.
- ⚠ **KHÔNG chạy `npm run test-that` khi người dùng đang làm việc** — nó mở cửa sổ VSCode thật và
  đã từng làm treo extension host của họ. Xin phép trước.

---

## Task 1 — Đăng nhập NGAY TRONG KHUNG

**Tệp:** sửa `src/ui/htmlBang.ts`, `src/ui/bangChat.ts`; lưới `src/ui/htmlBang.unit.test.ts`.

Hiện khung hiện chữ "LỖI: Chưa đăng nhập — chạy lệnh AI Local: Đăng nhập" rồi **bỏ mặc**. Đó là
ngõ cụt: người dùng không biết bảng lệnh ở đâu, và đó đúng là chỗ họ mắc kẹt.

- [ ] **B1:** lưới cho `htmlBang`: chưa đăng nhập ⇒ HTML chứa **nút "Đăng nhập"**; đã đăng nhập ⇒
      **không** có nút đó (nhánh kia).
- [ ] **B2:** nút gửi tin `{loai:"dangNhap"}` lên extension; extension gọi **đúng `chayDangNhap`
      sẵn có**. Đừng viết luồng đăng nhập thứ hai.
- [ ] **B3:** đăng nhập xong, khung **tự cập nhật** sang trạng thái đã đăng nhập **không cần
      đóng/mở lại**. ★ Đây là kết cục người dùng thấy — lưới phải khẳng định nó.
- [ ] **B4:** ★ **Câu hỏi đang gõ dở KHÔNG được mất** khi đổi trạng thái. Lưới cho nó.
- [ ] **B5:** khi đã đăng nhập, hiện **tên tài khoản** + nút **Đăng xuất**.
- [ ] **B6:** ★★★ **KHÔNG hiện, KHÔNG lưu mật khẩu trong webview.** Mật khẩu chỉ đi qua
      `showInputBox({password:true})` như hiện tại; webview chỉ **kích hoạt** luồng đó. Thêm ca
      census: chuỗi mật khẩu không xuất hiện trong HTML dựng ra.
- [ ] **B7:** lưới + `ext:check` + census, commit.

## Task 2 — Lưu hội thoại BỀN (nền cho Task 3)

**Tệp:** tạo `src/loi/khoHoiThoai.ts` (thuần) + lưới; sửa `src/ui/bangChat.ts`.

`this.lichSu` chỉ trong RAM ⇒ đóng VSCode là mất. Không có phần này thì nút "Lịch sử" ở Task 3 rỗng.

- [ ] **B1:** kiểu và hàm **thuần** trong `src/loi/`: một `HoiThoai` gồm mã, tiêu đề, thời điểm,
      danh sách lượt; hàm sinh tiêu đề từ câu hỏi đầu (cắt gọn, **không cắt giữa ký tự tổ hợp
      tiếng Việt**). Lưới riêng.
- [ ] **B2:** lưu bằng **`context.workspaceState`** — hội thoại gắn với dự án đang mở, đúng thói
      quen lập trình. ★ Bình luận ghi rõ **vì sao không dùng `globalState`**.
- [ ] **B3:** ★★★ **Giới hạn dung lượng**: chặn trên số hội thoại **và** tổng ký tự, cắt cũ nhất
      trước. `workspaceState` không phải kho vô hạn. Lưới cho đúng ranh giới cắt.
- [ ] **B4:** ★★★ **KHÔNG lưu bí mật.** Hội thoại có thể chứa đoạn mã người dùng dán vào. Chạy qua
      đúng `cheBiMat` sẵn có **trước khi ghi**. Lưới: dán một khoá riêng PEM ⇒ đọc lại từ kho
      **không** thấy thân khoá. ★ Nhớ bài học: luật PEM là **đa dòng**.
- [ ] **B5:** khôi phục hội thoại gần nhất khi mở lại khung. **Nhánh kia**: kho rỗng hoặc hỏng ⇒
      mở bình thường, **không** ném lỗi. Lưới cho cả hai.
- [ ] **B6:** lưới + `ext:check` + census, commit.

## Task 3 — Thanh công cụ đầu khung: Chat mới + Lịch sử

**Tệp:** sửa `package.json` (`commands` + `menus.view/title`), `src/extension.ts`; mở rộng lưới
`src/ui/thanhBen.unit.test.ts` và `src/extension.unit.test.ts`.

- [ ] **B1:** khai hai lệnh có **codicon**: `aviAiLocal.chatMoi` dùng `$(add)` và
      `aviAiLocal.lichSu` dùng `$(history)`; đưa vào `menus.view/title` với
      `when: "view == aviAiLocal.bangChat"` và `group: "navigation"`.
- [ ] **B2:** ★★★ mở rộng lưới **ba mối nối bằng chuỗi** đã có: mọi `when: "view == X"` phải khớp
      hằng id trong mã, và mọi `command` trong `view/title` phải **thật sự được đăng ký**. Lệch ⇒
      nút hiện ra mà bấm không làm gì. **Đột biến hai chiều** bắt buộc.
- [ ] **B3:** "Chat mới": lưu hội thoại đang có vào kho (Task 2) rồi mở phiên trắng.
      ★ **Nhánh kia**: hội thoại **rỗng** thì đừng lưu một mục rỗng vào lịch sử.
- [ ] **B4:** "Lịch sử": `showQuickPick` liệt kê hội thoại đã lưu (tiêu đề + thời gian); chọn ⇒
      nạp lại vào khung. **Nhánh kia**: kho rỗng ⇒ thông báo tử tế, không phải danh sách trắng.
- [ ] **B5:** lưới + `ext:check` + census, commit.

## Task 4 — Đặt được ở ĐÚNG VỊ TRÍ Claude Code (thanh bên phụ)

**Tệp:** sửa `package.json`, `src/extension.ts`; lưới `src/ui/thanhBen.unit.test.ts`; lưới host
thật `test-real-host/suite/zzThanhBenKichHoat.test.ts`.

Người dùng để Claude Code ở **thanh bên phụ** và muốn AI Local nằm cùng chỗ. Đo được: Claude Code
khai `viewsContainers.secondarySidebar`, kèm bản lùi `activitybar`, phân biệt bằng `when` trên một
**context key** do chính extension đặt lúc kích hoạt.

- [ ] **B1:** ★ **ĐO TRƯỚC:** xác nhận `secondarySidebar` hợp lệ với **phiên bản VSCode người dùng
      đang cài** (đối chiếu `engines.vscode` của Claude Code và phiên bản VSCode thật). Không hợp
      lệ ⇒ **BÁO, đừng khai bừa**.
- [ ] **B2:** khai **cặp** vùng chứa như Claude Code: `secondarySidebar` (chính) + `activitybar`
      (lùi), phân biệt bằng `when` trên context key riêng của ta, đặt trong `activate()`.
- [ ] **B3:** ★★★ **HAI view id khác nhau** cho hai vùng chứa (Claude Code làm vậy), nên phải
      `registerWebviewViewProvider` **cả hai**. ★ Lưới ba-mối-nối phải mở rộng canh **cả cặp** —
      đây là chỗ dễ lệch nhất của cả đợt.
- [ ] **B4:** ★ **Nhánh kia**: chỉ **một** trong hai được hiện tại một thời điểm — hai biểu thức
      `when` phải là **phủ định của nhau**. Lưới khẳng định điều đó, không thì người dùng thấy
      **hai icon AI Local**.
- [ ] **B5:** lưới host thật: mở view ở vùng chứa đang hoạt động ⇒ không ném lỗi, `active=true`.
      ⚠ **Xin phép người dùng trước khi chạy `test-that`.**
- [ ] **B6:** lưới + `ext:check` + census, commit.

## Task 5 — Nghiệm thu bằng MẮT NGƯỜI DÙNG

- [ ] **B1:** dựng lại bundle + đóng gói `.vsix` + cài `--force`; **so hash SHA-256** bản build và
      bản cài; xác nhận `media/` và manifest mới **có trong bản cài**. (Bài học M2: thứ đã ship
      phải đúng là thứ vừa đo.)
- [ ] **B2:** viết **danh sách ngắn** cho người dùng, kèm **kỳ vọng thấy gì** từng bước: Reload
      Window → kéo AI Local sang thanh bên phụ → nút Đăng nhập trong khung → hỏi một câu → Chat
      mới → Lịch sử.
- [ ] **B3:** ghi `docs/superpowers/plans/2026-09-03-vscode-extension-dot-f-ket-qua.md`, **phần
      chưa xác minh ghi thẳng**.

---

## Nợ cũ vẫn mở (KHÔNG thuộc Đợt F, ghi để không quên)

1. ★★★ **Cmd+K không hiện thẻ duyệt** — gốc ở định tuyến máy chủ, vùng tiến trình khác đang sửa.
2. **Chưa tạo được tệp mới** (nợ có chủ ý từ Đợt C) — `apBanVa` từ chối rành mạch.
3. **Hai kiểu bịa còn lại** (PDCA vòng 7): model khai phạm vi công việc không có căn cứ. Một phần
   nằm ở **tầng trọng số model**, sửa ở prompt hay định tuyến không tới được.
4. **Tệp EOL lẫn lộn bị từ chối** (fail-closed, đúng thiết kế) — chưa có đường ghi cho chúng.
