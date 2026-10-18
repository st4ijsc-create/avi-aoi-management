#include <sstream>
#include <string>
#include <vector>

#include "csv.hpp"
#include "kt.hpp"
#include "ton_kho.hpp"

int main() {
  kt::chay("doc csv co nhay kep", [] {
    std::istringstream vao("a,\"b,c\",\"d\"\"e\"\n1,2,3\n");
    std::vector<BanGhi> mong{{"a", "b,c", "d\"e"}, {"1", "2", "3"}};
    KT_BANG(mong, docCsv(vao));
  });
  kt::chay("so luong hai chu so thap phan", [] {
    KT_BANG(1250LL, docSoLuong("12.5"));
    KT_BANG(7LL, docSoLuong("0.07"));
    KT_BANG(std::string("-3.05"), inSoLuong(-305));
    KT_BANG(std::string("40.00"), inSoLuong(4000));
  });
  kt::chay("bao cao ascii co canh bao am", [] {
    std::istringstream vao("ma,ten,loai,so_luong\nB2,Giay,NHAP,10\nA1,But,NHAP,5.5\nB2,Giay,XUAT,12\n");
    const std::string mong =
        "MA  TEN     TON\n"
        "A1  But    5.50\n"
        "B2  Giay  -2.00\n"
        "CANH BAO: ban ghi 4, ma B2, ton -2.00\n";
    KT_BANG(mong, xuLyCsv(vao));
  });
  return kt::ketThuc();
}
