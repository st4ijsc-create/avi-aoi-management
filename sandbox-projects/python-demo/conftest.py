# Đưa thư mục dự án vào sys.path để `from tinh import …` chạy được khi pytest gọi từ gốc repo.
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
