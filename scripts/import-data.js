/**
 * Script import dữ liệu từ data.xlsx vào PostgreSQL local
 * Tương tự sync_to_supabase.py nhưng target là PostgreSQL local
 * 
 * Usage: node import-data.js
 */
import pg from 'pg';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/deep_searching';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.xlsx');
const SHEET_NAME = 'NEW_CACHE_DATA_HIDDEN_';
const BATCH_SIZE = 100;

async function importData() {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    console.log(`📂 Opening file: ${DATA_FILE}`);
    
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

    // Chuẩn hóa tên cột
    if (records.length > 0) {
        const originalKeys = Object.keys(records[0]);
        const keyMap = {};
        
        for (const key of originalKeys) {
            const normalized = key.toLowerCase().replace(/ /g, '_');
            // Map column names
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
    }

    // Chỉ giữ lại các cột có trong DB
    const dbColumns = ['title', 'url', 'channel_name', 'views', 'date_published', 'thumbnail', 'caption', 'summary'];
    records = records.map(row => {
        const filtered = {};
        for (const col of dbColumns) {
            if (row[col] !== undefined) {
                filtered[col] = row[col];
            }
        }
        return filtered;
    });

    // Xử lý dữ liệu
    records = records.map(row => {
        // Views: ép sang integer
        row.views = parseInt(row.views, 10) || 0;

        // Date: xử lý định dạng
        if (row.date_published) {
            const val = String(row.date_published).trim();
            if (!val || val === '' || val === 'nan' || val === '#') {
                row.date_published = null;
            } else {
                let dateStr = val;
                if (dateStr.includes('(')) dateStr = dateStr.split('(')[0].trim();
                if (dateStr.includes('GMT')) dateStr = dateStr.replace('GMT', '').trim();
                try {
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) {
                        row.date_published = null;
                    } else {
                        row.date_published = d.toISOString();
                    }
                } catch {
                    row.date_published = null;
                }
            }
        }

        // Thumbnail: tự tạo nếu trống
        const thumb = String(row.thumbnail || '').trim();
        if (!thumb || thumb === '' || thumb === 'nan' || thumb === '#') {
            const videoUrl = String(row.url || '');
            const match = videoUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
            if (match) {
                row.thumbnail = `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
            }
        }

        // String fields: clean up
        for (const field of ['title', 'channel_name', 'caption', 'summary']) {
            if (row[field] !== undefined) {
                const v = String(row[field] || '').trim();
                row[field] = (v === 'nan' || v === '#') ? '' : v;
            }
        }

        return row;
    });

    // Filter ra records có url
    records = records.filter(r => r.url && String(r.url).trim() && String(r.url).startsWith('http'));
    
    const total = records.length;
    console.log(`📊 Total records to import: ${total}`);

    // Import theo batch
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        try {
            // Dùng UPSERT (ON CONFLICT url DO UPDATE)
            const values = [];
            const placeholders = [];
            let paramIdx = 1;

            for (const row of batch) {
                placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`);
                values.push(
                    row.title || '',
                    row.url,
                    row.channel_name || '',
                    row.views || 0,
                    row.date_published || null,
                    row.thumbnail || '',
                    row.caption || '',
                    row.summary || ''
                );
                paramIdx += 8;
            }

            const sql = `
                INSERT INTO videos (title, url, channel_name, views, date_published, thumbnail, caption, summary)
                VALUES ${placeholders.join(', ')}
                ON CONFLICT (url) DO UPDATE SET
                    title = EXCLUDED.title,
                    channel_name = EXCLUDED.channel_name,
                    views = EXCLUDED.views,
                    date_published = EXCLUDED.date_published,
                    thumbnail = EXCLUDED.thumbnail,
                    caption = EXCLUDED.caption,
                    summary = EXCLUDED.summary
            `;

            await pool.query(sql, values);
            successCount += batch.length;
            console.log(`✅ DONE: ${Math.min(i + BATCH_SIZE, total)} / ${total}`);
        } catch (e) {
            errorCount += batch.length;
            console.error(`❌ ERROR at row ${i + 1}: ${e.message}`);
        }
    }

    console.log(`\n🎉 IMPORT COMPLETED!`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);

    await pool.end();
}

importData().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
