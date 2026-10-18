#include "csv.hpp"

#include <iterator>

std::vector<BanGhi> docCsv(std::istream& vao) {
  const std::string s((std::istreambuf_iterator<char>(vao)), std::istreambuf_iterator<char>());
  const std::size_t n = s.size();
  std::vector<BanGhi> kq;
  std::size_t i = 0;
  std::size_t dong = 1;

  // Tai j co ket thuc ban ghi khong: het du lieu, "\n", hoac "\r\n".
  auto laCuoi = [&](std::size_t j) { return j >= n || s[j] == '\n' || (s[j] == '\r' && j + 1 < n && s[j + 1] == '\n'); };
  // Bo qua dau ket thuc ban ghi tai i (neu con du lieu).
  auto boCuoi = [&]() {
    if (i >= n) return;
    if (s[i] == '\r') ++i;
    ++i;
    ++dong;
  };

  while (i < n) {
    if (laCuoi(i)) {  // dong trong hoan toan
      boCuoi();
      continue;
    }
    BanGhi bg;
    while (true) {
      std::string f;
      if (i < n && s[i] == '"') {
        const std::size_t dongMo = dong;
        ++i;
        while (true) {
          if (i >= n) throw LoiCsv(dongMo, "truong trong ngoac kep chua dong");
          const char c = s[i];
          if (c == '"') {
            if (i + 1 < n && s[i + 1] == '"') {
              f += '"';
              i += 2;
              continue;
            }
            ++i;
            break;
          }
          if (c == '\n') ++dong;
          f += c;
          ++i;
        }
        if (!(laCuoi(i) || s[i] == ',')) throw LoiCsv(dong, "ky tu sau dau nhay dong");
      } else {
        while (!laCuoi(i) && s[i] != ',') f += s[i++];
      }
      bg.push_back(std::move(f));
      if (i < n && s[i] == ',') {
        ++i;
        continue;
      }
      boCuoi();
      break;
    }
    kq.push_back(std::move(bg));
  }
  return kq;
}
