# Deep Video Search 🔍

A powerful, high-performance web application designed for searching and analyzing video metadata at scale.

## 🚀 Key Features

- **Blazing Fast Search**: Backend-optimized filtering with keyword highlighting.
- **Rich Visualization**: 16:9 thumbnail previews, formatted view counts, and standardized date displays (dd/mm/yyyy).
- **Infinite Scrolling**: Smooth loading of large datasets with server-side pagination (200 records per batch).
- **Advanced Sorting**: Server-side sorting by Title, Views, Date Published, and more.
- **Premium UI/UX**:
  - Modern dark mode with glassmorphism aesthetics.
  - Sticky headers and toolbars for seamless navigation.
  - Real-time animated loading progress indicators.
  - Responsive design for all screen sizes.
- **Dual Backend Support**:
    - **Local Mode**: Node.js/Express server handling local `.xlsx` files.
    - **Cloud Mode**: FastAPI server integrated with Supabase for high-concurrency database storage.

## 🛠️ Technology Stack

### Frontend
- **Framework**: React 19 + Vite
- **Styling**: Vanilla CSS (Modern design system, CSS Variables)
- **Icons**: Lucide React
- **Routing**: React Router DOM

### Backend (Option 1: Supabase/FastAPI)
- **Framework**: FastAPI (Python)
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Render / Vercel compatible

### Backend (Option 2: Local Excel)
- **Framework**: Node.js + Express
- **Processing**: XLSX (SheetJS) for parsing Excel metadata.

## ⚙️ Configuration

Create a `.env` file in `web_frontend/`:
```env
VITE_API_BASE_URL=http://localhost:8000
```

Create a `.env` file in `web_backend/`:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
ADMIN_PASSWORD=your_secure_password
```

## 🏃 Getting Started

### 1. Frontend Setup
```bash
cd web_frontend
npm install
npm run dev
```

### 2. Backend Setup
**FastAPI (Database Mode):**
```bash
cd web_backend
pip install -r requirements.txt
python main.py
```

**Express (Local Mode):**
```bash
cd web_frontend
node server.js
```

## 📂 Project Structure

- `web_frontend/`: React source code, components, and static assets.
- `web_backend/`: FastAPI implementation and database logic.
- `sync_to_supabase.py`: Utility script to migrate Excel data to Supabase.
- `render.yaml`: Deployment configuration for Render.com.

## 📝 License

Proprietary. All rights reserved.
