#include "bang_diem.hpp"

#include <algorithm>
#include <iterator>
#include <numeric>
#include <ranges>
#include <stdexcept>

namespace {
bool diemHopLe(int d) { return d >= 0 && d <= 10; }

void kiem(const HocSinh& h) {
  if (!diemHopLe(h.toan) || !diemHopLe(h.van) || !diemHopLe(h.anh))
    throw std::invalid_argument("diem phai trong [0, 10]: " + h.ten);
}

void kiemTatCa(const std::vector<HocSinh>& ds) { std::ranges::for_each(ds, kiem); }
}  // namespace

int tongDiem(const HocSinh& h) {
  kiem(h);
  return h.toan + h.van + h.anh;
}

std::vector<XepHang> xepHang(const std::vector<HocSinh>& ds) {
  kiemTatCa(ds);
  std::vector<XepHang> kq;
  kq.reserve(ds.size());
  std::ranges::transform(ds, std::back_inserter(kq),
                         [](const HocSinh& h) { return XepHang{0, h.ten, h.lop, tongDiem(h), h.toan}; });
  std::ranges::stable_sort(kq, [](const XepHang& a, const XepHang& b) {
    if (a.tong != b.tong) return a.tong > b.tong;
    if (a.toan != b.toan) return a.toan > b.toan;
    return a.ten < b.ten;
  });
  for (std::size_t i = 0; i < kq.size(); ++i) {
    const bool dongHang = i > 0 && kq[i].tong == kq[i - 1].tong && kq[i].toan == kq[i - 1].toan;
    kq[i].hang = dongHang ? kq[i - 1].hang : static_cast<int>(i) + 1;
  }
  return kq;
}

std::vector<std::string> tenDatChuan(const std::vector<HocSinh>& ds, int nguong) {
  kiemTatCa(ds);
  auto v = ds | std::views::filter([nguong](const HocSinh& h) {
             return h.toan >= nguong && h.van >= nguong && h.anh >= nguong;
           }) |
           std::views::transform(&HocSinh::ten);
  std::vector<std::string> kq;
  std::ranges::copy(v, std::back_inserter(kq));
  return kq;
}

std::size_t tachDatTruot(std::vector<HocSinh>& ds, int nguongTong) {
  kiemTatCa(ds);
  auto duoi = std::ranges::stable_partition(ds, [nguongTong](const HocSinh& h) { return tongDiem(h) >= nguongTong; });
  return static_cast<std::size_t>(duoi.begin() - ds.begin());
}

std::optional<double> trungBinhLop(const std::vector<HocSinh>& ds, const std::string& lop) {
  kiemTatCa(ds);
  auto tong = ds | std::views::filter([&lop](const HocSinh& h) { return h.lop == lop; }) |
              std::views::transform(tongDiem);
  const auto n = std::ranges::distance(tong);
  if (n == 0) return std::nullopt;
  const long long s = std::accumulate(tong.begin(), tong.end(), 0LL);
  return static_cast<double>(s) / static_cast<double>(n);
}

std::vector<XepHang> thuKhoaTheoLop(const std::vector<HocSinh>& ds) {
  std::vector<XepHang> bang = xepHang(ds);
  std::vector<XepHang> kq;
  for (const auto& x : bang)
    if (std::ranges::none_of(kq, [&x](const XepHang& y) { return y.lop == x.lop; })) kq.push_back(x);
  std::ranges::stable_sort(kq, {}, &XepHang::lop);
  return kq;
}
