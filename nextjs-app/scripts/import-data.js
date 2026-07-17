/**
 * Script import dữ liệu từ data.xlsx vào PostgreSQL local
 * Chạy từ thư mục nextjs-app để sử dụng node_modules ở đó
 * 
 * Usage: node scripts/import-data.js
 */
import pg from 'pg';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getVideoKey } from '../src/lib/videoUrl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFiles([
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '.env.local'),
]);

function loadEnvFiles(files) {
    for (const file of files) {
        if (fs.existsSync(file)) {
            process.loadEnvFile(file);
        }
    }
}

function getDatabaseUrl() {
    if (process.env.LOCAL_DATABASE_URL) return process.env.LOCAL_DATABASE_URL;
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const password = process.env.POSTGRES_PASSWORD;
    if (!password) {
        throw new Error('Missing database config. Set LOCAL_DATABASE_URL, DATABASE_URL, or POSTGRES_PASSWORD in .env.');
    }

    const user = process.env.POSTGRES_USER || 'postgres';
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    const db = process.env.POSTGRES_DB || 'deep_searching';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

const DATABASE_URL = getDatabaseUrl();
const DATA_FILE = path.resolve(__dirname, '../../data.xlsx');
const SHEET_NAME = 'NEW_CACHE_DATA_HIDDEN_';
const BATCH_SIZE = 100;

async function importData() {
    console.log(`🚀 Starting import process...`);
    console.log(`📂 Target file: ${DATA_FILE}`);
    
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`❌ Error: File not found at ${DATA_FILE}`);
        process.exit(1);
    }

    const pool = new pg.Pool({ 
        connectionString: DATABASE_URL,
        ssl: false
    });

    let workbook;
    try {
        workbook = XLSX.readFile(DATA_FILE);
    } catch (e) {
        console.error(`❌ Cannot read file: ${e.message}`);
        process.exit(1);
    }

    let sheetName = SHEET_NAME;
    if (!workbook.SheetNames.includes(sheetName)) {
        sheetName = workbook.SheetNames[0];
        console.log(`⚠️ Sheet "${SHEET_NAME}" not found. Using: "${sheetName}"`);
    }

    const sheet = workbook.Sheets[sheetName];
    let records = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (records.length === 0) {
        console.log('⚠️ No records found in the sheet.');
        process.exit(0);
    }

    // Chuẩn hóa tên cột
    const originalKeys = Object.keys(records[0]);
    const keyMap = {};
    for (const key of originalKeys) {
        const normalized = key.toLowerCase().replace(/ /g, '_');
        if (normalized === 'link') keyMap[key] = 'url';
        else if (normalized === 'channel') keyMap[key] = 'channel_name';
        else if (normalized === 'published') keyMap[key] = 'date_published';
        else keyMap[key] = normalized;
    }

    records = records.map(row => {
        const newRow = {};
        for (const [oldKey, newKey] of Object.entries(keyMap)) {
            newRow[newKey] = row[oldKey];
        }
        return newRow;
    });

    const dbColumns = ['title', 'url', 'channel_name', 'views', 'date_published', 'thumbnail', 'caption', 'summary', 'video_key'];
    
    // Đảm bảo bảng 'videos' tồn tại
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS videos (
                id SERIAL PRIMARY KEY,
                title TEXT,
                url TEXT UNIQUE,
                channel_name TEXT,
                views INTEGER,
                date_published TIMESTAMP WITH TIME ZONE,
                thumbnail TEXT,
                caption TEXT,
                summary TEXT,
                video_key TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_key TEXT`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_videos_video_key ON videos(video_key)`);
        console.log('✅ Checked/Created "videos" table.');
    } catch (e) {
        console.error(`❌ Error creating table: ${e.message}`);
        process.exit(1);
    }

    // Xử lý dữ liệu
    records = records.map(row => {
        row.views = parseInt(row.views, 10) || 0;
        if (row.date_published) {
            const val = String(row.date_published).trim();
            if (!val || ['','nan','#'].includes(val)) {
                row.date_published = null;
            } else {
                let dateStr = val.split('(')[0].replace('GMT', '').trim();
                const d = new Date(dateStr);
                row.date_published = isNaN(d.getTime()) ? null : d.toISOString();
            }
        }
        const thumb = String(row.thumbnail || '').trim();
        if (!thumb || ['','nan','#'].includes(thumb)) {
            const match = String(row.url || '').match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
            if (match) row.thumbnail = `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
        }
        for (const field of ['title', 'channel_name', 'caption', 'summary']) {
            const v = String(row[field] || '').trim();
            row[field] = (['nan','#'].includes(v)) ? '' : v;
        }
        row.video_key = getVideoKey(row.url);
        return row;
    });

    records = records.filter(r => r.url && String(r.url).startsWith('http'));
    
    console.log(`📊 Found ${records.length} valid records.`);

    let successCount = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        try {
            const values = [];
            const placeholders = [];
            let paramIdx = 1;

            for (const row of batch) {
                placeholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8})`);
                values.push(
                    row.title || '', row.url, row.channel_name || '', 
                    row.views || 0, row.date_published, row.thumbnail || '', 
                    row.caption || '', row.summary || '', row.video_key || null
                );
                paramIdx += 9;
            }

            const sql = `
                INSERT INTO videos (title, url, channel_name, views, date_published, thumbnail, caption, summary, video_key)
                VALUES ${placeholders.join(', ')}
                ON CONFLICT (url) DO UPDATE SET
                    title = EXCLUDED.title,
                    channel_name = EXCLUDED.channel_name,
                    views = EXCLUDED.views,
                    date_published = EXCLUDED.date_published,
                    thumbnail = EXCLUDED.thumbnail,
                    caption = EXCLUDED.caption,
                    summary = EXCLUDED.summary,
                    video_key = EXCLUDED.video_key
            `;
            await pool.query(sql, values);
            successCount += batch.length;
            process.stdout.write(`\r✅ Progress: ${successCount}/${records.length}`);
        } catch (e) {
            console.error(`\n❌ Error batch at index ${i}: ${e.message}`);
        }
    }

    console.log(`\n\n🎉 IMPORT COMPLETED!`);
    console.log(`   ✅ Success: ${successCount}`);
    await pool.end();
}

importData().catch(e => {
    console.error('\nFatal error:', e);
    process.exit(1);
});
