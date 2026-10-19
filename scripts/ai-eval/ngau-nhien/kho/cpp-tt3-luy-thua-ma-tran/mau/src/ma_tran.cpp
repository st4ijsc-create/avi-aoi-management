#include "ma_tran.hpp"

#include <stdexcept>

namespace {
constexpr std::uint64_t M_TOI_DA = 1ull << 63;

void kiemM(std::uint64_t m) {
  if (m == 0 || m > M_TOI_DA) throw std::invalid_argument("m phai trong [1, 2^63]");
}

std::size_t kiemVuong(const MaTran& a) {
  if (a.empty()) throw std::invalid_argument("ma tran rong");
  for (const auto& hang : a)
    if (hang.size() != a.size()) throw std::invalid_argument("ma tran khong vuong");
  return a.size();
}

// m da hop le; a, b bat ky.
std::uint64_t nhanModTrong(std::uint64_t a, std::uint64_t b, std::uint64_t m) {
  a %= m;
  b %= m;
  if (m <= (1ull << 32)) return a * b % m;
  std::uint64_t kq = 0;
  while (b > 0) {
    if (b & 1) {
      kq += a;  // kq, a < m <= 2^63 => khong tran
      if (kq >= m) kq -= m;
    }
    a += a;
    if (a >= m) a -= m;
    b >>= 1;
  }
  return kq;
}

MaTran donVi(std::size_t n, std::uint64_t m) {
  MaTran r(n, std::vector<std::uint64_t>(n, 0));
  for (std::size_t i = 0; i < n; ++i) r[i][i] = 1 % m;
  return r;
}

MaTran nhanTrong(const MaTran& a, const MaTran& b, std::uint64_t m) {
  const std::size_t n = a.size();
  MaTran c(n, std::vector<std::uint64_t>(n, 0));
  for (std::size_t i = 0; i < n; ++i)
    for (std::size_t k = 0; k < n; ++k) {
      const std::uint64_t aik = a[i][k] % m;
      if (aik == 0) continue;
      for (std::size_t j = 0; j < n; ++j) {
        std::uint64_t s = c[i][j] + nhanModTrong(aik, b[k][j], m);
        if (s >= m) s -= m;
        c[i][j] = s;
      }
    }
  return c;
}

MaTran luyThuaTrong(MaTran a, std::uint64_t n, std::uint64_t m) {
  MaTran r = donVi(a.size(), m);
  for (auto& hang : a)
    for (auto& x : hang) x %= m;
  while (n > 0) {
    if (n & 1) r = nhanTrong(r, a, m);
    n >>= 1;
    if (n > 0) a = nhanTrong(a, a, m);
  }
  return r;
}
}  // namespace

std::uint64_t nhanMod(std::uint64_t a, std::uint64_t b, std::uint64_t m) {
  kiemM(m);
  return nhanModTrong(a, b, m);
}

MaTran nhanMaTran(const MaTran& a, const MaTran& b, std::uint64_t m) {
  kiemM(m);
  if (kiemVuong(a) != kiemVuong(b)) throw std::invalid_argument("khac kich thuoc");
  return nhanTrong(a, b, m);
}

MaTran luyThua(const MaTran& a, std::uint64_t n, std::uint64_t m) {
  kiemM(m);
  kiemVuong(a);
  return luyThuaTrong(a, n, m);
}

std::uint64_t fibonacci(std::uint64_t n, std::uint64_t m) {
  kiemM(m);
  MaTran q{{1, 1}, {1, 0}};
  return luyThuaTrong(q, n, m)[0][1];
}

std::uint64_t demDuongDi(const std::vector<std::vector<int>>& ke, int tu, int den, std::uint64_t n, std::uint64_t m) {
  kiemM(m);
  const int v = static_cast<int>(ke.size());
  for (const auto& ds : ke)
    for (int x : ds)
      if (x < 0 || x >= v) throw std::invalid_argument("dinh ke ngoai pham vi");
  if (tu < 0 || tu >= v || den < 0 || den >= v) throw std::out_of_range("tu/den ngoai pham vi");
  MaTran a(static_cast<std::size_t>(v), std::vector<std::uint64_t>(static_cast<std::size_t>(v), 0));
  for (int u = 0; u < v; ++u)
    for (int x : ke[static_cast<std::size_t>(u)]) {
      auto& o = a[static_cast<std::size_t>(u)][static_cast<std::size_t>(x)];
      o = (o + 1) % m;
    }
  return luyThuaTrong(a, n, m)[static_cast<std::size_t>(tu)][static_cast<std::size_t>(den)];
}
