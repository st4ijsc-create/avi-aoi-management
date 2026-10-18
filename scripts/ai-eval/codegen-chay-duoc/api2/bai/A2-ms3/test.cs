using System.Data;
using Microsoft.Data.SqlClient;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  static List<string> Chay(string cs, DateTime tu, DateTime den) {
    var (cot, kieu, dong) = TroTsql.Doc(cs, TroTsql.LoiGiai, CommandType.Text,
      new SqlParameter("@Tu", SqlDbType.DateTime2) { Scale = 0, Value = tu },
      new SqlParameter("@Den", SqlDbType.DateTime2) { Scale = 0, Value = den });
    Kiem(string.Join(",", cot) == "Khung,SoBanGhi,TrungBinh", "cot: " + string.Join(",", cot));
    Kiem(kieu[1] == typeof(int), "SoBanGhi phai int, thay " + kieu[1].Name);
    return dong.Select(r => $"{((DateTime)r[0]!):HH:mm}|{r[1]}|{(r[2] == null ? "NULL" : ((decimal)r[2]!).ToString(System.Globalization.CultureInfo.InvariantCulture))}").ToList();
  }
  public static int Main() {
    try {
      var cs = TroTsql.TaoCsdl();
      try {
        TroTsql.ChayLo(cs, @"CREATE TABLE dbo.DoKiem(Id int identity primary key, May nvarchar(10) not null, Luc datetime2(0) not null, GiaTri decimal(9,2) not null);
          INSERT dbo.DoKiem(May, Luc, GiaTri) VALUES
            (N'M01', '2026-10-18 00:07:00', 10.00), (N'M01', '2026-10-18 00:14:59', 11.00), (N'M02', '2026-10-18 00:15:00', 20.00),
            (N'M01', '2026-10-18 00:52:00', 1.00), (N'M02', '2026-10-18 00:53:00', 2.00), (N'M02', '2026-10-18 00:54:00', 2.00),
            (N'M01', '2026-10-17 23:59:59', 99.00), (N'M01', '2026-10-18 01:00:00', 99.00);");
        var a = Chay(cs, new DateTime(2026, 10, 18, 0, 0, 0), new DateTime(2026, 10, 18, 1, 0, 0));
        Kiem(string.Join(" ", a) == "00:00|2|10.50 00:15|1|20.00 00:30|0|NULL 00:45|3|1.67", "4 khung: " + string.Join(" ", a));
        var b = Chay(cs, new DateTime(2026, 10, 18, 0, 5, 0), new DateTime(2026, 10, 18, 0, 35, 0));
        Kiem(string.Join(" ", b) == "00:05|3|13.67 00:20|0|NULL", "can theo @Tu le: " + string.Join(" ", b));
      } finally { TroTsql.XoaCsdl(); }
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
