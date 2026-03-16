import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Leducminh123';

export async function POST(request) {
    try {
        const formData = await request.formData();
        const password = formData.get('password');
        const file = formData.get('file');

        if (password !== ADMIN_PASSWORD) {
            return NextResponse.json({ detail: 'Invalid password' }, { status: 401 });
        }

        if (!file) {
            return NextResponse.json({ detail: 'No file uploaded' }, { status: 400 });
        }

        if (!file.name.endsWith('.xlsx')) {
            return NextResponse.json({ detail: 'Only .xlsx files are allowed' }, { status: 400 });
        }

        const dataDir = path.join(process.cwd(), 'data');
        await mkdir(dataDir, { recursive: true });

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filePath = path.join(dataDir, 'data.xlsx');
        await writeFile(filePath, buffer);

        return NextResponse.json({ message: 'File uploaded successfully' });
    } catch (e) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}
