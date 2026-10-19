#include "lich.hpp"

#include <algorithm>
#include <stdexcept>

namespace lich {

namespace {
using namespace std::chrono;

bool trongPhamVi(const Ngay& d) { return d.ok() && d.year() >= year{1} && d.year() <= year{9999}; }

void kiem(const Ngay& d) {
  if (!trongPhamVi(d)) throw std::invalid_argument("ngay khong hop le");
}

Ngay ketQua(const Ngay& d) {
  if (!trongPhamVi(d)) throw std::out_of_range("ket qua ngoai 0001..9999");
  return d;
}

bool laSo(char c) { return c >= '0' && c <= '9'; }

int soTu(std::string_view s, std::size_t dau, std::size_t dai) {
  int v = 0;
  for (std::size_t i = dau; i < dau + dai; ++i) v = v * 10 + (s[i] - '0');
  return v;
}

void chenSo(std::string& o, int v, int rong) {
  std::string t = std::to_string(v);
  if (static_cast<int>(t.size()) < rong) o.append(static_cast<std::size_t>(rong) - t.size(), '0');
  o += t;
}
}  // namespace

std::optional<Ngay> docNgay(std::string_view s) {
  if (s.size() != 10 || s[4] != '-' || s[7] != '-') return std::nullopt;
  for (std::size_t i : {0, 1, 2, 3, 5, 6, 8, 9})
    if (!laSo(s[i])) return std::nullopt;
  Ngay d{year{soTu(s, 0, 4)}, month{static_cast<unsigned>(soTu(s, 5, 2))}, day{static_cast<unsigned>(soTu(s, 8, 2))}};
  if (!trongPhamVi(d)) return std::nullopt;
  return d;
}

std::string inNgay(const Ngay& d) {
  kiem(d);
  std::string o;
  chenSo(o, static_cast<int>(d.year()), 4);
  o += '-';
  chenSo(o, static_cast<int>(static_cast<unsigned>(d.month())), 2);
  o += '-';
  chenSo(o, static_cast<int>(static_cast<unsigned>(d.day())), 2);
  return o;
}

Ngay congThang(const Ngay& d, int soThang) {
  kiem(d);
  const long long tong = static_cast<long long>(static_cast<int>(d.year())) * 12 +
                         (static_cast<unsigned>(d.month()) - 1) + soThang;
  const long long nam = tong >= 0 ? tong / 12 : -((-tong + 11) / 12);
  const long long thang = tong - nam * 12 + 1;
  if (nam < 1 || nam > 9999) throw std::out_of_range("ket qua ngoai 0001..9999");
  const year_month ym{year{static_cast<int>(nam)}, month{static_cast<unsigned>(thang)}};
  const day cuoi = (ym / last).day();
  return Ngay{ym / std::min(d.day(), cuoi)};
}

Ngay congNgay(const Ngay& d, long long soNgay) {
  kiem(d);
  if (soNgay > 4000000 || soNgay < -4000000) throw std::out_of_range("ket qua ngoai 0001..9999");
  return ketQua(Ngay{sys_days{d} + days{soNgay}});
}

int thuTrongTuan(const Ngay& d) {
  kiem(d);
  return static_cast<int>(weekday{sys_days{d}}.iso_encoding());
}

std::optional<Ngay> ngayThuNCuaThang(int nam, int thang, int thu, int n) {
  if (nam < 1 || nam > 9999 || thang < 1 || thang > 12 || thu < 1 || thu > 7 || n == 0 || n < -1 || n > 5)
    throw std::invalid_argument("tham so khong hop le");
  const year y{nam};
  const month m{static_cast<unsigned>(thang)};
  const weekday wd{static_cast<unsigned>(thu)};  // 7 => Chu nhat
  if (n == -1) return Ngay{sys_days{year_month_weekday_last{y, m, wd[last]}}};
  const year_month_weekday ymw{y, m, wd[static_cast<unsigned>(n)]};
  if (!ymw.ok()) return std::nullopt;
  return Ngay{sys_days{ymw}};
}

long long soNgayGiua(const Ngay& a, const Ngay& b) {
  kiem(a);
  kiem(b);
  return (sys_days{b} - sys_days{a}).count();
}

long long soNgayLamViec(const Ngay& a, const Ngay& b) {
  const long long n = soNgayGiua(a, b);
  if (n <= 0) return 0;
  long long kq = n / 7 * 5;
  const sys_days batDauDu = sys_days{a} + days{n / 7 * 7};
  for (long long i = 0; i < n % 7; ++i)
    if (thuTrongTuan(Ngay{batDauDu + days{i}}) <= 5) ++kq;
  return kq;
}

}  // namespace lich
