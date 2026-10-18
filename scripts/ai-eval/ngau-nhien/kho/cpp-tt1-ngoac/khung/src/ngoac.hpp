#pragma once
#include <string_view>

struct KetQuaNgoac {
  bool hopLe;
  int viTri;
  char mongDoi;
};

KetQuaNgoac kiemNgoac(std::string_view s);
