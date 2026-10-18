#include "kt.hpp"
#include "lich.hpp"

using namespace std::chrono;
using lich::Ngay;

int main() {
  kt::chay("doc va in ngay nhuan", [] {
    auto d = lich::docNgay("2024-02-29");
    KT_DUNG(d.has_value());
    KT_BANG((Ngay{year{2024}, month{2}, day{29}}), *d);
    KT_BANG(std::string("2024-02-29"), lich::inNgay(*d));
    KT_DUNG(!lich::docNgay("2023-02-29").has_value());
  });
  kt::chay("cong thang kep cuoi thang", [] {
    KT_BANG((Ngay{year{2024}, month{2}, day{29}}), lich::congThang(Ngay{year{2024}, month{1}, day{31}}, 1));
    KT_BANG((Ngay{year{2024}, month{6}, day{15}}), lich::congThang(Ngay{year{2024}, month{4}, day{15}}, 2));
  });
  kt::chay("thu hai dau nam 2024", [] {
    KT_BANG(1, lich::thuTrongTuan(Ngay{year{2024}, month{1}, day{1}}));
    KT_BANG(3, lich::thuTrongTuan(Ngay{year{2024}, month{1}, day{3}}));
  });
  return kt::ketThuc();
}
