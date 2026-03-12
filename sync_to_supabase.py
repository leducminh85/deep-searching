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
BATCH_SIZE = 500 # Chia nhỏ để đẩy lên không bị lỗi timeout

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

        # Chạy Upsert theo từng Batch
        for i in range(0, total, BATCH_SIZE):
            batch = records[i : i + BATCH_SIZE]
            try:
                # upsert dựa trên cột 'url' (đã set UNIQUE trong DB)
                supabase.table("videos").upsert(batch, on_conflict="url").execute()
                print(f"✅ Đã xong: {min(i + BATCH_SIZE, total)} / {total}")
            except Exception as e:
                print(f"⚠️ Lỗi ở batch {i}: {e}")

        print("\n🎉 HOÀN TẤT ĐỒNG BỘ DỮ LIỆU!")

    except Exception as e:
        print(f"❌ Lỗi xử lý: {e}")

if __name__ == "__main__":
    sync()
