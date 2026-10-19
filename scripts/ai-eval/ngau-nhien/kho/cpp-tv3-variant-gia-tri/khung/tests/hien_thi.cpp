#include <string>

#include "gia_tri.hpp"
#include "kt.hpp"

static GiaTri mau() {
  return GiaTri(DoiTuong{{"a", 1}, {"b", Mang{true, nullptr, "x"}}, {"c", 2.5}});
}

int main() {
  kt::chay("tuan tu hoa doi tuong long mang", [] {
    KT_BANG(std::string(R"({"a":1,"b":[true,null,"x"],"c":2.5})"), tuanTuHoa(mau()));
  });
  kt::chay("lay theo duong dan", [] {
    auto x = layTheoDuong(mau(), ".b[2]");
    KT_DUNG(x.has_value());
    KT_BANG(GiaTri("x"), *x);
    KT_DUNG(!layTheoDuong(mau(), ".khong").has_value());
  });
  kt::chay("so sanh bang theo kieu", [] {
    KT_DUNG(mau() == mau());
    KT_DUNG(!(GiaTri(1) == GiaTri(1.0)));
    KT_DUNG(GiaTri(Mang{1, "a"}) == GiaTri(Mang{1, std::string("a")}));
  });
  return kt::ketThuc();
}
