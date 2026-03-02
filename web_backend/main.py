from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import os
import shutil

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", "data.xlsx")
ADMIN_PASSWORD = "admin" # Simple password for upload

@app.get("/api/data")
def get_data():
    if not os.path.exists(DATA_FILE_PATH):
        return {"data": []}
    
    try:
        # Try reading specific sheet, fallback to first sheet
        try:
            df = pd.read_excel(DATA_FILE_PATH, sheet_name="NEW_CACHE_DATA_HIDDEN_", engine="openpyxl")
        except ValueError:
            df = pd.read_excel(DATA_FILE_PATH, engine="openpyxl")
            
        df = df.fillna("")
        records = df.to_dict(orient="records")
        return {"data": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload")
async def upload_file(password: str = Form(...), file: UploadFile = File(...)):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
        
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are allowed")

    try:
        with open(DATA_FILE_PATH, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"message": "File uploaded successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
