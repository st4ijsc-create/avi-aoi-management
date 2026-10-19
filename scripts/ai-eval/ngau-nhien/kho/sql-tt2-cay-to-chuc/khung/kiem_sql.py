"""Trợ giúp chấm bài SQL (SQLite qua sqlite3). ĐỪNG SỬA tệp này (tệp được bảo vệ — sửa ⇒ bài TRƯỢT)."""
import pathlib
import sqlite3

GOC = pathlib.Path(__file__).resolve().parent


def ket_noi():
    """Cơ sở dữ liệu trong bộ nhớ, BẬT khoá ngoại."""
    con = sqlite3.connect(":memory:")
    con.execute("PRAGMA foreign_keys = ON")
    return con


def doc(rel):
    return (GOC / rel).read_text(encoding="utf-8")


def chay_kich_ban(con, rel):
    """Chạy một tệp .sql nhiều câu lệnh (DDL, INSERT, trigger…)."""
    con.executescript(doc(rel))


def truy_van(con, rel, tham_so=()):
    """Chạy tệp .sql chứa ĐÚNG MỘT câu SELECT (được dùng CTE) và trả mọi hàng (list tuple)."""
    sql = doc(rel).strip()
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()
    return con.execute(sql, tham_so).fetchall()


def cot(con, rel, tham_so=()):
    """Như truy_van nhưng trả thêm tên cột: (ten_cot, hang)."""
    sql = doc(rel).strip()
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()
    cur = con.execute(sql, tham_so)
    return [d[0] for d in cur.description], cur.fetchall()
