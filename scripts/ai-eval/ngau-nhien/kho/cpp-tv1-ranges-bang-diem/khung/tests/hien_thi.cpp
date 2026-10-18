#include <string>
#include <vector>

#include "bang_diem.hpp"
#include "kt.hpp"

int main() {
  kt::chay("xep hang dong hang 1 1 3", [] {
    std::vector<HocSinh> ds{
        {"Dung", "A1", 5, 5, 5}, {"Binh", "A2", 9, 9, 9}, {"Chi", "A1", 10, 10, 10}, {"An", "A1", 9, 8, 10}};
    KT_BANG(27, tongDiem(ds[3]));
    std::vector<XepHang> mong{
        {1, "Chi", "A1", 30, 10}, {2, "An", "A1", 27, 9}, {2, "Binh", "A2", 27, 9}, {4, "Dung", "A1", 15, 5}};
    KT_BANG(mong, xepHang(ds));
  });
  kt::chay("ten dat chuan giu thu tu", [] {
    std::vector<HocSinh> ds{{"Ha", "A1", 8, 7, 9}, {"Kim", "A1", 6, 9, 9}, {"Long", "A2", 7, 7, 7}};
    std::vector<std::string> mong{"Ha", "Long"};
    KT_BANG(mong, tenDatChuan(ds, 7));
  });
  kt::chay("trung binh lop", [] {
    std::vector<HocSinh> ds{{"Ha", "A1", 8, 7, 9}, {"Kim", "A2", 6, 9, 9}, {"Long", "A1", 7, 7, 7}};
    auto tb = trungBinhLop(ds, "A1");
    KT_DUNG(tb.has_value());
    KT_GAN(22.5, *tb, 1e-9);
  });
  return kt::ketThuc();
}
