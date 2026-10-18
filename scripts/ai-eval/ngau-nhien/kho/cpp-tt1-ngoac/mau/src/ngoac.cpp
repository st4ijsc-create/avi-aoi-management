#include "ngoac.hpp"

#include <vector>

namespace {
char dongCua(char mo) {
  switch (mo) {
    case '(': return ')';
    case '[': return ']';
    case '{': return '}';
    case '<': return '>';
    default: return '\0';
  }
}
bool laDong(char c) { return c == ')' || c == ']' || c == '}' || c == '>'; }
}  // namespace

KetQuaNgoac kiemNgoac(std::string_view s) {
  std::vector<char> ngan;
  bool trongChuoi = false;
  for (size_t i = 0; i < s.size(); ++i) {
    char c = s[i];
    if (trongChuoi) {
      if (c == '\\') { ++i; continue; }
      if (c == '"') trongChuoi = false;
      continue;
    }
    if (c == '"') { trongChuoi = true; continue; }
    if (dongCua(c) != '\0') { ngan.push_back(c); continue; }
    if (laDong(c)) {
      if (ngan.empty()) return {false, static_cast<int>(i), '\0'};
      char can = dongCua(ngan.back());
      if (c != can) return {false, static_cast<int>(i), can};
      ngan.pop_back();
    }
  }
  if (trongChuoi) return {false, static_cast<int>(s.size()), '"'};
  if (!ngan.empty()) return {false, static_cast<int>(s.size()), dongCua(ngan.back())};
  return {true, -1, '\0'};
}
