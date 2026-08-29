# `contracts/` — hợp đồng schema đã đóng băng / frozen schema contracts

**EN** — These three JSON Schemas are the contract between the .NET Spine branch and the web
Runtime/Editor branch. They were frozen at Milestone 0 precisely so those two branches could be built
in parallel without drifting apart. Changing one is not a normal edit.

**VI** — Ba file JSON Schema ở đây là hợp đồng giữa nhánh .NET Spine và nhánh web Runtime/Editor.
Chúng được đóng băng ở Mốc 0 để hai nhánh xây song song mà không lệch nhau. Sửa một file ở đây
KHÔNG phải một lần sửa bình thường.

## Luật đổi schema / How to change a schema

1. **Cộng thêm thì được, bỏ đi thì không** (additive only). Thêm property optional: được. Xoá
   property, đổi tên, đổi kiểu, siết ràng buộc: **phải tăng `schemaVersion`** và giữ đường đọc bản cũ.
2. **Đổi là đổi cả bốn chỗ, trong CÙNG một commit** — schema, fixture, record C#, type TypeScript.
   Test ghim hai chiều ở cả hai phía sẽ đỏ nếu thiếu bất kỳ chỗ nào. Đó là chủ ý.
3. **Fixture là một phần của hợp đồng.** Thêm property nghĩa là thêm/sửa ít nhất một fixture
   `valid/` dùng nó. Thêm ràng buộc nghĩa là thêm một fixture `invalid/` vi phạm đúng ràng buộc đó,
   và tên file phải nêu luật bị vi phạm.
4. **`$id` không phân giải được là cố ý.** `https://st4i.local/...` không tồn tại trên mạng. Sản phẩm
   này chạy offline tuyệt đối; không có gì được phép fetch một schema.

## Ràng buộc an toàn được mã hoá TRONG schema, không chỉ trong văn xuôi

`tag-namespace.schema.json` bắt buộc: một tag `access: "rw"` phải có `policyAction` khác null. Đây là
bất biến §5 của tài liệu thiết kế ("không có đường ghi không gác") viết thành luật máy kiểm được.
Fixture `invalid/tags-rw-without-policy-action.json` tồn tại để chứng minh luật ấy thật sự chặn.

`component-model.schema.json` bắt buộc thêm: một tag `role: "setpoint"` phải có `min`/`max` — dải chặn
cứng, không phải trang trí (`MACHINE_CONFIG_DESIGN.md §3`). Fixture
`invalid/components-setpoint-without-hard-band.json` tồn tại để chứng minh luật ấy thật sự chặn.

## Một document không bao giờ viết `null` tường minh / A document never writes an explicit `null`

**VI** — Một property optional vắng mặt (absent) CHÍNH LÀ `null` của nó — **không một schema nào trong
thư mục này** còn nhận `"type": ["X", "null"]` hay `null` trong `enum`; absent đã mang optionality rồi
(nó không có trong `required`). Câu luật này cố ý không đếm số schema (đợt viết đầu tiên nói "hai schema
này" khi corpus mới có hai file; corpus giờ có ba, và một câu đếm-số chỉ đúng tới lần thêm schema tiếp
theo — sửa "hai" thành "ba" sẽ chỉ đặt lại đúng cái bẫy đó cho file thứ tư). Đừng viết `"unit": null` —
hãy bỏ hẳn key `unit`. Lý do không chỉ là quy ước: `HmiContractJson.Options` phía .NET đặt
`WhenWritingNull`, nên phía C# **không bao giờ** có thể ghi ra một `null` tường minh — mọi document
schema-hợp-lệ mà chứa `null` tường minh sẽ round-trip thất bại ở phía C#, dù chính document đó hoàn toàn
hợp lệ theo schema. Bên TypeScript viết `"unit": null` là một cái bẫy tương thích giữa hai nhánh, không
phải một lựa chọn hợp lệ khác — schema giờ cấm nó bằng máy, không chỉ bằng văn xuôi.

**EN** — An absent optional property IS its null — **no schema in this directory** accepts
`"type": ["X", "null"]` or `null` in an `enum`; absence already carries the optionality (it is not in
`required`). This rule is deliberately count-agnostic (the first draft said "neither schema" when the
corpus held two files; the corpus now holds three, and a counted sentence is only correct until the next
schema lands — bumping "neither" to "none of the three" would just reset the same trap for a fourth
file). Never write `"unit": null` — omit the `unit` key entirely. This is not just convention: the .NET
side's `HmiContractJson.Options` sets `WhenWritingNull`, so the C# reference implementation can **never**
emit an explicit null — any schema-valid document containing one would fail to round-trip on the C# side
even though the document itself is valid. A TypeScript author writing `"unit": null` was falling into an
interoperability trap between the two branches, not choosing an equally valid alternative — the schema now
forbids it by machine, not by prose.
