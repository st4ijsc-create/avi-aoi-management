# Phân tích lượt trượt đêm 09/11: H-cs2, H-ts3, H-py3, py-dang-ky

do-model, 10/11. Viết cho chu-du-an-HST để chọn việc vá cho lô B/C (kế hoạch cải tiến §5 M4).

**Cách làm:** chấm lại từng câu trả lời thô (`D:/DO-AI/eval/…`) bằng chính `check.mjs` của bài. Kết quả đạt/trượt khớp 100 % với lượt đo. Riêng H-py3, mỗi câu trả lời còn được chạy đủ 8 case, mỗi case trong một tiến trình riêng, trần 5 s. Lý do: test của bài dừng ở assert hỏng đầu tiên, nên chỉ chấm lại thì không thấy được các case sau.

**Layer:**
- **L1 tri thức:** model không biết, hoặc biết sai, một sự thật của ngôn ngữ hay thuật toán.
- **L4 suy luận:** model có đủ tri thức nhưng áp sai đặc tả, sai điều khiển luồng, hoặc bỏ sót case biên.
- **Đề:** đặc tả mơ hồ, nên kỳ vọng của test ẩn không suy ra được chắc chắn từ đề.

Layer chỉ là **nghi ngờ** dựa trên mã đọc được, chưa kiểm bằng can thiệp (ví dụ thêm tri thức vào ngữ cảnh rồi đo lại).

## Tóm tắt

