#pragma once
#include <cstdint>
#include <vector>

// Ma trận vuông n x n: mat[i][j] là phần tử hàng i, cột j.
using MaTran = std::vector<std::vector<std::uint64_t>>;

// (a * b) mod m, chính xác với mọi a, b 64 bit.
std::uint64_t nhanMod(std::uint64_t a, std::uint64_t b, std::uint64_t m);

// (a x b) mod m.
MaTran nhanMaTran(const MaTran& a, const MaTran& b, std::uint64_t m);

// a^n mod m (luỹ thừa nhanh).
MaTran luyThua(const MaTran& a, std::uint64_t n, std::uint64_t m);

// F(n) mod m, F(0) = 0, F(1) = 1.
std::uint64_t fibonacci(std::uint64_t n, std::uint64_t m);

// Số đường đi (walk) có ĐÚNG n cạnh từ đỉnh tu tới đỉnh den, mod m.
std::uint64_t demDuongDi(const std::vector<std::vector<int>>& ke, int tu, int den, std::uint64_t n, std::uint64_t m);
