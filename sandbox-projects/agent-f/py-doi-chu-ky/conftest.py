# Đưa thư mục dự án vào sys.path để `import kho` chạy được khi pytest gọi từ gốc repo.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
