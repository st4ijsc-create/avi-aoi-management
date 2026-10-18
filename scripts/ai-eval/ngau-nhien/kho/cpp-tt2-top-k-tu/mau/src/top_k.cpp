#include "top_k.hpp"

#include <algorithm>
#include <unordered_map>

namespace {
bool laByteChu(unsigned char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c >= 0x80;
}

char veThuong(unsigned char c) {
  return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : static_cast<char>(c);
}

template <class F>
void duyetTu(std::string_view s, F&& f) {
  std::string tu;
  for (char ch : s) {
    unsigned char c = static_cast<unsigned char>(ch);
    if (laByteChu(c)) {
      tu.push_back(veThuong(c));
    } else if (!tu.empty()) {
      f(tu);
      tu.clear();
    }
  }
  if (!tu.empty()) f(tu);
}
}  // namespace

std::vector<std::string> tachTu(std::string_view vanBan) {
  std::vector<std::string> kq;
  duyetTu(vanBan, [&](const std::string& t) { kq.push_back(t); });
  return kq;
}

std::vector<DemTu> topKTu(std::string_view vanBan, std::size_t k) {
  std::unordered_map<std::string, std::size_t> dem;
  duyetTu(vanBan, [&](const std::string& t) { ++dem[t]; });
  std::vector<DemTu> v(dem.begin(), dem.end());
  const std::size_t n = std::min(k, v.size());
  auto dungTruoc = [](const DemTu& a, const DemTu& b) {
    if (a.second != b.second) return a.second > b.second;
    return a.first < b.first;
  };
  std::partial_sort(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(n), v.end(), dungTruoc);
  v.resize(n);
  return v;
}
