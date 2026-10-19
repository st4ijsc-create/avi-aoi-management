// Trợ giúp chấm T-SQL của bộ tasks-api2 — chạy THẬT trên SQL Server LocalDB, phiên bản riêng `AiEvalApi2`
// (cham.mjs dựng/khởi động và đưa chuỗi kết nối qua biến môi trường AI_EVAL_TSQL).
// Mỗi lượt: CSDL ngẫu nhiên `ev_…` với tệp dữ liệu nằm TRONG thư mục bài ⇒ chạy `sol.sql` ⇒ so ⇒ DROP.
// CSDL `ev_…` sót từ lượt bị giết (quá giờ) được dọn ở lượt sau (cũ hơn 30 phút).
using System.Data;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

public static class TroTsql {
  static string? _ten;
  static string Goc => Environment.GetEnvironmentVariable("AI_EVAL_TSQL") ?? throw new InvalidOperationException("thiếu AI_EVAL_TSQL (chạy qua cham.mjs)");
  static string Master => new SqlConnectionStringBuilder(Goc) { InitialCatalog = "master", Pooling = false }.ConnectionString;

  public static string LoiGiai => File.ReadAllText(Path.Combine(Directory.GetCurrentDirectory(), "sol.sql"));

  public static string TaoCsdl() {
    var ten = "ev_" + Guid.NewGuid().ToString("N")[..12];
    var thuMuc = Path.Combine(Directory.GetCurrentDirectory(), "csdl");
    Directory.CreateDirectory(thuMuc);
    using (var c = new SqlConnection(Master)) {
      c.Open();
      DonCu(c);
      Lenh(c, $"CREATE DATABASE [{ten}] ON PRIMARY (NAME = N'{ten}', FILENAME = N'{Path.Combine(thuMuc, ten + ".mdf")}') LOG ON (NAME = N'{ten}_log', FILENAME = N'{Path.Combine(thuMuc, ten + "_log.ldf")}')");
    }
    _ten = ten;
    return new SqlConnectionStringBuilder(Goc) { InitialCatalog = ten, Pooling = false }.ConnectionString;
  }

  public static void XoaCsdl() {
    if (_ten == null) return;
    try {
      using var c = new SqlConnection(Master);
      c.Open();
      Lenh(c, $"IF DB_ID(N'{_ten}') IS NOT NULL BEGIN ALTER DATABASE [{_ten}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_ten}]; END");
    } catch (Exception e) { Console.Error.WriteLine("không xoá được CSDL " + _ten + ": " + e.Message); }
    _ten = null;
  }

  static void DonCu(SqlConnection c) {
    var cu = new List<string>();
    using (var cmd = new SqlCommand("SELECT name FROM sys.databases WHERE name LIKE N'ev[_]%' AND create_date < DATEADD(MINUTE, -30, GETDATE())", c))
    using (var r = cmd.ExecuteReader()) while (r.Read()) cu.Add(r.GetString(0));
    foreach (var t in cu) {
      try { Lenh(c, $"ALTER DATABASE [{t}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{t}];"); } catch { /* bỏ qua */ }
    }
  }

  static void Lenh(SqlConnection c, string sql) { using var cmd = new SqlCommand(sql, c) { CommandTimeout = 120 }; cmd.ExecuteNonQuery(); }

  /// <summary>Tách theo dòng GO (như sqlcmd/SSMS).</summary>
  public static IEnumerable<string> TachLo(string sql) =>
    Regex.Split(sql, @"^\s*GO\s*;?\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Where(s => !string.IsNullOrWhiteSpace(s));

  public static void ChayLo(string cs, string sql) {
    using var c = new SqlConnection(cs);
    c.Open();
    foreach (var lo in TachLo(sql)) Lenh(c, lo);
  }

  /// <summary>Chạy một lệnh (văn bản hoặc thủ tục) có tham số, đọc tập kết quả ĐẦU TIÊN (DBNull ⇒ null) kèm tên + kiểu cột.</summary>
  public static (string[] Cot, Type[] Kieu, List<object?[]> Dong) Doc(string cs, string sql, CommandType kieu, params SqlParameter[] thamSo) {
    using var c = new SqlConnection(cs);
    c.Open();
    using var cmd = new SqlCommand(sql, c) { CommandType = kieu, CommandTimeout = 120 };
    cmd.Parameters.AddRange(thamSo);
    using var r = cmd.ExecuteReader();
    var cot = Enumerable.Range(0, r.FieldCount).Select(r.GetName).ToArray();
    var kt = Enumerable.Range(0, r.FieldCount).Select(r.GetFieldType).ToArray();
    var dong = new List<object?[]>();
    while (r.Read()) {
      var o = new object?[r.FieldCount];
      for (int i = 0; i < r.FieldCount; i++) o[i] = r.IsDBNull(i) ? null : r.GetValue(i);
      dong.Add(o);
    }
    return (cot, kt, dong);
  }
}
