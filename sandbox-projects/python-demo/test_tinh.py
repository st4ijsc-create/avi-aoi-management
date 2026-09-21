import unittest
from tinh import ty_le_loi

class TestTyLeLoi(unittest.TestCase):
    def test_binh_thuong(self):
        self.assertEqual(ty_le_loi(100, 5), 5.0)
    def test_tong_khong(self):
        self.assertEqual(ty_le_loi(0, 5), 0.0)
    def test_lam_tron(self):
        self.assertEqual(ty_le_loi(3, 1), 33.33)
