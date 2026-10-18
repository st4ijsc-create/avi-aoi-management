#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

struct GiaTri;
using Mang = std::vector<GiaTri>;
// Đối tượng: các cặp (khoá, giá trị) theo THỨ TỰ chèn; có thể trùng khoá.
using DoiTuong = std::vector<std::pair<std::string, GiaTri>>;

// Giá trị kiểu JSON.
struct GiaTri {
  std::variant<std::nullptr_t, bool, std::int64_t, double, std::string, Mang, DoiTuong> v;

  GiaTri() : v(nullptr) {}
  GiaTri(std::nullptr_t) : v(nullptr) {}
  GiaTri(bool b) : v(b) {}
  GiaTri(int x) : v(static_cast<std::int64_t>(x)) {}
  GiaTri(std::int64_t x) : v(x) {}
  GiaTri(double x) : v(x) {}
  GiaTri(const char* s) : v(std::string(s)) {}
  GiaTri(std::string s) : v(std::move(s)) {}
  GiaTri(Mang a) : v(std::move(a)) {}
  GiaTri(DoiTuong o) : v(std::move(o)) {}
};

// Tên kiểu: "null", "bool", "int", "double", "string", "array", "object".
std::string tenKieu(const GiaTri& g);

// Tuần tự hoá ra chuỗi JSON gọn (không khoảng trắng).
std::string tuanTuHoa(const GiaTri& g);

// Tra giá trị theo đường dẫn, vd ".a.b[2].c".
std::optional<GiaTri> layTheoDuong(const GiaTri& g, std::string_view duong);

// Số giá trị trong cây (kể cả chính g).
std::size_t demNut(const GiaTri& g);

// So sánh bằng sâu.
bool operator==(const GiaTri& a, const GiaTri& b);
