#include <sstream>
#include <string>

#include "kho_kv.hpp"
#include "kt.hpp"
#include "lenh.hpp"

using S = std::string;

static S chay(KhoKV& kho, const S& kichBan, std::size_t& loi) {
  std::istringstream vao(kichBan);
  std::ostringstream ra;
  loi = chayLenh(kho, vao, ra);
  return ra.str();
}

int main() {
  kt::chay("giao dich long hoan tac tung cap", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb = "SET a 1\nBEGIN\nSET a 2\nBEGIN\nSET a 3\nGET a\nROLLBACK\nGET a\nROLLBACK\nGET a\nROLLBACK\n";
    KT_BANG(S("3\n2\n1\nNO TRANSACTION\n"), chay(kho, kb, loi));
    KT_BANG(std::size_t{0}, loi);
  });
  kt::chay("commit dong tat ca giao dich", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb = "BEGIN\nSET a 1\nBEGIN\nSET a 2\nCOMMIT\nGET a\nROLLBACK\nCOMMIT\n";
    KT_BANG(S("2\nNO TRANSACTION\nNO TRANSACTION\n"), chay(kho, kb, loi));
    KT_BANG(std::size_t{0}, loi);
    KT_BANG(std::size_t{0}, kho.doSau());
  });
  kt::chay("unset trong giao dich va dem gia tri", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb =
        "SET a x\nSET b x\nBEGIN\nUNSET a\nCOUNT x\nSET b y\nCOUNT x\nCOUNT y\nROLLBACK\nCOUNT x\nCOUNT y\nGET a\nGET b\n";
    KT_BANG(S("1\n0\n1\n2\n0\nx\nx\n"), chay(kho, kb, loi));
  });
  kt::chay("sua mot khoa nhieu lan roi hoan tac", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb = "SET z 0\nBEGIN\nSET k 1\nSET k 2\nUNSET k\nSET k 3\nUNSET z\nSET z 5\nSIZE\nROLLBACK\nGET k\nCOUNT 3\nGET z\n"
                 "COUNT 5\nCOUNT 0\nSIZE\n";
    KT_BANG(S("2\nNULL\n0\n0\n0\n1\n1\n"), chay(kho, kb, loi));
  });
  kt::chay("thong diep loi va dem loi", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb = "FOO x\nset a\nGET\nGET a b\nBEGIN x\ncount\nFrobnicate 1 2 3\nset a 7\nget a\nRollBack\nend 1\n";
    const S mong =
        "ERR unknown command: FOO\n"
        "ERR wrong number of arguments for SET\n"
        "ERR wrong number of arguments for GET\n"
        "ERR wrong number of arguments for GET\n"
        "ERR wrong number of arguments for BEGIN\n"
        "ERR wrong number of arguments for COUNT\n"
        "ERR unknown command: Frobnicate\n"
        "7\n"
        "NO TRANSACTION\n"
        "ERR wrong number of arguments for END\n";
    KT_BANG(mong, chay(kho, kb, loi));
    KT_BANG(std::size_t{8}, loi);
  });
  kt::chay("khoang trang crlf dong trong", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const S kb = "\n   \n\t\r\n  SET  a\t 5\r\nGET a\r\n\r\nCOUNT 5\r\nGET a\t\t";
    KT_BANG(S("5\n1\n5\n"), chay(kho, kb, loi));
    KT_BANG(std::size_t{0}, loi);
  });
  kt::chay("END dung va khong doc them", [] {
    KhoKV kho;
    std::size_t loi = 99;
    std::istringstream vao("SET a 1\nBEGIN\nEND\nGET a\nCOMMIT\n");
    std::ostringstream ra;
    loi = chayLenh(kho, vao, ra);
    KT_BANG(S(""), ra.str());
    KT_BANG(std::size_t{0}, loi);
    KT_BANG(std::size_t{1}, kho.doSau());
    S conLai;
    std::getline(vao, conLai);
    KT_BANG(S("GET a"), conLai);
  });
  kt::chay("api tra ve dung", [] {
    KhoKV kho;
    KT_DUNG(!kho.hoanTac());
    KT_DUNG(!kho.xacNhan());
    KT_DUNG(!kho.xoa("khong"));
    kho.dat("a", "v");
    kho.dat("a", "v");
    KT_BANG(std::size_t{1}, kho.dem("v"));
    KT_BANG(std::size_t{1}, kho.kichThuoc());
    kho.batDau();
    kho.batDau();
    KT_BANG(std::size_t{2}, kho.doSau());
    KT_DUNG(kho.xoa("a"));
    KT_DUNG(!kho.xoa("a"));
    KT_BANG(std::size_t{0}, kho.dem("v"));
    KT_DUNG(kho.hoanTac());
    KT_BANG(std::size_t{1}, kho.doSau());
    KT_BANG(std::optional<S>("v"), kho.lay("a"));
    KT_BANG(std::size_t{1}, kho.dem("v"));
    KT_DUNG(kho.xacNhan());
    KT_BANG(std::size_t{0}, kho.doSau());
    KT_BANG(std::size_t{0}, kho.dem(""));
  });
  kt::chay("hieu nang dem va hoan tac tren kho lon", [] {
    KhoKV kho;
    for (int i = 0; i < 100000; ++i) kho.dat("k" + std::to_string(i), "v" + std::to_string(i % 100));
    std::size_t tong = 0;
    for (int i = 0; i < 100000; ++i) tong += kho.dem("v" + std::to_string(i % 200));
    KT_BANG(std::size_t{50000000}, tong);  // 50 000 truy van trung v0..v99, moi gia tri 1000 khoa
    for (int i = 0; i < 20000; ++i) {
      kho.batDau();
      kho.dat("k" + std::to_string(i), "z");
      kho.xoa("k" + std::to_string(i + 1));
      KT_DUNG(kho.hoanTac());
    }
    KT_BANG(std::size_t{100000}, kho.kichThuoc());
    KT_BANG(std::size_t{0}, kho.dem("z"));
    KT_BANG(std::size_t{1000}, kho.dem("v7"));
  });
  kt::chay("kich ban dai", [] {
    KhoKV kho;
    S kb;
    for (int i = 0; i < 30000; ++i) {
      kb += "BEGIN\nSET k" + std::to_string(i % 500) + " " + std::to_string(i) + "\n";
      kb += (i % 3 == 0) ? "ROLLBACK\n" : "COMMIT\n";
    }
    kb += "GET k0\nGET k1\nGET k2\nGET k3\nCOUNT 29999\nSIZE\n";
    std::size_t loi = 99;
    // k0: lan ghi cuoi duoc giu la i = 29500 (29500 % 3 = 1); k1: 29501 (% 3 = 2);
    // k2: 29502 (% 3 = 0) bi hoan tac => 29002 (% 3 = 1); k3: 29503 (% 3 = 1)
    KT_BANG(S("29500\n29501\n29002\n29503\n1\n500\n"), chay(kho, kb, loi));
    KT_BANG(std::size_t{0}, loi);
  });
  return kt::ketThuc();
}
