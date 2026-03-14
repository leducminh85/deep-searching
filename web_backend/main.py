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



from typing import Optional, List, Tuple, Dict, Any

async def get_data_internal(
    query: Optional[str] = None, 
    page: int = 1, 
    page_size: int = 200, 
    sort_by: str = "Created At", 
    sort_order: str = "desc", 
    mode: str = "or", 
    min_views: Optional[int] = None, 
    max_views: Optional[int] = None, 
    start_date: Optional[str] = None, 
    end_date: Optional[str] = None, 
    channels: Optional[str] = None
):
    """Lấy dữ liệu từ Database, hỗ trợ tìm kiếm, phân trang và sắp xếp server-side, cùng với bộ lọc nâng cao."""
    global _cached_data
    column_map = {
        "title": "title", "url": "url", "link": "url", "views": "views",
        "date_published": "date_published", "date published": "date_published",
        "channel_name": "channel_name", "channel name": "channel_name",
        "created_at": "created_at", "created at": "created_at",
        "thumbnail": "thumbnail", "caption": "caption", "summary": "summary"
    }
    normalized_sort = str(sort_by).lower().strip()
    db_sort_column = column_map.get(normalized_sort, "created_at")
    is_descending = (str(sort_order).lower() == "desc")
    start = (page - 1) * page_size
    end = start + page_size - 1

    # Chỉ dùng cache nếu KHÔNG có bất kỳ bộ lọc nào
    has_filters = any([query, min_views, max_views, start_date, end_date, channels])
    if not has_filters and page == 1 and db_sort_column == "created_at" and is_descending and _cached_data is not None:
        return _cached_data

    if not supabase:
        print("⚠️ Supabase chưa được cấu hình.")
        return [], 0
    
    try:
        builder = supabase.table("videos").select("title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at", count="exact")
        
        # 1. Xử lý tìm kiếm từ khóa
        if query:
            # Tách từ khóa theo dấu phẩy, nếu không có thì tách theo dấu cách
            if "," in query:
                keywords = [k.strip() for k in query.split(",") if k.strip()]
            else:
                keywords = [k.strip() for k in query.split() if k.strip()]
                
            if keywords:
                search_fields = ["title", "summary", "caption", "channel_name"]
                if mode == "and":
                    for kw in keywords:
                        # Thêm dấu ngoặc kép bao quanh pattern để tránh lỗi parse khi có ký tự đặc biệt
                        pattern = f'"%{kw}%"'
                        builder = builder.or_(",".join([f"{f}.ilike.{pattern}" for f in search_fields]))
                else:
                    or_conds = []
                    for kw in keywords:
                        pattern = f'"%{kw}%"'
                        for f in search_fields: 
                            or_conds.append(f"{f}.ilike.{pattern}")
                    if or_conds: 
                        builder = builder.or_(",".join(or_conds))
        
        # 2. Xử lý bộ lọc nâng cao
        if min_views is not None:
            builder = builder.gte("views", min_views)
        if max_views is not None:
            builder = builder.lte("views", max_views)
        if start_date:
            builder = builder.gte("date_published", start_date)
        if end_date:
            builder = builder.lte("date_published", end_date)
        if channels:
            channel_list = [c.strip() for c in channels.split(",") if c.strip()]
            if channel_list:
                builder = builder.in_("channel_name", channel_list)

        try:
            response = builder.order(db_sort_column, desc=is_descending).range(start, end).execute()
        except Exception as e:
            # Fallback nếu search timeout (giữ nguyên logic cũ nhưng có thêm filter nếu possible)
            if query and ("57014" in str(e) or "timeout" in str(e).lower()):
                print(f"⚠️ Search timeout. Fallback to Title/Channel only...")
                builder = supabase.table("videos").select("title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at", count="exact")
                # Áp dụng lại các filter nâng cao
                if min_views is not None: builder = builder.gte("views", min_views)
                if max_views is not None: builder = builder.lte("views", max_views)
                if start_date: builder = builder.gte("date_published", start_date)
                if end_date: builder = builder.lte("date_published", end_date)
                if channels: builder = builder.in_("channel_name", [c.strip() for c in channels.split(",") if c.strip()])
                
                limit_f = ["title", "channel_name"]
                if mode == "and":
                    for kw in keywords:
                        pattern = f'"%{kw}%"'
                        builder = builder.or_(",".join([f"{f}.ilike.{pattern}" for f in limit_f]))
                else:
                    or_c = []
                    for kw in keywords:
                        pattern = f'"%{kw}%"'
                        for f in limit_f: or_c.append(f"{f}.ilike.{pattern}")
                    if or_c: builder = builder.or_(",".join(or_c))
                response = builder.order(db_sort_column, desc=is_descending).range(start, end).execute()
            else:
                raise e
        
        records = response.data if response.data else []
        total_count = response.count if response.count is not None else 0
        formatted = []
        for r in records:
            formatted.append({
                "Title": r.get("title", ""), "URL": r.get("url", ""), "Channel Name": r.get("channel_name", ""),
                "Views": r.get("views", 0), "Date Published": r.get("date_published", ""),
                "Thumbnail": r.get("thumbnail", ""), "Caption": r.get("caption", ""), "Summary": r.get("summary", "")
            })
        if not has_filters and page == 1 and db_sort_column == "created_at" and is_descending:
             _cached_data = (formatted, total_count)
        return formatted, total_count
    except Exception as e:
        print(f"❌ Database error: {e}")
        return [], 0

@app.get("/api/data")
async def get_data(
    q: Optional[str] = None, 
    page: int = 1, 
    size: int = 200, 
    sort: str = "Created At", 
    order: str = "desc", 
    mode: str = "or",
    min_views: Optional[int] = None,
    max_views: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channels: Optional[str] = None
):
    try:
        # Nhận đúng các tham số q, page, size, sort, order, mode và filters
        data, total = await get_data_internal(q, page, size, sort, order, mode, min_views, max_views, start_date, end_date, channels)
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

@app.get("/api/channels")
async def get_channels():
    """Lấy danh sách các kênh duy nhất để hiển thị trong bộ lọc."""
    if not supabase: return []
    try:
        response = supabase.table("videos").select("channel_name").execute()
        channels = sorted(list(set([r.get("channel_name") for r in response.data if r.get("channel_name")])))
        return channels
    except Exception as e:
        print(f"❌ Error fetching channels: {e}")
        return []

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
