#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "csv.hpp"
#include "kt.hpp"
#include "ton_kho.hpp"

using S = std::string;
using DsBg = std::vector<BanGhi>;

static DsBg doc(const S& s) {
  std::istringstream vao(s);
  return docCsv(vao);
}

static std::size_t dongLoi(const S& s) {
  try {
    doc(s);
  } catch (const LoiCsv& e) {
    return e.dong;
  }
  return 0;
}

int main() {
  kt::chay("csv xuong dong trong nhay crlf va dong trong", [] {
    KT_BANG((DsBg{{"a", "x\r\ny"}, {"b", "c"}}), doc("a,\"x\r\ny\"\r\nb,c\r\n"));
    KT_BANG((DsBg{{""}}), doc("\"\"\n"));
    KT_BANG((DsBg{{"", ""}}), doc(",\n"));
    KT_BANG((DsBg{{"a", ""}}), doc("a,"));
    KT_BANG((DsBg{{"a"}, {"b"}}), doc("\n\na\n\r\n\nb"));
    KT_BANG((DsBg{{"a\rb", "c"}}), doc("a\rb,c\n"));
  });
  kt::chay("csv nhay giua truong va khoang trang giu nguyen", [] {
    KT_BANG((DsBg{{"ab\"c", "d"}}), doc("ab\"c,d\n"));
    KT_BANG((DsBg{{" a ", " b "}}), doc(" a , b \n"));
    KT_BANG((DsBg{{" \"x\"", "y"}}), doc(" \"x\",y"));
    KT_BANG((DsBg{{"", "\"", ","}}), doc("\"\",\"\"\"\",\",\""));
  });
  kt::chay("csv loi cu phap bao dong vat ly", [] {
    KT_BANG(std::size_t{1}, dongLoi("\"abc\"x,1\n"));
    KT_BANG(std::size_t{2}, dongLoi("a\nb,\"c\"d\n"));
    KT_BANG(std::size_t{2}, dongLoi("x\n\"abc\ndef"));
    KT_BANG(std::size_t{2}, dongLoi("\"a\nb\"c"));
    KT_BANG(std::size_t{3}, dongLoi("h\n\n\"q\" ,1"));
    KT_NEM(std::runtime_error, doc("\"mo"));
  });
  kt::chay("csv rong", [] {
    KT_DUNG(doc("").empty());
    KT_DUNG(doc("\n\r\n\n").empty());
  });
  kt::chay("docSoLuong bien", [] {
    KT_BANG(0LL, docSoLuong("0"));
    KT_BANG(710LL, docSoLuong("007.1"));
    KT_BANG(99999999999999LL, docSoLuong("999999999999.99"));
    KT_BANG(1200LL, docSoLuong("12"));
    for (const char* s : {"", "1.", ".5", "-1", "1,5", " 1", "1 ", "1.234", "1e2", "1000000000000", "+3", "1..2", "0x1"})
      KT_NEM(std::invalid_argument, docSoLuong(s));
  });
  kt::chay("inSoLuong bien", [] {
    KT_BANG(S("0.00"), inSoLuong(0));
    KT_BANG(S("0.05"), inSoLuong(5));
    KT_BANG(S("-0.05"), inSoLuong(-5));
    KT_BANG(S("1.00"), inSoLuong(100));
    KT_BANG(S("-1234.56"), inSoLuong(-123456));
    KT_BANG(S("999999999999.99"), inSoLuong(99999999999999LL));
  });
  kt::chay("tieu de sai nem invalid_argument", [] {
    KT_NEM(std::invalid_argument, tinhTonKho(DsBg{}));
    KT_NEM(std::invalid_argument, tinhTonKho(DsBg{{"ma", "ten", "loai"}}));
    KT_NEM(std::invalid_argument, tinhTonKho(DsBg{{"MA", "ten", "loai", "so_luong"}}));
    KT_NEM(std::invalid_argument, tinhTonKho(DsBg{{"ma", "ten", "loai", "so_luong", ""}}));
  });
  kt::chay("tinh ton kho loi dong canh bao ten dau tien", [] {
    DsBg bg{{"ma", "ten", "loai", "so_luong"},
            {"X1", "Ten A", "NHAP", "3"},
            {"X1", "Ten B", "XUAT", "1.25"},
            {"X2", "t", "NHAP"},
            {"", "t", "NHAP", "1"},
            {"X3", "t", "nhap", "1"},
            {"X3", "t", "NHAP", "1.234"},
            {"X3", "t", "XUAT", "0.5"},
            {"X3", "t2", "XUAT", "1"},
            {"X3", "t", "NHAP", "2"},
            {"A0", "z", "NHAP", "0"},
            {"", "t", "BAD", "x"},
            {"X9", "t", "BAD", "x"}};
    KetQuaTonKho mong;
    mong.hang = {{"A0", "z", 0}, {"X1", "Ten A", 175}, {"X3", "t", 50}};
    mong.canhBao = {{8, "X3", -50}, {9, "X3", -150}};
    mong.loi = {{4, "so truong"}, {5, "ma rong"}, {6, "loai"}, {7, "so luong"}, {12, "ma rong"}, {13, "loai"}};
    KetQuaTonKho kq = tinhTonKho(bg);
    KT_BANG(mong.hang, kq.hang);
    KT_BANG(mong.canhBao, kq.canhBao);
    KT_BANG(mong.loi, kq.loi);
  });
  kt::chay("bao cao can cot theo ky tu unicode", [] {
    KetQuaTonKho kq;
    kq.hang = {{"SP-01", "Bút bi xanh", 1250}, {"SP-2", "Giấy", -300}};
    kq.canhBao = {{3, "SP-2", -300}};
    kq.loi = {{5, "so luong"}};
    const S mong = S("MA   ") + "  " + "TEN        " + "  " + "  TON\n" +
                   "SP-01" + "  " + "Bút bi xanh" + "  " + "12.50\n" +
                   "SP-2 " + "  " + "Giấy       " + "  " + "-3.00\n" +
                   "CANH BAO: ban ghi 3, ma SP-2, ton -3.00\n" +
                   "LOI: ban ghi 5: so luong\n";
    KT_BANG(mong, baoCao(kq));
    KT_BANG(S("MA  TEN  TON\n"), baoCao(KetQuaTonKho{}));
  });
  kt::chay("xu ly csv dau cuoi", [] {
    std::istringstream vao(
        "ma,ten,loai,so_luong\r\n"
        "K1,\"Ốc vít, M3\",NHAP,100\r\n"
        "K1,\"khác\",XUAT,30.5\r\n"
        "\r\n"
        "K0,\"Keo \"\"502\"\"\",NHAP,1.5\r\n"
        "K0,x,XUAT,abc\r\n");
    const S mong = S("MA") + "  " + "TEN       " + "  " + "  TON\n" +
                   "K0" + "  " + "Keo \"502\" " + "  " + " 1.50\n" +
                   "K1" + "  " + "Ốc vít, M3" + "  " + "69.50\n" +
                   "LOI: ban ghi 5: so luong\n";
    KT_BANG(mong, xuLyCsv(vao));
    std::istringstream chiTieuDe("ma,ten,loai,so_luong");
    KT_BANG(S("MA  TEN  TON\n"), xuLyCsv(chiTieuDe));
    std::istringstream hong("ma,ten,loai,so_luong\n\"K1,x,NHAP,1\n");
    KT_NEM(LoiCsv, xuLyCsv(hong));
  });
  return kt::ketThuc();
}
