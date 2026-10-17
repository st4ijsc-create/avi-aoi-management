# Đưa thư mục dự án vào sys.path để `import diem` chạy được khi pytest gọi từ gốc dự án hoặc từ nơi khác.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
