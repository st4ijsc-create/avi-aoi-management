using System.Data;
using Microsoft.Data.SqlClient;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  static List<string> Goi(string cs, string json) {
    var (cot, _, dong) = TroTsql.Doc(cs, "dbo.NapCauHinh", CommandType.StoredProcedure, new SqlParameter("@json", SqlDbType.NVarChar, -1) { Value = json });
    Kiem(string.Join(",", cot) == "HanhDong,Ma", "cot: " + string.Join(",", cot));
    return dong.Select(r => $"{r[0]}:{r[1]}").ToList();
  }
  public static int Main() {
    try {
      var cs = TroTsql.TaoCsdl();
      try {
        TroTsql.ChayLo(cs, "CREATE TABLE dbo.CauHinh(Ma nvarchar(50) primary key, GiaTri decimal(18,4) not null, DonVi nvarchar(10) null, CapNhat datetime2 not null);");
        TroTsql.ChayLo(cs, TroTsql.LoiGiai);
        var a = Goi(cs, "[{\"ma\":\"toc_do\",\"giaTri\":1500,\"donVi\":\"rpm\"},{\"ma\":\"ap_suat\",\"giaTri\":2.75,\"donVi\":null},{\"ma\":\"nhiệt_độ\",\"giaTri\":65.125,\"donVi\":\"°C\"}]");
        Kiem(string.Join(" ", a) == "INSERT:ap_suat INSERT:nhiệt_độ INSERT:toc_do", "lan 1: " + string.Join(" ", a));
        TroTsql.ChayLo(cs, "UPDATE dbo.CauHinh SET CapNhat = '2000-01-01'");
        var b = Goi(cs, "[{\"ma\":\"toc_do\",\"giaTri\":1500,\"donVi\":\"rpm\"},{\"ma\":\"ap_suat\",\"giaTri\":2.75,\"donVi\":\"bar\"},{\"ma\":\"nhiệt_độ\",\"giaTri\":65.1250,\"donVi\":\"°C\"},{\"ma\":\"luu_luong\",\"giaTri\":0.5,\"donVi\":null}]");
        Kiem(string.Join(" ", b) == "UPDATE:ap_suat INSERT:luu_luong", "lan 2 (NULL→'bar' la khac; giong het khong dung): " + string.Join(" ", b));
        var (_, _, dong) = TroTsql.Doc(cs, "SELECT Ma, GiaTri, DonVi, CASE WHEN CapNhat > '2001-01-01' THEN 1 ELSE 0 END FROM dbo.CauHinh ORDER BY Ma", CommandType.Text);
        string H(object?[] r) => $"{r[0]}={r[1]}{r[2] ?? "∅"}#{r[3]}";
        Kiem(string.Join(" ", dong.Select(H)) == "ap_suat=2.7500bar#1 luu_luong=0.5000∅#1 nhiệt_độ=65.1250°C#0 toc_do=1500.0000rpm#0", "bang: " + string.Join(" ", dong.Select(H)));
        var c = Goi(cs, "[{\"ma\":\"ap_suat\",\"giaTri\":2.75,\"donVi\":null}]");
        Kiem(string.Join(" ", c) == "UPDATE:ap_suat", "'bar'→NULL la khac: " + string.Join(" ", c));
        var d = Goi(cs, "[]");
        Kiem(d.Count == 0, "mang rong ⇒ tap ket qua rong");
        var (_, _, dem) = TroTsql.Doc(cs, "SELECT COUNT(*) FROM dbo.CauHinh", CommandType.Text);
        Kiem((int)dem[0][0]! == 4, "khong duoc xoa dong nao");
      } finally { TroTsql.XoaCsdl(); }
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
