#include "kt.hpp"
#include "ma_tran.hpp"

int main() {
  kt::chay("fibonacci nho", [] {
    KT_BANG(std::uint64_t{55}, fibonacci(10, 1000));
    KT_BANG(std::uint64_t{40}, fibonacci(30, 1000));  // F(30) = 832040
  });
  kt::chay("nhan ma tran 2x2", [] {
    MaTran a{{1, 2}, {3, 4}};
    MaTran b{{5, 6}, {7, 8}};
    MaTran mong{{19, 22}, {43, 50}};
    KT_BANG(mong, nhanMaTran(a, b, 100));
    MaTran mod7{{5, 1}, {1, 1}};
    KT_BANG(mod7, nhanMaTran(a, b, 7));
  });
  kt::chay("dem duong di tam giac", [] {
    std::vector<std::vector<int>> ke{{1}, {2}, {0}};
    KT_BANG(std::uint64_t{1}, demDuongDi(ke, 0, 0, 3, 1000));
    KT_BANG(std::uint64_t{0}, demDuongDi(ke, 0, 0, 4, 1000));
    KT_BANG(std::uint64_t{1}, demDuongDi(ke, 0, 2, 5, 1000));
  });
  return kt::ketThuc();
}
