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
