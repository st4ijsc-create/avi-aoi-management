#include <cstdint>
#include <string>
#include <vector>

#include "kt.hpp"
#include "top_k.hpp"

using DsTu = std::vector<std::string>;
using DsDem = std::vector<DemTu>;

int main() {
  kt::chay("rong va k bang 0", [] {
    KT_DUNG(tachTu("").empty());
    KT_DUNG(tachTu(" ,.;!?-_'\t\r\n").empty());
    KT_DUNG(topKTu("", 3).empty());
    KT_DUNG(topKTu("a b a", 0).empty());
  });
  kt::chay("ky tu phan cach ascii", [] {
    DsTu mong{"a", "b", "c", "d", "it", "s", "x", "y", "z", "m", "n"};
    KT_BANG(mong, tachTu("a_b c-d it's x\ty\nz m\x7fn"));
    DsTu nul{"p", "q"};
    KT_BANG(nul, tachTu(std::string_view("p\0q", 3)));
  });
  kt::chay("chu so thuoc tu", [] {
    DsTu mong{"a1b2", "2026", "b", "52", "x"};
    KT_BANG(mong, tachTu("A1b2 2026 B-52 (x)"));
  });
  kt::chay("utf8 giu nguyen byte khong ha chu", [] {
    DsTu mong{"việt", "viỆt", "việt"};
    KT_BANG(mong, tachTu("Việt VIỆT việt"));
    DsDem dem{{"việt", 2}, {"viỆt", 1}};
    KT_BANG(dem, topKTu("Việt VIỆT việt", 5));
  });
  kt::chay("byte 0x80 la byte chu", [] {
    DsTu mong{"xÀy", "À", "a\x80" "b"};
    KT_BANG(mong, tachTu("xÀy À;a\x80" "b"));
  });
  kt::chay("pha hoa theo byte khong dau", [] {
    DsDem mong{{"z", 2}, {"é", 2}, {"a", 1}};
    KT_BANG(mong, topKTu("é z é Z a", 3));
    DsDem hai{{"z", 2}, {"é", 2}};
    KT_BANG(hai, topKTu("é z é Z a", 2));
  });
  kt::chay("hoa thuong gop chung", [] {
    DsDem mong{{"the", 4}, {"cat", 2}};
    KT_BANG(mong, topKTu("The the THE tHe cat CAT dog", 2));
  });
  kt::chay("du lieu lon", [] {
    std::string s;
    s.reserve(8u << 20);
    for (int lap = 0; lap < 1000; ++lap) {
      for (int j = lap + 1; j <= 1000; ++j) {
        s += 'w';
        s += std::to_string(j);
        s += ' ';
        s += 'V';
        s += std::to_string(j);
        s += lap % 2 ? ",\n" : ";";
      }
    }
    DsDem dau{{"v1000", 1000}, {"w1000", 1000}, {"v999", 999}, {"w999", 999}, {"v998", 998}};
    KT_BANG(dau, topKTu(s, 5));
    DsDem tatCa = topKTu(s, SIZE_MAX);
    KT_BANG(std::size_t{2000}, tatCa.size());
    KT_BANG(std::string("v1"), tatCa[1998].first);
    KT_BANG(std::string("w1"), tatCa[1999].first);
    KT_BANG(std::size_t{1}, tatCa[1999].second);
    KT_BANG(std::string("v10"), tatCa[1980].first);
    KT_BANG(std::size_t{10}, tatCa[1981].second);
    KT_BANG(std::size_t{1001000}, tachTu(s).size());
  });
  kt::chay("tu rat dai", [] {
    std::string s(100000, 'Q');
    s += "!!";
    DsTu t = tachTu(s);
    KT_BANG(std::size_t{1}, t.size());
    KT_BANG(std::string(100000, 'q'), t[0]);
  });
  return kt::ketThuc();
}
