import subprocess
import os
import sys
import time
from datetime import datetime

# Cấu hình đường dẫn (Lấy đường dẫn tuyệt đối của thư mục chứa script này)
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}")

def run_command(command, cwd=None):
    """Chạy lệnh command và đợi hoàn tất"""
    log(f"Đang chạy: {' '.join(command)}")
    try:
        # Chạy command và in output trực tiếp ra màn hình
        process = subprocess.Popen(
            command,
            cwd=cwd or PROJECT_DIR,
            stdout=sys.stdout,
            stderr=sys.stderr,
            text=True
        )
        process.wait()
        
        if process.returncode == 0:
            log(f"✅ Hoàn tất thành công: {' '.join(command)}")
            return True
        else:
            log(f"❌ Lỗi khi chạy (Mã lỗi {process.returncode}): {' '.join(command)}")
            return False
    except Exception as e:
        log(f"❌ Lỗi hệ thống: {e}")
        return False

def main():
    log("=== BẮT ĐẦU QUY TRÌNH HÀNG NGÀY ===")
    
    # 1. Chạy update-data.py
    if not run_command(["python", "update-data.py"]):
        log("⚠️ Dừng quy trình do lỗi ở bước 1.")
        return

    # 2. Chạy video_analysis_v2.py
    if not run_command(["python", "video_analysis_v2.py"]):
        log("⚠️ Dừng quy trình do lỗi ở bước 2.")
        return

    # 3. Chạy import-data.js
    # Lưu ý: Script này được khuyến nghị chạy từ thư mục nextjs-app
    nextjs_app_dir = os.path.join(PROJECT_DIR, "nextjs-app")
    if not run_command(["node", "scripts/import-data.js"], cwd=nextjs_app_dir):
        log("⚠️ Dừng quy trình do lỗi ở bước 3.")
        return

    log("=== TẤT CẢ CÁC BƯỚC ĐÃ HOÀN TẤT THÀNH CÔNG ===")

if __name__ == "__main__":
    main()
