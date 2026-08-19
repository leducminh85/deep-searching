import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

export function getSupabaseAdminClient() {
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

function backupUser(user) {
    return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        aud: user.aud,
        role: user.role,
        app_metadata: user.app_metadata || {},
        user_metadata: user.user_metadata || {},
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_sign_in_at: user.last_sign_in_at,
        confirmed_at: user.confirmed_at,
        email_confirmed_at: user.email_confirmed_at,
        phone_confirmed_at: user.phone_confirmed_at,
        banned_until: user.banned_until,
        invited_at: user.invited_at,
        providers: Array.isArray(user.identities)
            ? user.identities.map((identity) => identity.provider).filter(Boolean)
            : [],
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

export async function exportUserAccounts() {
    const supabase = getSupabaseAdminClient();
    const users = [];
    const perPage = 1000;
    let page = 1;
    let total = null;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) throw new Error(error.message || 'Khong the export danh sach user Supabase Auth.');

        const batch = data?.users || [];
        users.push(...batch.map(backupUser));
        total = Number(data?.total || users.length);

        if (!batch.length || users.length >= total || batch.length < perPage) break;
        page += 1;
    }

    return users;
}

function createRestorePassword() {
    return `${crypto.randomBytes(18).toString('base64url')}Aa1!`;
}

export async function importUserAccounts(users = []) {
    if (!Array.isArray(users) || !users.length) {
        return { imported: 0, created: 0, updated: 0, skipped: 0 };
    }

    const supabase = getSupabaseAdminClient();
    const existing = await exportUserAccounts();
    const existingByEmail = new Map(existing.map((user) => [String(user.email || '').toLowerCase(), user]));
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const user of users) {
        const email = String(user?.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
            skipped += 1;
            continue;
        }

        const attributes = {
            email,
            user_metadata: user.user_metadata || {},
            app_metadata: user.app_metadata || {},
        };

        const existingUser = existingByEmail.get(email);
        if (existingUser?.id) {
            const { error } = await supabase.auth.admin.updateUserById(existingUser.id, attributes);
            if (error) throw new Error(error.message || `Khong the cap nhat user ${email}.`);
            updated += 1;
            continue;
        }

        const { error } = await supabase.auth.admin.createUser({
            ...attributes,
            password: createRestorePassword(),
            email_confirm: Boolean(user.email_confirmed_at || user.confirmed_at),
        });
        if (error) throw new Error(error.message || `Khong the tao user ${email}.`);
        created += 1;
    }

    return {
        imported: created + updated,
        created,
        updated,
        skipped,
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
