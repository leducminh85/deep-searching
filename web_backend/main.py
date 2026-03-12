from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import pandas as pd
import os
import shutil
import json
from dotenv import load_dotenv
from supabase import create_client, Client
import tempfile
from contextlib import asynccontextmanager

# Load environment variables
load_dotenv()

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "excel-data")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Leducminh123")

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Use /tmp for data storage because Vercel/serverless environments are read-only
# except for the /tmp directory.
DATA_FILE_NAME = "data.xlsx"
LOCAL_DATA_PATH = os.path.join(tempfile.gettempdir(), DATA_FILE_NAME)

# Global cache for data
_cached_data = None
JSON_CACHE_PATH = os.path.join(tempfile.gettempdir(), "data_cache.json")

async def sync_from_cloud():
    """Download data.xlsx from Supabase to local temporary storage."""
    if not supabase:
        print("⚠️ Supabase not configured. Skipping sync.")
        return False
    
    try:
        # Check if file exists in bucket
        with open(LOCAL_DATA_PATH, "wb") as f:
            res = supabase.storage.from_(SUPABASE_BUCKET).download(DATA_FILE_NAME)
            f.write(res)
        print(f"✅ Successfully synced {DATA_FILE_NAME} from cloud.")
        return True
    except Exception as e:
        print(f"❌ Error syncing from cloud: {e}")
        return False

async def sync_to_cloud():
    """Upload local data.xlsx to Supabase."""
    if not supabase:
        print("⚠️ Supabase not configured. Skipping upload.")
        return False
    
    try:
        with open(LOCAL_DATA_PATH, "rb") as f:
            # upsert=True allows overwriting the existing file
            supabase.storage.from_(SUPABASE_BUCKET).upload(
                path=DATA_FILE_NAME, 
                file=f,
                file_options={"x-upsert": "true"}
            )
        print(f"✅ Successfully uploaded {DATA_FILE_NAME} to cloud.")
        return True
    except Exception as e:
        print(f"❌ Error uploading to cloud: {e}")
        return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Pre-load data
    print("🚀 App starting... Pre-loading data into cache.")
    try:
        await get_data_internal()
        print("✅ Data pre-loaded successfully.")
    except Exception as e:
        print(f"⚠️ Failed to pre-load data: {e}")
    yield
    # Shutdown: Clean up if needed
    print("👋 App shutting down.")

app = FastAPI(lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable GZip compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

async def get_data_internal():
    """Lấy dữ liệu trực tiếp từ Supabase Table thay vì file Excel."""
    global _cached_data
    
    # 1. Trả về RAM cache nếu có (siêu tốc)
    if _cached_data is not None:
        return _cached_data

    # 2. Truy vấn trực tiếp từ Supabase
    if not supabase:
        print("⚠️ Supabase chưa được cấu hình.")
        return []
    
    try:
        print("🔍 Đang tải dữ liệu từ Database...")
        # Lấy toàn bộ dữ liệu từ bảng 'videos'
        # Nếu dữ liệu quá lớn trong tương lai, có thể thêm .limit(1000) hoặc xử lý phân trang
        response = supabase.table("videos").select("*").order("created_at", desc=True).execute()
        
        records = response.data if response.data else []
        
        # 3. Đồng bộ tên cột cho Frontend (Map lại các cột nếu cần)
        # Frontend đang mong đợi các key giống file Excel cũ
        formatted_records = []
        for r in records:
            formatted_records.append({
                "Title": r.get("title", ""),
                "URL": r.get("url", ""),
                "Channel Name": r.get("channel_name", ""),
                "Views": r.get("views", 0),
                "Date Published": r.get("date_published", ""),
                "Thumbnail": r.get("thumbnail", ""),
                "Caption": r.get("caption", ""),
                "Summary": r.get("summary", "")
            })

        _cached_data = formatted_records
        return _cached_data

    except Exception as e:
        print(f"❌ Lỗi khi truy vấn Database: {e}")
        return []

@app.get("/api/data")
async def get_data():
    try:
        data = await get_data_internal()
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/verify")
async def verify_password(password: str = Form(...)):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    return {"status": "ok"}

@app.post("/api/upload")
async def upload_file(password: str = Form(...), file: UploadFile = File(...)):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
        
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are allowed")

    try:
        # Save locally first
        with open(LOCAL_DATA_PATH, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Sync to Cloud Storage
        success = await sync_to_cloud()
        
        if not success:
             return {"message": "File saved locally but cloud sync failed. Changes might be lost on next restart."}
        
        # Invalidate caches so next request reloads from new file
        global _cached_data
        _cached_data = None
        if os.path.exists(JSON_CACHE_PATH):
            os.remove(JSON_CACHE_PATH)

        return {"message": "File uploaded and synced to cloud storage successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
