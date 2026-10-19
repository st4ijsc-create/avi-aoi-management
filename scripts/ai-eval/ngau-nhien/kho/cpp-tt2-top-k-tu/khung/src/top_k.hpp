#pragma once
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// Một mục kết quả: (từ đã chuẩn hoá, số lần xuất hiện).
using DemTu = std::pair<std::string, std::size_t>;

// Tách văn bản thành các từ đã chuẩn hoá, giữ đúng thứ tự xuất hiện (kể cả lặp lại).
std::vector<std::string> tachTu(std::string_view vanBan);

// k từ xuất hiện nhiều nhất, theo thứ tự xếp hạng.
std::vector<DemTu> topKTu(std::string_view vanBan, std::size_t k);