| Bài | Trục | Kết quả | Một nguyên nhân chung? | Layer nghi ngờ | Việc vá gợi ý |
|---|---|---|---|---|---|
| H-cs2 | H | 0/3 | Có: gọi phương thức `private` của lớp lồng từ lớp ngoài (CS0122) | **L1** (luật truy cập C#) | Tri thức: lớp ngoài không gọi được thành viên `private` của lớp lồng. Xem thêm vì sao trục H luôn dùng lớp lồng |
| H-ts3 | H | 0/3 | Có: trả mọi nút còn lại sau Kahn, gồm cả nút chỉ nằm sau chu trình | **L4** (1/3 kèm L1) | Suy luận theo đặc tả "NẰM TRONG chu trình"; tri thức SCC/Tarjan |
| H-py3 | M ×18 + H ×3 | M 5/18, H 0/3 | Không: 4 kiểu lỗi | **L4** | Suy luận case biên `'""'` với `'a,b\n'` và điều khiển vòng lặp |
| py-dang-ky | agent-f | 0/3 | Có: cùng một assert ẩn, 3/3 lượt | **Đề** + L4 | Đề cần nói rõ `thanh_cong` không có bản tiếng Anh, hoặc sửa test |

## H-cs2 (C#, tính biểu thức) trục H 0/3

Test: `scripts/ai-eval/codegen-chay-duoc/tasks-hard.json` `H-cs2`. Cả ba lượt hỏng ở bước biên dịch, chưa chạy tới assert nào.

| Lượt | Lỗi | Layer nghi ngờ | Bằng chứng |
|---|---|---|---|
| H#1 | CS0122 `Parser.ParseExpression()`, `Parser.SkipWhitespace()` không truy cập được | L1 | `Tinh` (lớp ngoài) gọi `p.SkipWhitespace()`, trong khi hàm này khai `private` trong `private class Parser` |
| H#2 | CS0122 `ExpressionParser.ParseExpression()`, `SkipWhitespace()` | L1 | Cùng mẫu, lớp lồng tên `ExpressionParser` |
| H#3 | CS0122 `Parser.ParseExpression()` | L1 | Cùng mẫu |

**Đối chứng trục M** (6 câu trả lời của C3 08/11 và lượt bỏ 09/11, chấm lại): 2/2 câu có lớp lồng đều trượt, 4/4 câu không có lớp lồng đều đạt. Vậy thuật toán không phải chỗ hỏng; hỏng là luật truy cập của C# (thành viên `private` của lớp lồng chỉ lớp lồng thấy, lớp ngoài không thấy). Model viết đúng parser nhưng tin sai luật này. Đây là L1.

**Còn mở:** trục H dùng lớp lồng 3/3, trục M chỉ 2/6. Có thể ngữ cảnh của đường sản phẩm (RAG, lời nhắc hệ thống, ví dụ C# trong tài liệu) đẩy model sang lớp lồng. Chưa kiểm. Muốn biết thì so lời nhắc và ngữ cảnh RAG của một lượt H-cs2 trên hai trục.

## H-ts3 (TypeScript, sắp xếp topo) trục H 0/3

Cả ba lượt hỏng cùng một test `phat hien chu trinh`: `f([['a','b'],['b','c'],['c','a'],['c','d']])`, kỳ vọng `chuTrinh = ['a','b','c']`, cả ba đều trả `['a','b','c','d']`.

| Lượt | Assert hỏng | Layer nghi ngờ | Bằng chứng |
|---|---|---|---|
| H#1 | `phat hien chu trinh`: thừa `d` | L1 + L4 | Chú thích của model: "các nút còn lại chính là nút nằm trong chu trình (tính chất đồ thị có hướng)". Đây là một sự thật sai: phần dư sau Kahn gồm cả nút chỉ nằm sau chu trình |
| H#2 | như trên | L4 | Model tự ghi "thuộc chu trình **(hoặc phụ thuộc trực tiếp vào chu trình)**" nhưng vẫn trả cả nhóm, ngược đặc tả "NẰM TRONG chu trình" |
| H#3 | như trên | L4 | "thuộc chu trình **(hoặc reachable từ chu trình)**", cùng kiểu với H#2 |

Ba test còn lại (thứ tự nhỏ nhất, song song, rỗng) đều qua. Trục M baseline 08/11 được 2/6 trên bài này.

## H-py3 (Python, đọc CSV RFC4180) trục M ×18 và trục H ×3

Thứ tự 8 case: (1) `'a,b\nc,d'` · (2) nháy chứa phẩy · (3) nháy chứa xuống dòng · (4) nháy kép đôi · (5) `''` · (6) `'a,,b'` · (7) `'""'` → `[['']]` · (8) `'a,b\n'` → `[['a','b']]`.

| Lượt | Case lệch (giá trị trả) | Assert hỏng đầu tiên | Layer nghi ngờ | Bằng chứng |
|---|---|---|---|---|
| M#1, M#3, M#6, M#8, M#9, M#11, M#18, H#2 | chỉ (7): `[]` | dòng 8 `f('""')` | L4 | Điều kiện chốt dòng cuối kiểu "còn ô hoặc dòng thì thêm" bỏ mất ô nháy rỗng; cần nhớ đã gặp ô nháy |
| M#4, H#1, H#3 | chỉ (8): `[['a','b'],['']]` | dòng 9 `f('a,b\n')` | L4 | Ngược lại: luôn chốt dòng cuối nên sinh thêm dòng rỗng sau `\n` cuối |
| M#10 | (1): `[['a','b']]` | dòng 2 | L4 | Nhánh `\n` không thêm dòng vào kết quả (chỉ nhánh `\r\n` làm đúng) |
| M#15 | (1): `[['a'],['c','d']]`; (8): `[['a']]` | dòng 2 | L4 | Mất ô cuối của dòng trước `\n` |
| M#17 | 7/8 case lệch, ví dụ (1) `[['',''],['','']]` | dòng 2 | L4 | Vòng lặp thiếu nhánh `else` cho ký tự thường ngoài nháy, nên mọi ô không nháy rỗng |
| M#7 | (1), (8) treo >5 s; (7) lệch | treo (lượt đo: "Command failed") | L4 | Nhánh `\n` không tăng `i`, lặp vô hạn |
| M#13 | (1), (8) treo >5 s | treo | L4 | Như M#7: nhánh `elif c == '\n'` thiếu `i += 1` |
| M#2, M#5, M#12, M#14, M#16 | không lệch | — | — | Đạt |

**Nhận xét:**
- Không lượt nào trượt vì thiếu tri thức RFC4180: nháy, nháy kép đôi và xuống dòng trong ô đều đúng ở 12/13 lượt trượt trục M.
- 11/16 lượt trượt (M và H gộp lại) chỉ lệch đúng một trong hai case biên mâu thuẫn nhau: `'""'` (phải giữ dòng) và `'a,b\n'` (phải bỏ dòng rỗng). Muốn qua cả hai, phải theo dõi trạng thái "đã bắt đầu một ô"; model thường chỉ xử lý được một phía.
- 5 lượt còn lại (M#7, M#10, M#13, M#15, M#17) hỏng điều khiển vòng lặp: thiếu tăng chỉ số, thiếu nhánh.
- Gợi ý vá: L4, ví dụ bước tự kiểm case biên trước khi trả, hoặc tự chạy test của chính mình (vòng tự sửa). Thêm tri thức không có ích ở bài này.

## py-dang-ky (agent-f, Python) 0/3

Cả ba lượt đạt 13/14 test và hỏng cùng một test ẩn `tests/test_an_f_dang_ky.py:72`, hàm `test_an_thong_diep_hai_ngon_ngu_va_du_phong`:

```
assert t("thanh_cong", "en", ma="DK-0001") == "Đăng ký thành công, mã của bạn là DK-0001"
# model trả: "Registration successful, your code is DK-0001"
```

| Lượt | Assert hỏng | Layer nghi ngờ | Bằng chứng |
|---|---|---|---|
| 1 (run 3b2ade63) | dòng 72: `thanh_cong` tiếng Anh phải rơi về tiếng Việt | Đề + L4 | Model tự thêm bản dịch tiếng Anh cho `thanh_cong` |
| 2 | như trên | Đề + L4 | như trên |
| 3 | như trên | Đề + L4 | như trên |

`prompt.md` mục 2 nói "thêm tiếng Anh" rồi đưa "Bảng thông điệp (vi / en)" gồm 7 khoá. Bảng không có `thanh_cong` nhưng cũng không nói khoá này phải thiếu bản tiếng Anh. Câu "Khoá thiếu trong ngôn ngữ đã chọn … thì dùng tiếng Việt" chỉ mô tả cơ chế dự phòng. Test ẩn ngầm cần "`thanh_cong` không có tiếng Anh" để thử cơ chế đó.

Dịch cả `thanh_cong` khi được giao "thêm tiếng Anh" là cách đọc hợp lý, và 3/3 lượt cùng chọn như vậy. Vì thế tôi xếp **Đề** trước, L4 (không bám đúng bảng) sau.

**Gợi ý:** sửa đề (thêm "`thanh_cong` chưa có bản tiếng Anh, giữ nguyên") hoặc đổi test dùng một khoá chắc chắn không có trong bảng. Cả hai đều đổi thước đo, nên cần chu-du-an-HST quyết, và baseline agent-f sẽ phải ghi rõ trước/sau.

## Tệp và cách chạy lại

- **Câu trả lời thô:**
  - `D:/DO-AI/eval/2026-11-09-truc-h-baseline/`
  - `D:/DO-AI/eval/2026-11-09-h-py3-x18/`
  - Đối chứng H-cs2 trục M: `D:/DO-AI/eval/2026-11-08-c3-model-thuan/`, `…/2026-11-09-c3-bo-kho-them2/`
- **Báo cáo agent-f:** `scripts/ai-eval/codegen-chay-duoc/reports/run-eval-2026-11-09-agent-f-baseline-py-dang-ky-1.json` (gitignore), trường `rows[].cham.duoiRa`.
- **Chấm lại một câu:** `node scripts/ai-eval/tasks/<stack>/<id>/check.mjs --tra-loi <tệp>`; dòng JSON cuối có trường `loi`.
