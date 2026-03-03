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
    """Internal function to load and cache data."""
    global _cached_data
    
    # 1. Return memory cache if available
    if _cached_data is not None:
        return _cached_data

    # 2. Try loading from disk JSON cache (much faster than Excel)
    if os.path.exists(JSON_CACHE_PATH):
        try:
            with open(JSON_CACHE_PATH, "r", encoding="utf-8") as f:
                _cached_data = json.load(f)
                return _cached_data
        except Exception as e:
            print(f"⚠️ Disk cache load failed: {e}")

    # 3. If no cache, perform full load from Excel
    if not os.path.exists(LOCAL_DATA_PATH):
        await sync_from_cloud()

    if not os.path.exists(LOCAL_DATA_PATH):
        # Fallback to a local file if it exists in the app package
        pkg_data_path = os.path.join(os.path.dirname(__file__), DATA_FILE_NAME)
        if os.path.exists(pkg_data_path):
            shutil.copy(pkg_data_path, LOCAL_DATA_PATH)
        else:
            return []
    
    try:
        # Optimization: Use calamine engine (much faster than openpyxl)
        try:
            df = pd.read_excel(LOCAL_DATA_PATH, sheet_name="NEW_CACHE_DATA_HIDDEN_", engine="calamine")
        except Exception:
            try:
                df = pd.read_excel(LOCAL_DATA_PATH, engine="calamine")
            except Exception:
                # Fallback to openpyxl if calamine is not available
                df = pd.read_excel(LOCAL_DATA_PATH, engine="openpyxl")

            
        df = df.fillna("")
        cols_to_keep = [col for col in df.columns if not str(col).startswith("Unnamed")]
        df = df[cols_to_keep]
        df = df.loc[:, (df != "").any(axis=0) | (df.columns == "Thumbnail")]
        
        records = df.to_dict(orient="records")
        if "Thumbnail" in df.columns:
            for record in records:
                if "Thumbnail" not in record: record["Thumbnail"] = ""

        # 4. Save to both caches
        _cached_data = records
        try:
            with open(JSON_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(records, f, ensure_ascii=False)
        except Exception as e:
            print(f"⚠️ Failed to save disk cache: {e}")

        return records
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        raise e

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
