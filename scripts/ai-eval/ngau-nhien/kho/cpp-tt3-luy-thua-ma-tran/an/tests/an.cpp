#include <cstdint>
#include <stdexcept>
#include <vector>

#include "kt.hpp"
#include "ma_tran.hpp"

using U = std::uint64_t;
using Ke = std::vector<std::vector<int>>;

static const U HAI_MU_63 = U{1} << 63;
static const U M40 = (U{1} << 40) - 87;  // > 2^32: tich hai so du co the toi ~2^80

int main() {
  kt::chay("nhanMod so lon khong tran", [] {
    KT_BANG(U{1}, nhanMod(HAI_MU_63 - 1, HAI_MU_63 - 1, HAI_MU_63));
    KT_BANG(U{939816995902964958ull}, nhanMod(UINT64_MAX, UINT64_MAX, 1000000000000000009ull));
    KT_BANG(U{805382677176ull}, nhanMod(123456789012ull, 987654321098ull, M40));
    KT_BANG(U{824633723216ull}, nhanMod((U{1} << 39) + 5, (U{1} << 39) + 7, M40));
    KT_BANG(U{4611686018427387629ull}, nhanMod((U{1} << 62) + 11, HAI_MU_63 - 25, HAI_MU_63));
    KT_BANG(U{0}, nhanMod(12345, 678, 1));
  });
  kt::chay("m khong hop le nem invalid_argument", [] {
    KT_NEM(std::invalid_argument, nhanMod(3, 4, 0));
    KT_NEM(std::invalid_argument, nhanMod(3, 4, HAI_MU_63 + 1));
    KT_NEM(std::invalid_argument, fibonacci(5, 0));
    KT_NEM(std::invalid_argument, nhanMaTran(MaTran{{1}}, MaTran{{1}}, 0));
    KT_NEM(std::invalid_argument, luyThua(MaTran{{1}}, 3, UINT64_MAX));
    KT_NEM(std::invalid_argument, demDuongDi(Ke{{0}}, 0, 0, 1, 0));
  });
  kt::chay("ma tran sai kich thuoc", [] {
    KT_NEM(std::invalid_argument, nhanMaTran(MaTran{}, MaTran{}, 7));
    KT_NEM(std::invalid_argument, nhanMaTran(MaTran{{1, 2}, {3}}, MaTran{{1, 0}, {0, 1}}, 7));
    KT_NEM(std::invalid_argument, nhanMaTran(MaTran{{1, 2}, {3, 4}}, MaTran{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, 7));
    KT_NEM(std::invalid_argument, luyThua(MaTran{{1, 2, 3}, {4, 5, 6}}, 2, 7));
    KT_NEM(std::invalid_argument, luyThua(MaTran{}, 0, 7));
  });
  kt::chay("luy thua 0 va m bang 1", [] {
    MaTran a{{2, 3}, {5, 7}};
    KT_BANG((MaTran{{1, 0}, {0, 1}}), luyThua(a, 0, 7));
    KT_BANG((MaTran{{0, 0}, {0, 0}}), luyThua(a, 0, 1));
    KT_BANG((MaTran{{0, 0}, {0, 0}}), luyThua(a, 5, 1));
    KT_BANG(U{0}, fibonacci(0, 10));
    KT_BANG(U{1}, fibonacci(1, 10));
    KT_BANG(U{1}, fibonacci(2, 10));
    KT_BANG(U{0}, fibonacci(1, 1));
  });
  kt::chay("phan tu lon hon m duoc rut gon", [] {
    KT_BANG((MaTran{{2}}), nhanMaTran(MaTran{{10}}, MaTran{{10}}, 7));
    KT_BANG((MaTran{{5}}), luyThua(MaTran{{UINT64_MAX}}, 1, 10));
    // (UINT64_MAX mod 2^63) = 2^63 - 1; binh phuong mod 2^63 = 1
    KT_BANG((MaTran{{1}}), luyThua(MaTran{{UINT64_MAX}}, 2, HAI_MU_63));
  });
  kt::chay("fibonacci n rat lon", [] {
    KT_BANG(U{209783453}, fibonacci(1000000000000000000ull, 1000000007));
    KT_BANG(U{2880067194370816120ull}, fibonacci(90, HAI_MU_63));
    KT_BANG(U{2976788378267100930ull}, fibonacci(93, HAI_MU_63));
    KT_BANG(U{7785411635540810213ull}, fibonacci(999999999999999989ull, HAI_MU_63));
    KT_BANG(U{19839515385ull}, fibonacci(1000000000000000000ull, M40));
  });
  kt::chay("luy thua ma tran 3x3 mod lon", [] {
    MaTran a{{1, 1, 0}, {1, 0, 1}, {0, 1, 1}};
    const U x = 1537229405816881152ull, y = 1537229405816881151ull;
    KT_BANG((MaTran{{x, y, y}, {y, x, y}, {y, y, x}}), luyThua(a, 1000000000000000000ull, (U{1} << 61) - 1));
    const U p = 238050571967ull, q = 238050571966ull;
    KT_BANG((MaTran{{p, p, q}, {p, q, p}, {q, p, p}}), luyThua(a, 123456789, M40));
  });
  kt::chay("dem duong di da canh va khuyen", [] {
    // 0->0 (khuyen), 0->1 hai canh, 1->0
    Ke ke{{0, 1, 1}, {0}};
    KT_BANG(U{1}, demDuongDi(ke, 0, 0, 0, 1000));
    KT_BANG(U{0}, demDuongDi(ke, 0, 1, 0, 1000));
    KT_BANG(U{1}, demDuongDi(ke, 0, 0, 1, 1000));
    KT_BANG(U{2}, demDuongDi(ke, 0, 1, 1, 1000));
    KT_BANG(U{3}, demDuongDi(ke, 0, 0, 2, 1000));
    KT_BANG(U{5}, demDuongDi(ke, 0, 0, 3, 1000));
    KT_BANG(U{6}, demDuongDi(ke, 0, 1, 3, 1000));
    KT_BANG(U{2}, demDuongDi(ke, 1, 1, 3, 1000));
    KT_BANG(U{1}, demDuongDi(ke, 0, 0, 3, 2));
  });
  kt::chay("dem duong di dau vao loi", [] {
    Ke ke{{1}, {0}};
    KT_NEM(std::out_of_range, demDuongDi(ke, -1, 0, 1, 10));
    KT_NEM(std::out_of_range, demDuongDi(ke, 0, 2, 1, 10));
    KT_NEM(std::out_of_range, demDuongDi(Ke{}, 0, 0, 0, 10));
    KT_NEM(std::invalid_argument, demDuongDi(Ke{{1}, {5}}, 0, 0, 1, 10));
    KT_NEM(std::invalid_argument, demDuongDi(Ke{{-1}, {0}}, 0, 0, 1, 10));
  });
  kt::chay("do thi 30 dinh n rat lon", [] {
    const int v = 30;
    Ke ke(v);
    for (int u = 0; u < v; ++u) ke[u] = {(u + 1) % v, (u * 7 + 3) % v, (u * u) % v};
    KT_BANG(U{434034038}, demDuongDi(ke, 0, 29, 1000000000000000000ull, 1000000007));
    KT_BANG(U{780296911}, demDuongDi(ke, 5, 5, 1000000000000000000ull, 1000000007));
    KT_BANG(U{238486029396ull}, demDuongDi(ke, 3, 17, 987654321987654321ull, M40));
  });
  return kt::ketThuc();
}
