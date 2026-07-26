import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function readEnvFileValue(name) {
    const candidates = [
        path.join(process.cwd(), '.env.local'),
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), '..', '.env.local'),
        path.join(process.cwd(), '..', '.env'),
    ];

    for (const filePath of candidates) {
        try {
            if (!fs.existsSync(filePath)) continue;
            const line = fs.readFileSync(filePath, 'utf8')
                .split(/\r?\n/)
                .find((item) => item.trim().startsWith(`${name}=`));
            if (!line) continue;

            return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
        } catch {
            // Env files are optional; process.env remains the primary source.
        }
    }

    return '';
}

function getEnvValue(...names) {
    for (const name of names) {
        const value = process.env[name] || readEnvFileValue(name);
        if (value) return value;
    }
    return '';
}

function getSupabaseAdminClient() {
    const url = getEnvValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
    const key = getEnvValue(
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_KEY',
        'SUPABASE_ADMIN_KEY'
    );

    if (!url || !key) {
        throw new Error('Thiếu SUPABASE_SERVICE_ROLE_KEY trong biến môi trường server.');
    }

    return createClient(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_sign_in_at: user.last_sign_in_at,
        confirmed_at: user.confirmed_at,
        email_confirmed_at: user.email_confirmed_at,
        banned_until: user.banned_until,
        role: user.app_metadata?.role || user.role || 'authenticated',
        provider: user.app_metadata?.provider || 'email',
    };
}

export async function listUserAccounts({ page = 1, perPage = 1000 } = {}) {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
    });

    if (error) throw new Error(error.message || 'Không thể tải danh sách người dùng.');

    const users = data?.users || [];
    return {
        users: users.map(publicUser),
        total: data?.total || users.length,
    };
}

export async function countUserAccounts() {
    const result = await listUserAccounts({ page: 1, perPage: 1000 });
    return result.total || result.users.length;
}

export async function createUserAccount({ email, password, emailConfirm = true }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Email không hợp lệ.');
    }
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('Mật khẩu cần ít nhất 8 ký tự.');
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: Boolean(emailConfirm),
    });

    if (error) throw new Error(error.message || 'Không thể tạo người dùng.');
    return publicUser(data.user);
}

export async function deleteUserAccount(id) {
    if (!id) throw new Error('Thiếu ID người dùng.');

    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message || 'Không thể xóa người dùng.');
    return { id };
}

export async function resetUserPassword(id, password) {
    if (!id) throw new Error('Thiếu ID người dùng.');
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('Mật khẩu cần ít nhất 8 ký tự.');
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.updateUserById(id, {
        password,
    });

    if (error) throw new Error(error.message || 'Không thể đặt lại mật khẩu.');
    return publicUser(data.user);
}
