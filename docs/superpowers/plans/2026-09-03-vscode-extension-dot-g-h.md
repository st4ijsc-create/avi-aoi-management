# Đợt G (giao diện) + Đợt H (MCP & bộ nhớ) — AI Local ngang hàng công cụ thương mại

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development`. Các bước dùng `- [ ]`.

**Mục tiêu:** Khung AI Local gọn và dùng được như Claude Code (Đợt G), rồi nối được **plugin MCP**
và có **bộ nhớ thật** (Đợt H).

---

# PHẦN 0 — ĐÁNH GIÁ HIỆN TRẠNG (đo ngày 2026-09-03, không đoán)

## Yêu cầu 1 — giao diện

| Mục | Hiện trạng ĐO ĐƯỢC | Kết luận |
|---|---|---|
| Nút "Đăng nhập" | Nút xanh to, chiếm nguyên hàng đầu khung | **Xấu** — đúng như người dùng nói |
| Ô chọn thư mục `LOCAL · d:\...` | Dựng trong `htmlBang.ts`, gửi `doi_du_an` | **Thừa ở chế độ LOCAL** — VSCode đã có workspace |
| Nút "Gửi" | Nút to cạnh ô nhập | **Nên thu nhỏ** |
| Chat mới / Lịch sử | ★ **ĐÃ CÓ** — `menus.view/title`, hiện ở góc trên phải (thấy trong ảnh người dùng: `+` và `⟲`) | **Có rồi**, chỉ khó nhận ra |
| Đính kèm tệp để đọc | ★ **CÓ MỘT PHẦN** — `@`-mention (22 chỗ trong `htmlBang.ts`, `locMention.ts`) | Thiếu **nút** đính kèm rõ ràng |
| Thanh trạng thái ngữ cảnh | ❌ **KHÔNG CÓ** — 3 chỗ `token` trong `htmlBang.ts` đều là token SSE, không phải kế toán cửa sổ ngữ cảnh | Phải làm mới |
| Cấu hình lệnh / gọi plugin | ❌ **KHÔNG CÓ** | Phụ thuộc Đợt H |
| Chọn quyền | ❌ **KHÔNG CÓ** (0 chỗ) | Phải làm mới |

## Yêu cầu 2 — MCP và bộ nhớ: **CHƯA hoàn thiện**, và thiếu theo hai hướng khác nhau

**MCP — có MỘT chiều, thiếu chiều còn lại:**

- ✅ **MCP *server* CÓ THẬT**: `server/services/aiCodingCli/mcpServer.ts` (411 dòng) — JSON-RPC 2.0
  trên stdio, `initialize` / `tools/list` / `tools/call`, tên `avi-coding-repo`, bản giao thức
  `2025-06-18`, có lưới `mcpGiaoThuc.test.ts`. Tức **ta phơi bộ tool repo RA cho client khác**
  (Claude Desktop, v.v.) — chiều này đã xong ở doc 83.
- ❌ Nhưng nó **chỉ nối vào CLI** (`batDau.ts`, `cli.ts`, `cauNoiCli.ts`). **Extension VSCode
  KHÔNG hề chạm tới** — không tệp nào trong `vscode-extension/src/` import nó.
- ❌ **MCP *client* KHÔNG TỒN TẠI**: không có chỗ nào để AI Local **gọi RA** một MCP server ngoài.
  Đây chính là thứ người dùng gọi là *"gọi plugin"*. **Chưa có gì cả.**

★ Nói gọn: ta **cho mượn** tool của mình được, nhưng **không mượn** được tool của ai.

**Bộ nhớ / ngữ cảnh — có hai lớp, thiếu lớp thứ ba:**

- ✅ **Tri thức repo (RAG)**: `knowledge/*.json`, phía máy chủ. Đây là *hiểu biết về mã*, không phải
  *trí nhớ về người dùng*.
- ✅ **Lịch sử hội thoại**: vừa làm ở Đợt F/T2 (`workspaceState`, theo dự án, có trần dung lượng,
  che bí mật trước khi ghi).
- ❌ **Bộ nhớ dài hạn**: không có dịch vụ, không có bảng. Grep `ai_memory` / `bo_nho_ai` /
  `longTermMemory` ⇒ **0**. AI **không nhớ** quyết định kiến trúc, quy ước dự án, hay sở thích của
  người dùng qua các phiên.
- ❌ **Kế toán cửa sổ ngữ cảnh**: không đếm, không hiển thị. Người dùng **không biết** mình còn bao
  nhiêu chỗ trước khi lịch sử bị cắt.

---

# ĐỢT G — Giao diện gọn, dùng được

## Ràng buộc toàn cục (áp cho CẢ hai đợt)

- ★★★ **KHÔNG mở đường ghi mới.** Census giữ **22/22**: đúng MỘT `applyEdit`/`WorkspaceEdit` tại
  `ui/apBanVa.ts`, lệnh ghi `fs.*` = **0**.
- ★★★ **KHÔNG chép bản sao thứ hai** của HTML hay logic chat. Mọi thứ qua `BangChat`.
- Lưới hiện **583 xanh** + host thật 23+17 — phải giữ xanh, cộng ca mới. `ext:check` sạch.
- `src/loi/` **không** import `vscode`. Tên hàm tiếng Việt không dấu; bình luận nói **VÌ SAO**.
- Webview có **CSP + nonce** — script mới thiếu nonce sẽ **im lặng không chạy**.
- ★★★ **Vá xong kiểm NHÁNH KIA.** ★★★ **Đo KẾT CỤC người dùng thấy**, không đo cơ chế.
- **COMMIT SURGICAL** — `git add` từng đường dẫn (có tiến trình song song trên nhánh này).
- KHÔNG sửa `.env`, KHÔNG migration (trừ Task H3 nêu rõ), KHÔNG ghi `sandbox-projects/`.
- ⚠ **Xin phép trước khi chạy `npm run test-that`** — nó mở cửa sổ VSCode thật.

## Task G1 — Dọn đầu khung: đăng nhập thành icon, bỏ ô chọn thư mục

- [ ] **B1:** ★★★ **Tự khôi phục phiên**: cookie đã nằm ở `context.secrets` (`KHOA_COOKIE`). Khi mở
      khung, nếu cookie còn hiệu lực ⇒ **vào thẳng trạng thái đã đăng nhập**, không hiện gì cả.
      Người dùng chỉ phải đăng nhập **lần đầu**. Lưới cho cả hai nhánh (có/không có cookie hợp lệ).
- [ ] **B2:** thay nút xanh to bằng **một icon nhỏ** ở góc khung (codicon `$(account)`), hiện
      **trạng thái** bằng màu/tooltip: chưa đăng nhập ⇒ bấm để đăng nhập; đã đăng nhập ⇒ tooltip
      hiện tên tài khoản, bấm để đăng xuất.
- [ ] **B3:** ★ **Ô chọn thư mục: ẨN ở chế độ LOCAL** (VSCode đã trỏ workspace rồi — hiện lại là
      thừa và chiếm chỗ). **GIỮ ở chế độ SERVER**, nơi chọn dự án là lựa chọn thật.
      ⚠ **NHÁNH KIA**: đừng xoá hẳn — chế độ SERVER vẫn cần. Lưới cho cả hai chế độ.
- [ ] **B4:** thu nhỏ nút **Gửi** thành icon (`$(send)`), giữ `Ctrl+Enter`. ★ Vẫn phải có nhãn cho
      trình đọc màn hình (`aria-label`) — nhỏ gọn không đồng nghĩa với vô danh.
- [ ] **B5:** lưới + `ext:check` + census, commit.

## Task G2 — Đính kèm tệp + thanh trạng thái ngữ cảnh

- [ ] **B1:** nút **đính kèm** (`$(new-file)`) mở bộ chọn tệp trong workspace, chèn đúng đường dẫn
      SẠCH như `@`-mention. ★ **Dùng lại `locMention` + `duocPhepRoiMay` + `cheBiMat`** — đây là
      một đường dữ liệu rời máy, **không được có cửa sau**. Lưới: chọn `.env` ⇒ **bị chặn**.
- [ ] **B2:** hiện **danh sách tệp đang đính kèm** dưới ô nhập, mỗi tệp có nút gỡ.
- [ ] **B3:** **thanh trạng thái ngữ cảnh**: ước lượng đã dùng bao nhiêu, còn bao nhiêu.
      ★★★ **KHÔNG BỊA SỐ.** Nếu không đo được token thật thì hiển thị **đơn vị đo được** (số ký tự,
      số tệp, số lượt) và **gọi đúng tên nó** — dự án này đã trả giá vì model bịa con số phạm vi.
      Nếu về sau có số token thật từ máy chủ thì đổi sang. Lưới khẳng định nhãn khớp thứ đang đếm.
- [ ] **B4:** cảnh báo khi sắp chạm trần lịch sử (kho `khoHoiThoai` đã có trần) — người dùng phải
      **biết trước** khi hội thoại bị cắt, không phải phát hiện sau.
- [ ] **B5:** lưới + `ext:check` + census, commit.

## Task G3 — Chọn quyền (chế độ tự trị)

Hôm nay mọi đề xuất ghi đều qua thẻ duyệt. Người dùng muốn **chọn mức**.

- [ ] **B1:** vị từ **thuần** trong `src/loi/` cho ba mức: **Chỉ đọc** · **Hỏi trước khi ghi**
      (mặc định, đúng hành vi hôm nay) · **Tự ghi trong workspace**.
- [ ] **B2:** ★★★ **Mức "Chỉ đọc" phải chặn ở `apBanVa.ts`** — điểm ghi DUY NHẤT — chứ không phải
      chỉ ẩn nút ở giao diện. Ẩn nút là trang trí; chặn ở điểm ghi mới là hàng rào.
      Lưới: đặt Chỉ-đọc rồi ép một đề xuất ghi ⇒ **đĩa không đổi một byte** (đọc lại bằng `node:fs`).
- [ ] **B3:** ★★★ Mức "Tự ghi" **KHÔNG được bỏ qua** các hàng rào an toàn đã có: `duocPhepGhi`
      (trong workspace), `camGhiRieng` (`.git/**`, `tasks.json`…), `duongThat` (symlink), và
      **fail-closed với tệp EOL lẫn lộn**. Nó chỉ bỏ **bước hỏi**, không bỏ **hàng rào**.
      Lưới cho từng hàng rào ở mức Tự-ghi.
- [ ] **B4:** ô chọn mức trong khung + nhớ theo workspace. ★ Mặc định **Hỏi trước khi ghi** cho
      workspace mới — an toàn là mặc định, không phải tuỳ chọn.
- [ ] **B5:** lưới + `ext:check` + census, commit.

---

# ĐỢT H — MCP client + bộ nhớ thật

## Task H1 — Nối extension vào MCP server SẴN CÓ

`mcpServer.ts` đã phơi bộ tool repo nhưng **chỉ CLI dùng được**.

- [ ] **B1:** ★ **ĐO TRƯỚC:** đọc `mcpServer.ts` + `cauNoiCli.ts` xác định **chính xác** bộ tool và
      yêu cầu danh tính (docblock nói cần "khoá tài khoản thật, audit thật, 2FA fail-closed" —
      thiếu là **mọi** `tools/call` trả lỗi). Ghi lại rồi mới thiết kế.
- [ ] **B2:** cho extension gọi được bộ tool đó. ★ **KHÔNG chép logic tool sang bản thứ hai** —
      nối vào đúng nguồn.
- [ ] **B3:** ★★★ Tool MCP chạy dưới **cùng** hàng rào gửi và **cùng** điểm ghi. Một tool MCP
      **không** được trở thành đường ghi thứ hai. Census phải giữ **22/22**.
- [ ] **B4:** lưới + census, commit.

## Task H2 — MCP *client*: gọi RA plugin ngoài (thứ hoàn toàn chưa có)

- [ ] **B1:** cấu hình danh sách MCP server ngoài (theo khuôn `mcpServers` quen thuộc), đọc từ
      **cấu hình máy** — ★ `scope: "machine"`, **không** cho workspace ghi đè. Bài học Đợt A: một
      repo thù địch sửa `.vscode/settings.json` là chiếm được đường dữ liệu.
- [ ] **B2:** client stdio JSON-RPC: `initialize` → `tools/list` → `tools/call`. ★ **Dùng lại khung
      dòng đã có** trong `mcpServer.ts`/`mcpGiaoThuc.test.ts` thay vì viết bộ phân tích thứ hai.
- [ ] **B3:** ★★★ **Tool ngoài là mã KHÔNG tin được.** Bắt buộc: người dùng **duyệt từng server**
      lần đầu · kết quả tool ngoài là **dữ liệu, KHÔNG phải lệnh** (không được để nó điều khiển
      vòng tác nhân) · có **trần thời gian** và **trần kích thước** đầu ra. Lưới cho cả ba.
- [ ] **B4:** ★★★ **Tool ngoài KHÔNG được ghi đĩa.** Chúng đi qua đúng con đường chỉ-đọc như ba
      tool cục bộ của Đợt D. Census giữ **22/22**.
- [ ] **B5:** giao diện: liệt kê server đã nối, bật/tắt từng cái, xem tool nào đang có.
- [ ] **B6:** lưới + census, commit.

## Task H3 — Bộ nhớ dài hạn (thứ chưa tồn tại)

- [ ] **B1:** ★ **Quyết định phạm vi lưu TRƯỚC KHI viết mã** và ghi lý do: bộ nhớ theo **dự án**
      (đi cùng repo, chia sẻ được với đồng nghiệp) hay theo **máy** (riêng tư)? Đề xuất: **theo dự
      án, lưu thành tệp trong repo** để đọc/sửa/review được bằng mắt — đúng văn hoá dự án này.
      Nếu chọn khác, nêu lý do đo được.
- [ ] **B2:** ★★★ **Bộ nhớ phải NHÌN THẤY và SỬA được.** Một bộ nhớ ẩn là một nguồn lỗi ẩn: khi AI
      trả lời sai vì nhớ sai, người dùng phải mở ra xem và sửa được. Có giao diện xem/xoá từng mục.
- [ ] **B3:** ★★★ **KHÔNG tự ghi bí mật vào bộ nhớ** — qua `cheBiMat` trước khi ghi, y như
      `khoHoiThoai`. Lưới: khoá PEM đa dòng ⇒ đọc lại không thấy thân khoá.
- [ ] **B4:** ★★★ **Bộ nhớ là dữ liệu, KHÔNG phải lệnh.** Nội dung nhớ được **không** được điều
      khiển hành vi tác nhân (một mục nhớ chứa "luôn tự ghi mọi tệp" không được vượt mặt chế độ
      quyền ở G3). Lưới cho đúng tình huống đó.
- [ ] **B5:** ghi nhớ **có chủ đích**: người dùng bảo nhớ thì mới nhớ, hoặc AI đề xuất và người
      dùng duyệt. ★ **Không tự động nuốt mọi thứ** — bộ nhớ tự động là bộ nhớ không ai kiểm được.
- [ ] **B6:** lưới + census, commit.

## Task H4 — Nghiệm thu LIVE + đo

- [ ] **B1:** đo **tỉ lệ thành công đầu-cuối** trên ≥10 tác vụ thật, dùng lại khuôn PDCA
      (`.claude/skills/pdca/SKILL.md`) — **bắt buộc Bước 0 (MSA)** và **ablation**.
- [ ] **B2:** ⚠ **Nhớ luật cache**: `KB_QA_CACHE_TTL_MS=1` và chứng minh mẫu độc lập, nếu không
      "lặp lại được" là ảo.
- [ ] **B3:** viết tệp kết quả, **phần chưa xác minh ghi thẳng**.

---

# Nợ cũ vẫn mở

1. ★★★ **Cmd+K chưa hiện thẻ duyệt** — gốc ở định tuyến máy chủ, vùng tiến trình khác đang sửa.
2. **Chưa tạo được tệp mới** (nợ có chủ ý từ Đợt C).
3. **Tệp EOL lẫn lộn bị từ chối** (fail-closed, đúng thiết kế).
4. **Model bịa phạm vi công việc** — một phần ở tầng trọng số, prompt/định tuyến không tới được.

---

# PHÁN QUYẾT 2026-09-04 — BỎ Task H1, đi thẳng H2

**Đo trước khi làm** (`mcpServer.ts` dòng 95+ so với `toolCucBo.ts` dòng 339+):

| MCP server phơi ra | Extension ĐÃ CÓ | Phạm vi |
|---|---|---|
| `avi_read_file` | `doc_tep` | MCP: hộp cát **máy chủ** (`AI_REPO_SANDBOX_ROOTS`) · Extension: **workspace máy lập trình viên** |
| `avi_list_files` | `liet_ke` | như trên |
| `avi_grep_repo` | `grep` | như trên |
| `avi_list_projects` | ô chọn dự án (đã có ở G1) | — |

⇒ **Trùng năng lực, khác phạm vi — và phạm vi của MCP server kém hữu ích hơn** cho người đang mở
dự án trong VSCode. Nối vào chỉ tạo **đường thứ hai cho cùng một việc**, đúng thứ "hai bản sao của
một sự thật" mà dự án này chống suốt (đã cắn ở `daBiTuChoiGhi`, `MA_GHI_MOT_PHAN`, `NHAN_HANG_RAO`).

**Task H1 BỎ.** Ghi lại đây để người sau không tưởng là quên. Nếu về sau extension cần đọc hộp cát
máy chủ (ví dụ chế độ SERVER muốn tự đọc), hãy mở lại món này **kèm lý do đo được**, đừng mở vì
"cho đủ bộ".

★ Yêu cầu gốc của người dùng — *"gọi plugin"* — là **MCP client** (H2), thứ **chưa tồn tại**. Đó
mới là món đáng làm.
