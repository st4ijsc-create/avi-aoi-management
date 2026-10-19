#include <string>
#include <vector>

#include "kt.hpp"
#include "top_k.hpp"

int main() {
  kt::chay("tach tu co ban", [] {
    std::vector<std::string> mong{"hello", "world", "hello", "world", "42"};
    KT_BANG(mong, tachTu("Hello, World! hello-world 42"));
  });
  kt::chay("top k pha hoa theo tu", [] {
    std::vector<DemTu> mong{{"a", 2}, {"b", 2}};
    KT_BANG(mong, topKTu("b a c b a d", 2));
  });
  kt::chay("k lon hon so tu khac nhau", [] {
    std::vector<DemTu> mong{{"x", 2}, {"y", 1}};
    KT_BANG(mong, topKTu("x y X", 10));
  });
  return kt::ketThuc();
}
