#pragma once
#include <chrono>
#include <optional>
#include <string>
#include <string_view>

namespace lich {

using Ngay = std::chrono::year_month_day;

// "YYYY-MM-DD" -> ngày; sai định dạng hoặc ngày không tồn tại -> std::nullopt.
std::optional<Ngay> docNgay(std::string_view s);

// Ngày -> "YYYY-MM-DD".
std::string inNgay(const Ngay& d);

// Cộng (hoặc trừ, nếu âm) số tháng, kẹp về ngày cuối tháng khi cần.
Ngay congThang(const Ngay& d, int soThang);

// Cộng (hoặc trừ, nếu âm) số ngày.
Ngay congNgay(const Ngay& d, long long soNgay);

// Thứ trong tuần theo ISO: 1 = thứ Hai ... 7 = Chủ nhật.
int thuTrongTuan(const Ngay& d);

// Ngày "thứ `thu` lần thứ n" của tháng (n = 1..5), hoặc lần CUỐI (n = -1).
std::optional<Ngay> ngayThuNCuaThang(int nam, int thang, int thu, int n);

// b - a, tính bằng ngày.
long long soNgayGiua(const Ngay& a, const Ngay& b);

// Số ngày từ thứ Hai đến thứ Sáu trong nửa khoảng [a, b).
long long soNgayLamViec(const Ngay& a, const Ngay& b);

}  // namespace lich
