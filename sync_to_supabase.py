import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import time

# Load cấu hình từ .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
FILE_PATH = "data.xlsx"
SHEET_NAME = "Channel Lisitng" # Chuyển sang đồng bộ danh sách Kênh

def sync_channels():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL or SUPABASE_KEY not configured in .env")
        return

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"📂 Opening file {FILE_PATH} from sheet '{SHEET_NAME}'...")
    try:
        # Đọc danh sách kênh từ Excel
        df = pd.read_excel(FILE_PATH, sheet_name=SHEET_NAME)
        
        # Chuẩn hóa tên cột
        df.columns = [str(c).lower().replace(' ', '_') for c in df.columns]
        
        # Mapping các cột quan trọng cho bảng channels trên Supabase
        # Giả sử bảng trên Supabase tên là 'channels' và có các cột: name, url, created_at
        column_mapping = {
            'tên_kênh': 'name',
            'link_kênh': 'url'
        }
        df = df.rename(columns=column_mapping)
        
        # Chỉ giữ lại các cột cần thiết cho việc quản lý kênh
        required_cols = ['name', 'url']
        existing_cols = [c for c in required_cols if c in df.columns]
        
        if 'url' not in existing_cols:
            print("❌ Error: Column 'Link kênh' not found in Excel sheet.")
            return

        df = df[existing_cols]
        df = df.dropna(subset=['url']) # Bỏ các dòng không có Link
        df = df.fillna("")
        
        # Chuyển đổi sang list dictionary để upload
        records = df.to_dict(orient='records')
        print(f"📊 Found {len(records)} channels. Syncing to Supabase...")

        # Thực hiện Upsert vào bảng 'channels' 
        # (Lưu ý: Bảng này dùng để quản lý nguồn quét, không phải lưu video)
        try:
            supabase.table("channels").upsert(records, on_conflict="url").execute()
            print("✅ SUCCESS: Channels list synchronized to Supabase.")
        except Exception as e:
            print(f"❌ Error syncing to 'channels' table: {e}")
            print("💡 Tip: Ensure table 'channels' exists on Supabase with 'url' as a unique column.")

    except Exception as e:
        print(f"❌ System Error: {e}")

if __name__ == "__main__":
    print("🚀 SUPABASE SYNC (CHANNELS ONLY MODE)")
    print("--------------------------------------")
    sync_channels()
    print("--------------------------------------")
    print("Note: Video data is now stored locally only. This script only syncs channel sources.")
