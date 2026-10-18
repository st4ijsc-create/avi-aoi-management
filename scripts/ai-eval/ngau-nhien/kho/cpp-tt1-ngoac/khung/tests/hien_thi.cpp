#include "kt.hpp"
#include "ngoac.hpp"

static void kiem(std::string_view s, bool hopLe, int viTri, char mongDoi) {
  KetQuaNgoac k = kiemNgoac(s);
  KT_BANG(hopLe, k.hopLe);
  KT_BANG(viTri, k.viTri);
  KT_BANG(mongDoi, k.mongDoi);
}

int main() {
  kt::chay("hop le", [] { kiem("a(b[c]{d}<e>)", true, -1, '\0'); });
  kt::chay("dong sai loai", [] { kiem("(]", false, 1, ')'); });
  kt::chay("con ngoac mo", [] { kiem("{[", false, 2, ']'); });
  return kt::ketThuc();
}
