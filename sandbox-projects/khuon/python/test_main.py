import unittest

from main import chao


class KiemChao(unittest.TestCase):
    def test_chao(self) -> None:
        self.assertEqual(chao("A"), "Xin chào, A!")


if __name__ == "__main__":
    unittest.main()
