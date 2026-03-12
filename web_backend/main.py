from fastapi import FastAPI, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import os
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
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Leducminh123")

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Global cache for data (only small subset)
_cached_data = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Pre-load small subset if possible
    print("🚀 App starting... Memory-optimized mode.")
    yield
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

async def get_data_internal(query: str = None, page: int = 1, page_size: int = 200, sort_by: str = "Created At", sort_order: str = "desc"):
    """Lấy dữ liệu từ Database, hỗ trợ tìm kiếm, phân trang và sắp xếp server-side."""
    global _cached_data
    
    # Map tên cột từ Frontend sang Database (chấp nhận nhiều định dạng)
    column_map = {
        "title": "title",
        "url": "url",
        "link": "url",
        "views": "views",
        "date_published": "date_published",
        "date published": "date_published",
        "channel_name": "channel_name",
        "channel name": "channel_name",
        "created_at": "created_at",
        "created at": "created_at",
        "thumbnail": "thumbnail",
        "caption": "caption",
        "summary": "summary"
    }
    
    # Chuẩn hóa key đầu vào
    normalized_sort = str(sort_by).lower().strip()
    db_sort_column = column_map.get(normalized_sort, "created_at")
    is_descending = (str(sort_order).lower() == "desc")

    # Tính toán vị trí bắt đầu và kết thúc (0-indexed)
    start = (page - 1) * page_size
    end = start + page_size - 1

    # RAM Cache tối thiểu cho trang chủ mặc định
    if not query and page == 1 and db_sort_column == "created_at" and is_descending and _cached_data is not None:
        return _cached_data

    if not supabase:
        print("⚠️ Supabase chưa được cấu hình.")
        return [], 0
    
    try:
        # Lấy các cột cần thiết, bao gồm cả created_at để sort nếu cần
        builder = supabase.table("videos").select("title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at", count="exact")
        
        if query:
            search_str = f"%{query}%"
            builder = builder.or_(f"title.ilike.{search_str},summary.ilike.{search_str},caption.ilike.{search_str}")
        
        # Thực hiện truy vấn với sắp xếp và phân trang
        response = builder.order(db_sort_column, desc=is_descending).range(start, end).execute()
        
        records = response.data if response.data else []
        total_count = response.count if response.count is not None else 0
        
        # Format lại data sang key chuẩn cho Frontend
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

        # Cache kết quả trang đầu mặc định
        if not query and page == 1 and db_sort_column == "created_at" and is_descending:
            _cached_data = (formatted_records, total_count)
            
        return formatted_records, total_count

    except Exception as e:
        print(f"❌ Lỗi khi truy vấn Database: {e}")
        return [], 0

@app.get("/api/data")
async def get_data(q: str = None, page: int = 1, size: int = 200, sort: str = "created_at", order: str = "desc"):
    try:
        # Size mặc định giảm xuống 200 để an toàn hơn cho RAM
        data, total = await get_data_internal(q, page, size, sort, order)
        return {
            "data": data,
            "total": total,
            "page": page,
            "page_size": size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/verify")
async def verify_password(password: str = Form(...)):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
