#include <stdexcept>
#include <string>

#include "kt.hpp"
#include "lich.hpp"

using namespace std::chrono;
using lich::Ngay;

static Ngay N(int y, unsigned m, unsigned d) { return Ngay{year{y}, month{m}, day{d}}; }

int main() {
  kt::chay("docNgay tu choi dinh dang sai", [] {
    for (const char* s : {"2024-2-03", " 2024-02-03", "2024-02-03 ", "2024/02/03", "0000-01-01", "2024-13-01",
                          "2024-00-10", "2024-04-31", "1900-02-29", "+024-01-01", "", "2024-02-3a", "20240203",
                          "2024-02-003", "-024-01-01", "2024-01-00"})
      KT_DUNG(!lich::docNgay(s).has_value());
  });
  kt::chay("docNgay bien hop le", [] {
    KT_BANG(N(2000, 2, 29), lich::docNgay("2000-02-29"));
    KT_BANG(N(1, 1, 1), lich::docNgay("0001-01-01"));
    KT_BANG(N(9999, 12, 31), lich::docNgay("9999-12-31"));
  });
  kt::chay("inNgay dem so 0 va tu choi ngay sai", [] {
    KT_BANG(std::string("0042-01-05"), lich::inNgay(N(42, 1, 5)));
    KT_BANG(std::string("0001-01-01"), lich::inNgay(N(1, 1, 1)));
    KT_NEM(std::invalid_argument, lich::inNgay(N(2023, 2, 30)));
    KT_NEM(std::invalid_argument, lich::inNgay(N(0, 5, 5)));
    KT_NEM(std::invalid_argument, lich::inNgay(N(10000, 1, 1)));
  });
  kt::chay("congThang am duong va kep", [] {
    KT_BANG(N(2023, 2, 28), lich::congThang(N(2023, 1, 31), 1));
    KT_BANG(N(2024, 2, 29), lich::congThang(N(2024, 3, 31), -1));
    KT_BANG(N(2025, 1, 15), lich::congThang(N(2024, 12, 15), 1));
    KT_BANG(N(2022, 12, 15), lich::congThang(N(2024, 1, 15), -13));
    KT_BANG(N(2124, 6, 30), lich::congThang(N(2024, 5, 31), 1201));
    KT_BANG(N(2021, 2, 28), lich::congThang(N(2020, 2, 29), 12));
    KT_BANG(N(2024, 8, 31), lich::congThang(N(2024, 8, 31), 0));
    KT_NEM(std::out_of_range, lich::congThang(N(9999, 12, 1), 1));
    KT_NEM(std::out_of_range, lich::congThang(N(1, 1, 31), -1));
    KT_NEM(std::invalid_argument, lich::congThang(N(2023, 2, 29), 1));
  });
  kt::chay("congNgay qua nam va bien", [] {
    KT_BANG(N(2024, 2, 29), lich::congNgay(N(2024, 2, 28), 1));
    KT_BANG(N(2025, 1, 1), lich::congNgay(N(2024, 12, 31), 1));
    KT_BANG(N(2000, 2, 29), lich::congNgay(N(2000, 3, 1), -1));
    KT_BANG(N(2022, 1, 8), lich::congNgay(N(1970, 1, 1), 19000));
    KT_NEM(std::out_of_range, lich::congNgay(N(9999, 12, 31), 1));
    KT_NEM(std::out_of_range, lich::congNgay(N(1, 1, 1), -1));
  });
  kt::chay("thu trong tuan ca chu nhat", [] {
    KT_BANG(7, lich::thuTrongTuan(N(2026, 10, 18)));
    KT_BANG(6, lich::thuTrongTuan(N(2000, 1, 1)));
    KT_BANG(4, lich::thuTrongTuan(N(1970, 1, 1)));
    KT_BANG(1, lich::thuTrongTuan(N(1, 1, 1)));
    KT_NEM(std::invalid_argument, lich::thuTrongTuan(N(2024, 6, 31)));
  });
  kt::chay("ngay thu n cua thang", [] {
    KT_BANG(N(2024, 11, 28), lich::ngayThuNCuaThang(2024, 11, 4, 4));
    KT_BANG(N(2024, 5, 27), lich::ngayThuNCuaThang(2024, 5, 1, -1));
    KT_BANG(N(2024, 2, 29), lich::ngayThuNCuaThang(2024, 2, 4, 5));
    KT_DUNG(!lich::ngayThuNCuaThang(2023, 2, 4, 5).has_value());
    KT_BANG(N(2024, 9, 1), lich::ngayThuNCuaThang(2024, 9, 7, 1));
    KT_BANG(N(2024, 9, 29), lich::ngayThuNCuaThang(2024, 9, 7, -1));
    KT_BANG(N(2024, 9, 29), lich::ngayThuNCuaThang(2024, 9, 7, 5));
  });
  kt::chay("ngay thu n tham so sai", [] {
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 13, 1, 1));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 0, 1, 1));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 5, 0, 1));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 5, 8, 1));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 5, 1, 0));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 5, 1, 6));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(2024, 5, 1, -2));
    KT_NEM(std::invalid_argument, lich::ngayThuNCuaThang(0, 5, 1, 1));
  });
  kt::chay("so ngay giua hai ngay", [] {
    KT_BANG(366LL, lich::soNgayGiua(N(2024, 1, 1), N(2025, 1, 1)));
    KT_BANG(-366LL, lich::soNgayGiua(N(2025, 1, 1), N(2024, 1, 1)));
    KT_BANG(0LL, lich::soNgayGiua(N(2024, 7, 4), N(2024, 7, 4)));
    KT_BANG(3652058LL, lich::soNgayGiua(N(1, 1, 1), N(9999, 12, 31)));
    KT_NEM(std::invalid_argument, lich::soNgayGiua(N(2024, 1, 1), N(2024, 2, 30)));
  });
  kt::chay("so ngay lam viec nua khoang", [] {
    KT_BANG(5LL, lich::soNgayLamViec(N(2024, 10, 14), N(2024, 10, 21)));
    KT_BANG(0LL, lich::soNgayLamViec(N(2024, 10, 19), N(2024, 10, 21)));
    KT_BANG(1LL, lich::soNgayLamViec(N(2024, 10, 19), N(2024, 10, 22)));
    KT_BANG(0LL, lich::soNgayLamViec(N(2024, 10, 21), N(2024, 10, 14)));
    KT_BANG(49LL, lich::soNgayLamViec(N(2023, 12, 25), N(2024, 3, 1)));
    KT_BANG(2608614LL, lich::soNgayLamViec(N(1, 1, 1), N(9999, 12, 31)));
  });
  return kt::ketThuc();
}
