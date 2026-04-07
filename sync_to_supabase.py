import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import math

# Load cấu hình từ .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
FILE_PATH = "data.xlsx"
SHEET_NAME = "NEW_CACHE_DATA_HIDDEN_"
BATCH_SIZE = 10 # Chia nhỏ để đẩy lên không bị lỗi timeout
START_ROW = 1    # Dòng bắt đầu trong Excel (Dòng 1 là tiêu đề)
END_ROW = None   # Dòng kết thúc trong Excel (None = chạy tới hết)

def sync():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Lỗi: Chưa cấu hình SUPABASE_URL hoặc SUPABASE_KEY trong file .env")
        return

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"📂 Đang đọc file {FILE_PATH}...")
    try:
        # Đọc toàn bộ file Excel
        df = pd.read_excel(FILE_PATH, sheet_name=SHEET_NAME)
        
        # Làm sạch cột (Chuẩn hóa tên cột để khớp với Database)
        df.columns = [str(c).lower().replace(' ', '_') for c in df.columns]
        
        # Map lại các cột quan trọng nếu tên trong Excel khác
        column_mapping = {
            'link': 'url',
            'channel': 'channel_name',
            'published': 'date_published'
        }
        df = df.rename(columns=column_mapping)
        
        # Chỉ giữ lại các cột có trong DB
        db_columns = ['title', 'url', 'channel_name', 'views', 'date_published', 'thumbnail', 'caption', 'summary']
        existing_cols = [c for c in db_columns if c in df.columns]
        df = df[existing_cols]
        
        # Xử lý dữ liệu trống và định dạng
        df = df.fillna("")
        df['views'] = pd.to_numeric(df['views'], errors='coerce').fillna(0).astype(int)
        
        # Hàm lấy YouTube ID để tạo thumbnail
        def get_yt_id(url):
            if not url or not isinstance(url, str): return None
            import re
            match = re.search(r'(?:v=|\/)([0-9A-Za-z_-]{11}).*', url)
            return match.group(1) if match else None

        # Xử lý cột ngày tháng cho đúng định dạng PostgreSQL
        if 'date_published' in df.columns:
            def clean_date(val):
                if not val or str(val).strip() in ["", "nan", "#"]:
                    return None
                val_str = str(val)
                # Xử lý định dạng phức tạp "Mon Jul 05 2021 00:00:00 GMT+0700 (Indochina Time)"
                if "(" in val_str:
                    val_str = val_str.split("(")[0].strip()
                if "GMT" in val_str:
                    val_str = val_str.replace("GMT", "").strip()
                try:
                    return pd.to_datetime(val_str).isoformat()
                except:
                    return None
            
            df['date_published'] = df['date_published'].apply(clean_date)

        # Xử lý Thumbnail: Nếu trống thì tự tạo từ URL youtube
        if 'thumbnail' in df.columns:
            def fix_thumbnail(row):
                thumb = str(row.get('thumbnail', '')).strip()
                if thumb in ["", "nan", "#"]:
                    yt_id = get_yt_id(row.get('url', ''))
                    if yt_id:
                        return f"https://img.youtube.com/vi/{yt_id}/mqdefault.jpg"
                return thumb
            
            df['thumbnail'] = df.apply(fix_thumbnail, axis=1)
        
        # Chuyển đổi sang list dictionary để upload
        records = df.to_dict(orient='records')
        total = len(records)
        print(f"📊 Tìm thấy {total} dòng dữ liệu. Bắt đầu đẩy lên Supabase...")

        import time
        
        # Tính toán range dữ liệu dựa trên Dòng Excel (Row Number)
        # Giả sử dòng 1 là tiêu đề, nên index 0 của DataFrame chính là dòng 2 Excel
        start_idx = max(0, START_ROW - 2)
        if END_ROW:
            # Ví dụ: END_ROW = 100, ta muốn lấy đến hết dòng 100 (index 98). Slice records[start:99] sẽ lấy đến index 98.
            end_idx = min(END_ROW - 1, total) 
        else:
            end_idx = total
            
        print(f"🚀 Cấu hình: Đẩy từ Dòng {START_ROW} đến { 'Cuối file' if END_ROW is None else 'Dòng ' + str(END_ROW)}")
        print(f"📍 Tổng số phần tử cần xử lý: {max(0, end_idx - start_idx)}\n")

        # Chạy Upsert theo từng Batch
        for i in range(start_idx, end_idx, BATCH_SIZE):
            batch = records[i : min(i + BATCH_SIZE, end_idx)]
            
            max_retries = 5
            for attempt in range(max_retries + 1):
                try:
                    # upsert dựa trên cột 'url' (đã set UNIQUE trong DB)
                    supabase.table("videos-ver1").upsert(batch, on_conflict="url").execute()
                    print(f"✅ Đã xong: Dòng {min(i + BATCH_SIZE + 1, end_idx + 1)} / {total + 1}")
                    break # Thành công thì thoát vòng lặp retry
                except Exception as e:
                    if attempt < max_retries:
                        print(f"🔄 Thử lại tại dòng {i+2} (lần {attempt + 1}/{max_retries}) do lỗi: {e}")
                        time.sleep(5) # Đợi 1 phút trước khi thử lại
                    else:
                        print(f"❌ Đã thử {max_retries} lần nhưng vẫn lỗi. Bỏ qua batch này. Lỗi cuối: {e}")

        print("\n🎉 HOÀN TẤT ĐỒNG BỘ DỮ LIỆU!")

    except Exception as e:
        print(f"❌ Lỗi xử lý: {e}")

if __name__ == "__main__":
    sync()
