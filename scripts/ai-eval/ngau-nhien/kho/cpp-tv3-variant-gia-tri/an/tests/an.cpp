#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>

#include "gia_tri.hpp"
#include "kt.hpp"

using S = std::string;

static GiaTri cay() {
  return GiaTri(DoiTuong{
      {"a", DoiTuong{{"b", Mang{10, DoiTuong{{"c", "d"}}}}}},
      {"x.y", 1},
      {"dup", 1},
      {"dup", 2},
      {"k]", true},
  });
}

int main() {
  kt::chay("thoat ky tu trong chuoi", [] {
    S dau("a\"b\\c\n\t\r\b\f/\x01\x1f\x7f" "Việt");
    S mong = S("\"a\\\"b\\\\c\\n\\t\\r\\b\\f/\\u0001\\u001f\x7f") + "Việt\"";
    KT_BANG(mong, tuanTuHoa(GiaTri(dau)));
    KT_BANG(S(R"({"k\"ey\n":"\u0000"})"), tuanTuHoa(GiaTri(DoiTuong{{"k\"ey\n", S(1, '\0')}})));
  });
  kt::chay("so thuc theo to_chars ngan nhat", [] {
    KT_BANG(S("2.0"), tuanTuHoa(GiaTri(2.0)));
    KT_BANG(S("-0.0"), tuanTuHoa(GiaTri(-0.0)));
    KT_BANG(S("0.1"), tuanTuHoa(GiaTri(0.1)));
    KT_BANG(S("100.0"), tuanTuHoa(GiaTri(100.0)));
    KT_BANG(S("1e+300"), tuanTuHoa(GiaTri(1e300)));
    KT_BANG(S("1.5e-07"), tuanTuHoa(GiaTri(1.5e-7)));
    KT_BANG(S("123456789012345680.0"), tuanTuHoa(GiaTri(123456789012345680.0)));
    KT_BANG(S("[null,null,null]"), tuanTuHoa(GiaTri(Mang{std::numeric_limits<double>::quiet_NaN(),
                                                         std::numeric_limits<double>::infinity(),
                                                         -std::numeric_limits<double>::infinity()})));
  });
  kt::chay("so nguyen bien va gia tri don", [] {
    KT_BANG(S("-9223372036854775808"), tuanTuHoa(GiaTri(std::numeric_limits<std::int64_t>::min())));
    KT_BANG(S("9223372036854775807"), tuanTuHoa(GiaTri(std::numeric_limits<std::int64_t>::max())));
    KT_BANG(S("[0,-5,true,false,null,null]"), tuanTuHoa(GiaTri(Mang{0, -5, true, false, nullptr, GiaTri()})));
    KT_BANG(S("[[],{},\"\"]"), tuanTuHoa(GiaTri(Mang{Mang{}, DoiTuong{}, ""})));
  });
  kt::chay("duong dan tra dung gia tri", [] {
    const GiaTri g = cay();
    KT_BANG(GiaTri("d"), layTheoDuong(g, ".a.b[1].c"));
    KT_BANG(GiaTri(10), layTheoDuong(g, ".a.b[0]"));
    KT_BANG(GiaTri(DoiTuong{{"c", "d"}}), layTheoDuong(g, ".a.b[01]"));
    KT_BANG(g, layTheoDuong(g, ""));
    KT_BANG(GiaTri(1), layTheoDuong(g, ".dup"));
    KT_BANG(GiaTri(true), layTheoDuong(g, ".k]"));
  });
  kt::chay("duong dan khong co gia tri", [] {
    const GiaTri g = cay();
    KT_DUNG(!layTheoDuong(g, ".a.b[2]").has_value());
    KT_DUNG(!layTheoDuong(g, ".a.b.c").has_value());
    KT_DUNG(!layTheoDuong(g, ".a.b[1].c[0]").has_value());
    KT_DUNG(!layTheoDuong(g, "[0]").has_value());
    KT_DUNG(!layTheoDuong(g, ".x.y").has_value());
    KT_DUNG(!layTheoDuong(g, ".a.b[99999999999999999999999]").has_value());
    KT_DUNG(!layTheoDuong(GiaTri(5), ".a").has_value());
  });
  kt::chay("duong dan sai cu phap nem invalid_argument", [] {
    const GiaTri g = cay();
    for (const char* p : {"a", ".", "..a", ".a.", "[", "[]", "[1", "[x]", "[-1]", ".a[1]x", ".a[", " .a", ".a[ 1]"})
      KT_NEM(std::invalid_argument, layTheoDuong(g, p));
    KT_NEM(std::invalid_argument, layTheoDuong(g, ".khongCo["));
    KT_NEM(std::invalid_argument, layTheoDuong(GiaTri(), "[0]]"));
  });
  kt::chay("so sanh bang sau", [] {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    KT_DUNG(!(GiaTri(nan) == GiaTri(nan)));
    KT_DUNG(!(GiaTri(true) == GiaTri(1)));
    KT_DUNG(GiaTri() == GiaTri(nullptr));
    KT_DUNG(GiaTri(S("ab")) == GiaTri("ab"));
    KT_DUNG(!(GiaTri(DoiTuong{{"a", 1}, {"b", 2}}) == GiaTri(DoiTuong{{"b", 2}, {"a", 1}})));
    KT_DUNG(!(GiaTri(Mang{1, 2}) == GiaTri(Mang{1, 2, 3})));
    KT_DUNG(!(GiaTri(Mang{}) == GiaTri(DoiTuong{})));
    KT_DUNG(cay() == cay());
    KT_DUNG(!(GiaTri(Mang{Mang{1, 2.0}}) == GiaTri(Mang{Mang{1, 2}})));
  });
  kt::chay("sao chep la sao chep sau", [] {
    GiaTri goc = cay();
    GiaTri ban = goc;
    std::get<Mang>(std::get<DoiTuong>(std::get<DoiTuong>(ban.v)[0].second.v)[0].second.v).push_back(GiaTri(99));
    KT_BANG(GiaTri(99), layTheoDuong(ban, ".a.b[2]"));
    KT_DUNG(!layTheoDuong(goc, ".a.b[2]").has_value());
    KT_DUNG(!(goc == ban));
  });
  kt::chay("dem nut va ten kieu", [] {
    GiaTri g(DoiTuong{{"a", Mang{1, 2, DoiTuong{{"b", nullptr}}}}, {"c", "x"}});
    KT_BANG(std::size_t{7}, demNut(g));
    KT_BANG(std::size_t{1}, demNut(GiaTri()));
    KT_BANG(S("object"), tenKieu(g));
    KT_BANG(S("array"), tenKieu(GiaTri(Mang{})));
    KT_BANG(S("int"), tenKieu(GiaTri(3)));
    KT_BANG(S("double"), tenKieu(GiaTri(3.0)));
    KT_BANG(S("string"), tenKieu(GiaTri("3")));
    KT_BANG(S("bool"), tenKieu(GiaTri(false)));
    KT_BANG(S("null"), tenKieu(GiaTri()));
  });
  kt::chay("long sau 1000 cap", [] {
    GiaTri g(7);
    for (int i = 0; i < 1000; ++i) g = GiaTri(Mang{g});
    KT_BANG(S(1000, '[') + "7" + S(1000, ']'), tuanTuHoa(g));
    S p;
    for (int i = 0; i < 1000; ++i) p += "[0]";
    KT_BANG(GiaTri(7), layTheoDuong(g, p));
    KT_BANG(std::size_t{1001}, demNut(g));
    GiaTri h = g;
    KT_DUNG(h == g);
  });
  return kt::ketThuc();
}
