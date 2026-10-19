#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "bang_diem.hpp"
#include "kt.hpp"

using DsHs = std::vector<HocSinh>;
using DsXh = std::vector<XepHang>;
using DsTen = std::vector<std::string>;

int main() {
  kt::chay("cung tong khac toan khong dong hang", [] {
    DsHs ds{{"Nga", "B1", 8, 8, 8}, {"Mai", "B1", 8, 9, 7}, {"Lan", "B2", 10, 7, 7}};
    DsXh mong{{1, "Lan", "B2", 24, 10}, {2, "Mai", "B1", 24, 8}, {2, "Nga", "B1", 24, 8}};
    KT_BANG(mong, xepHang(ds));
  });
  kt::chay("on dinh khi trung khoa hoan toan", [] {
    DsHs ds{{"Hoa", "C2", 7, 7, 7}, {"Hoa", "C1", 7, 7, 7}, {"Hoa", "C3", 7, 7, 7}, {"Anh", "C9", 1, 1, 1}};
    DsXh mong{{1, "Hoa", "C2", 21, 7}, {1, "Hoa", "C1", 21, 7}, {1, "Hoa", "C3", 21, 7}, {4, "Anh", "C9", 3, 1}};
    KT_BANG(mong, xepHang(ds));
  });
  kt::chay("ten so sanh theo byte", [] {
    DsHs ds{{"Ánh", "D1", 5, 5, 5}, {"an", "D1", 5, 5, 5}, {"Zed", "D1", 5, 5, 5}};
    DsXh mong{{1, "Zed", "D1", 15, 5}, {1, "an", "D1", 15, 5}, {1, "Ánh", "D1", 15, 5}};
    KT_BANG(mong, xepHang(ds));
  });
  kt::chay("danh sach rong", [] {
    DsHs ds;
    KT_DUNG(xepHang(ds).empty());
    KT_DUNG(tenDatChuan(ds, 0).empty());
    KT_DUNG(!trungBinhLop(ds, "A1").has_value());
    KT_BANG(std::size_t{0}, tachDatTruot(ds, 10));
    KT_DUNG(thuKhoaTheoLop(ds).empty());
  });
  kt::chay("diem ngoai 0..10 nem invalid_argument", [] {
    KT_NEM(std::invalid_argument, tongDiem(HocSinh{"X", "E1", 11, 0, 0}));
    KT_NEM(std::invalid_argument, tongDiem(HocSinh{"X", "E1", 0, -1, 0}));
    DsHs ds{{"Tot", "E1", 9, 9, 9}, {"Hong", "E1", 5, 5, 12}, {"Vua", "E2", 1, 1, 1}};
    KT_NEM(std::invalid_argument, xepHang(ds));
    KT_NEM(std::invalid_argument, tenDatChuan(ds, 0));
    KT_NEM(std::invalid_argument, trungBinhLop(ds, "E2"));
    KT_NEM(std::invalid_argument, thuKhoaTheoLop(ds));
    DsHs truoc{{"Vua", "E2", 1, 1, 1}, {"Hong", "E1", 5, 5, 12}, {"Tot", "E1", 9, 9, 9}};
    DsHs saoChep = truoc;
    KT_NEM(std::invalid_argument, tachDatTruot(saoChep, 5));
    KT_BANG(std::string("Vua"), saoChep[0].ten);
    KT_BANG(std::string("Hong"), saoChep[1].ten);
    KT_BANG(std::string("Tot"), saoChep[2].ten);
  });
  kt::chay("tach dat truot on dinh", [] {
    DsHs ds{{"a", "L", 1, 1, 1}, {"b", "L", 9, 9, 9}, {"c", "L", 5, 5, 5}, {"d", "L", 2, 2, 2}, {"e", "L", 6, 4, 5}};
    KT_BANG(std::size_t{3}, tachDatTruot(ds, 15));
    DsTen thuTu;
    for (const auto& h : ds) thuTu.push_back(h.ten);
    KT_BANG((DsTen{"b", "c", "e", "a", "d"}), thuTu);
    KT_BANG(std::size_t{0}, tachDatTruot(ds, 31));
    KT_BANG(std::size_t{5}, tachDatTruot(ds, 0));
  });
  kt::chay("ten dat chuan bien nguong", [] {
    DsHs ds{{"p", "L", 10, 10, 10}, {"q", "L", 0, 10, 10}, {"r", "L", 7, 7, 7}};
    KT_BANG((DsTen{"p", "r"}), tenDatChuan(ds, 7));
    KT_BANG((DsTen{"p", "q", "r"}), tenDatChuan(ds, 0));
    KT_BANG((DsTen{"p"}), tenDatChuan(ds, 10));
    KT_DUNG(tenDatChuan(ds, 11).empty());
  });
  kt::chay("trung binh lop phan biet hoa thuong", [] {
    DsHs ds{{"u", "a1", 9, 9, 9}, {"v", "A1", 10, 9, 9}, {"w", "A1", 10, 10, 9}, {"x", "A1", 0, 0, 0}};
    auto hoa = trungBinhLop(ds, "A1");
    KT_DUNG(hoa.has_value());
    KT_GAN(19.0, *hoa, 1e-9);
    auto thuong = trungBinhLop(ds, "a1");
    KT_DUNG(thuong.has_value());
    KT_GAN(27.0, *thuong, 1e-9);
    KT_DUNG(!trungBinhLop(ds, "A2").has_value());
  });
  kt::chay("thu khoa theo lop", [] {
    DsHs ds{{"Tu", "K2", 9, 9, 9}, {"Ba", "K1", 6, 6, 6}, {"Ca", "K1", 8, 8, 8}, {"Am", "K2", 9, 9, 9},
            {"Oc", "K0", 7, 7, 7}};
    DsXh mong{{4, "Oc", "K0", 21, 7}, {3, "Ca", "K1", 24, 8}, {1, "Am", "K2", 27, 9}};
    KT_BANG(mong, thuKhoaTheoLop(ds));
  });
  kt::chay("du lieu lon bat bien xep hang", [] {
    const int n = 20000;
    DsHs ds;
    ds.reserve(n);
    std::uint64_t x = 20261018;
    auto ke = [&x]() {
      x = x * 6364136223846793005ull + 1442695040888963407ull;
      return static_cast<int>((x >> 33) % 11);
    };
    for (int i = 0; i < n; ++i) {
      HocSinh h{"hs" + std::to_string(i % 4999), "L" + std::to_string(i), 0, 0, 0};
      h.toan = ke();
      h.van = ke();
      h.anh = ke();
      ds.push_back(h);
    }
    DsXh bang = xepHang(ds);
    KT_BANG(static_cast<std::size_t>(n), bang.size());
    std::vector<char> daThay(n, 0);
    for (std::size_t i = 0; i < bang.size(); ++i) {
      const XepHang& c = bang[i];
      const int goc = std::stoi(c.lop.substr(1));
      KT_DUNG(goc >= 0 && goc < n && !daThay[goc]);
      daThay[goc] = 1;
      const HocSinh& h = ds[goc];
      KT_BANG(h.ten, c.ten);
      KT_BANG(h.toan + h.van + h.anh, c.tong);
      KT_BANG(h.toan, c.toan);
      if (i == 0) {
        KT_BANG(1, c.hang);
        continue;
      }
      const XepHang& t = bang[i - 1];
      KT_DUNG(t.tong >= c.tong);
      if (t.tong == c.tong) KT_DUNG(t.toan >= c.toan);
      const bool dong = t.tong == c.tong && t.toan == c.toan;
      if (dong) {
        KT_DUNG(t.ten <= c.ten);
        if (t.ten == c.ten) KT_DUNG(std::stoi(t.lop.substr(1)) < goc);
        KT_BANG(t.hang, c.hang);
      } else {
        KT_BANG(static_cast<int>(i) + 1, c.hang);
      }
    }
  });
  return kt::ketThuc();
}
