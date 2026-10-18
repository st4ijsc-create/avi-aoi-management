#include <string>

#include "kt.hpp"
#include "ngoac.hpp"

static void kiem(std::string_view s, bool hopLe, int viTri, char mongDoi) {
  KetQuaNgoac k = kiemNgoac(s);
  KT_BANG(hopLe, k.hopLe);
  KT_BANG(viTri, k.viTri);
  KT_BANG(mongDoi, k.mongDoi);
}

int main() {
  kt::chay("chuoi rong", [] { kiem("", true, -1, '\0'); });
  kt::chay("dong khi khong con mo", [] { kiem("ab)", false, 2, '\0'); });
  kt::chay("ngoac trong chuoi bi bo qua", [] { kiem("f(\"(]\") + [x]", true, -1, '\0'); });
  kt::chay("nhay thoat trong chuoi", [] { kiem("(\"a\\\")\" )", true, -1, '\0'); });
  kt::chay("gach cheo kep roi dong chuoi", [] { kiem("(\"a\\\\\")", true, -1, '\0'); });
  kt::chay("chuoi chua dong", [] { kiem("(\"abc", false, 5, '"'); });
  kt::chay("nhay don khong dac biet", [] { kiem("'(' )", true, -1, '\0'); });
  kt::chay("loi dau tien thang", [] {
    kiem("<{>}", false, 2, '}');
    kiem("(((<>)))]", false, 8, '\0');
    kiem("{(<[", false, 4, ']');
  });
  kt::chay("chuoi dai long sau", [] {
    std::string s;
    for (int i = 0; i < 50000; ++i) s += "([{<";
    std::string t = s;
    for (int i = 0; i < 50000; ++i) t += ">}])";
    kiem(t, true, -1, '\0');
    kiem(s, false, static_cast<int>(s.size()), '>');
  });
  return kt::ketThuc();
}
