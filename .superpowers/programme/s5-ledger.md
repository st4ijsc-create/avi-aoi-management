# SESSION 5 — việc tồn của WS-HMI-2 + hai hạng mục chuyển từ S1
Nhánh `feat/hmi-s5-residuals`, BASE 5f00fef8. Mở 2026-09-06.

## Dữ kiện ĐO LẠI trước khi phái — một con số đã lạc hậu
- **Thang vai trò: TÁM bản khai báo giống hệt nhau từng ký tự**
  (`const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }`) ở
  `MachineControlPanel`, `AlarmCenter`, `AssetRegistry`, `Connectors`, `LineControl`, `Notifications`,
  `Site`, `Sidebar`. Mười tệp *nhắc tới* thang này, nhưng hai (`writePermissionChannel.ts`, `lib/api.ts`)
  chỉ **dùng lại**, không khai. **S1 ghi "tám bản sao" và con số ấy vẫn đúng** — nhưng chỉ vì tôi phân
  biệt khai báo với dùng lại; đếm thô cho ra mười. Ghi rõ để người sau không sửa nhầm hai tệp vô tội.
- **M-1 (chuyển từ S1): `logout` KHÔNG xoá cache truy vấn.** `auth.ts:154` gọi API rồi thôi; không
  `queryClient.clear()`, không `removeQueries`. Nên một phán quyết quyền của Admin có thể phục vụ
  Operator kế tiếp trong một vòng. S1 cố ý không sửa: đổi hành vi cache toàn cục bên trong một session
  bảo mật sẽ mở rộng bán kính vượt quá thứ lượt rà bảo mật ấy đã kiểm.
- **Năm dòng chịu lực không chốt vẫn nguyên** — `alreadyWarned` WeakSet và `console.warn` ở
  `publishedScreen.ts:130,175-178`, `describeId`, `staleTime: Infinity` của `useScreenAtVersion`, các cổng
  `enabled`, và loại trừ route demo. `grep` bài test: **không bài nào nhắc `alreadyWarned`**.
- **Không có liên kết nào dẫn tới `/editor`**, và **`GET /v1/screens` vẫn không ai tiêu thụ** — kỹ sư
  quên mã màn hình phải dùng curl.

## Ranh giới sprint
- Đây là session **dọn nợ**, không thêm tính năng. Không lược đồ mới, không route ghi mới.
- Gộp thang vai trò: **một nguồn duy nhất**, và phải chốt rằng không bản sao thứ chín mọc lại.
- `logout` xoá cache: đây là **hành vi toàn cục**, nên phải chốt cả hai chiều — xoá đúng thứ cần xoá,
  và **không** làm hỏng phiên đang đăng nhập.
- Không đụng ảnh chuẩn, không đụng lược đồ/hợp đồng đóng băng, không nới `retries: 0`.
