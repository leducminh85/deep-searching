import express from 'express';
import multer from 'multer';
import cors from 'cors';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.xlsx');
const ADMIN_PASSWORD = 'admin';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());

// Multer config for file uploads
const upload = multer({
    dest: path.join(__dirname, 'tmp_uploads'),
    fileFilter: (req, file, cb) => {
        if (!file.originalname.endsWith('.xlsx')) {
            return cb(new Error('Only .xlsx files are allowed'));
        }
        cb(null, true);
    },
});

// GET /api/data - Read Excel and return JSON
app.get('/api/data', (req, res) => {
    if (!fs.existsSync(DATA_FILE)) {
        return res.json({ data: [] });
    }

    try {
        const workbook = XLSX.readFile(DATA_FILE);

        // Try reading specific sheet, fallback to first sheet
        let sheetName = 'NEW_CACHE_DATA_HIDDEN_';
        if (!workbook.SheetNames.includes(sheetName)) {
            sheetName = workbook.SheetNames[0];
        }

        const sheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        res.json({ data: records });
    } catch (err) {
        res.status(500).json({ detail: err.message });
    }
});

// POST /api/upload - Upload new Excel file
app.post('/api/upload', upload.single('file'), (req, res) => {
    const password = req.body?.password;

    if (password !== ADMIN_PASSWORD) {
        // Clean up temp file if exists
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(401).json({ detail: 'Invalid password' });
    }

    if (!req.file) {
        return res.status(400).json({ detail: 'No file uploaded' });
    }

    try {
        // Move uploaded file to data directory
        fs.copyFileSync(req.file.path, DATA_FILE);
        fs.unlinkSync(req.file.path);
        res.json({ message: 'File uploaded successfully' });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ detail: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ API Server running at http://localhost:${PORT}`);
});
