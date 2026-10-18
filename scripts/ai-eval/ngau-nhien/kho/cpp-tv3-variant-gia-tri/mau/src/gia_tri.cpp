#include "gia_tri.hpp"

#include <charconv>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <type_traits>

namespace {
template <class... F>
struct GopLambda : F... {
  using F::operator()...;
};
template <class... F>
GopLambda(F...) -> GopLambda<F...>;

void thoatChuoi(std::string& o, const std::string& s) {
  static const char* const HEX = "0123456789abcdef";
  o += '"';
  for (char ch : s) {
    const unsigned char c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      case '\b': o += "\\b"; break;
      case '\f': o += "\\f"; break;
      default:
        if (c < 0x20) {
          o += "\\u00";
          o += HEX[c >> 4];
          o += HEX[c & 0xF];
        } else {
          o += ch;
        }
    }
  }
  o += '"';
}

void viet(std::string& o, const GiaTri& g) {
  std::visit(GopLambda{
                 [&](std::nullptr_t) { o += "null"; },
                 [&](bool b) { o += b ? "true" : "false"; },
                 [&](std::int64_t x) { o += std::to_string(x); },
                 [&](double x) {
                   if (!std::isfinite(x)) {
                     o += "null";
                     return;
                   }
                   char buf[64];
                   auto r = std::to_chars(buf, buf + sizeof buf, x);
                   std::string t(buf, r.ptr);
                   if (t.find_first_not_of("-0123456789") == std::string::npos) t += ".0";
                   o += t;
                 },
                 [&](const std::string& s) { thoatChuoi(o, s); },
                 [&](const Mang& a) {
                   o += '[';
                   for (std::size_t i = 0; i < a.size(); ++i) {
                     if (i) o += ',';
                     viet(o, a[i]);
                   }
                   o += ']';
                 },
                 [&](const DoiTuong& d) {
                   o += '{';
                   for (std::size_t i = 0; i < d.size(); ++i) {
                     if (i) o += ',';
                     thoatChuoi(o, d[i].first);
                     o += ':';
                     viet(o, d[i].second);
                   }
                   o += '}';
                 },
             },
             g.v);
}

// Mot doan duong: khoa (laKhoa) hoac chi so (coChiSo = false khi qua lon).
struct Doan {
  bool laKhoa;
  std::string khoa;
  bool coChiSo;
  std::size_t chiSo;
};

std::vector<Doan> phanTich(std::string_view p) {
  std::vector<Doan> ds;
  std::size_t i = 0;
  while (i < p.size()) {
    if (p[i] == '.') {
      std::size_t j = i + 1;
      while (j < p.size() && p[j] != '.' && p[j] != '[') ++j;
      if (j == i + 1) throw std::invalid_argument("khoa rong trong duong dan");
      ds.push_back({true, std::string(p.substr(i + 1, j - i - 1)), false, 0});
      i = j;
    } else if (p[i] == '[') {
      std::size_t j = i + 1;
      std::size_t v = 0;
      bool vua = true;
      while (j < p.size() && p[j] >= '0' && p[j] <= '9') {
        const std::size_t d = static_cast<std::size_t>(p[j] - '0');
        if (v > (std::numeric_limits<std::size_t>::max() - d) / 10) vua = false;
        if (vua) v = v * 10 + d;
        ++j;
      }
      if (j == i + 1 || j >= p.size() || p[j] != ']') throw std::invalid_argument("chi so sai cu phap");
      ds.push_back({false, {}, vua, v});
      i = j + 1;
    } else {
      throw std::invalid_argument("duong dan sai cu phap");
    }
  }
  return ds;
}

std::size_t dem(const GiaTri& g) {
  std::size_t n = 1;
  if (auto a = std::get_if<Mang>(&g.v))
    for (const auto& x : *a) n += dem(x);
  if (auto d = std::get_if<DoiTuong>(&g.v))
    for (const auto& kv : *d) n += dem(kv.second);
  return n;
}
}  // namespace

std::string tenKieu(const GiaTri& g) {
  return std::visit(GopLambda{
                        [](std::nullptr_t) { return "null"; },
                        [](bool) { return "bool"; },
                        [](std::int64_t) { return "int"; },
                        [](double) { return "double"; },
                        [](const std::string&) { return "string"; },
                        [](const Mang&) { return "array"; },
                        [](const DoiTuong&) { return "object"; },
                    },
                    g.v);
}

std::string tuanTuHoa(const GiaTri& g) {
  std::string o;
  viet(o, g);
  return o;
}

std::optional<GiaTri> layTheoDuong(const GiaTri& g, std::string_view duong) {
  const std::vector<Doan> ds = phanTich(duong);
  const GiaTri* cur = &g;
  for (const Doan& d : ds) {
    if (d.laKhoa) {
      const auto* o = std::get_if<DoiTuong>(&cur->v);
      if (!o) return std::nullopt;
      const GiaTri* tim = nullptr;
      for (const auto& kv : *o)
        if (kv.first == d.khoa) {
          tim = &kv.second;
          break;
        }
      if (!tim) return std::nullopt;
      cur = tim;
    } else {
      const auto* a = std::get_if<Mang>(&cur->v);
      if (!a || !d.coChiSo || d.chiSo >= a->size()) return std::nullopt;
      cur = &(*a)[d.chiSo];
    }
  }
  return *cur;
}

std::size_t demNut(const GiaTri& g) { return dem(g); }

bool operator==(const GiaTri& a, const GiaTri& b) {
  if (a.v.index() != b.v.index()) return false;
  return std::visit(
      [&b](const auto& x) -> bool {
        using T = std::decay_t<decltype(x)>;
        const T& y = std::get<T>(b.v);
        if constexpr (std::is_same_v<T, Mang>) {
          if (x.size() != y.size()) return false;
          for (std::size_t i = 0; i < x.size(); ++i)
            if (!(x[i] == y[i])) return false;
          return true;
        } else if constexpr (std::is_same_v<T, DoiTuong>) {
          if (x.size() != y.size()) return false;
          for (std::size_t i = 0; i < x.size(); ++i)
            if (x[i].first != y[i].first || !(x[i].second == y[i].second)) return false;
          return true;
        } else {
          return x == y;
        }
      },
      a.v);
}
