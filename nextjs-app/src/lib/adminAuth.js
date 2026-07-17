import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'wevic_admin';
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function getSecret() {
    const secret = process.env.ADMIN_PASSWORD;
    if (!secret) {
        throw new Error('ADMIN_PASSWORD is not configured');
    }
    return secret;
}

function sign(payload) {
    return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAdminToken() {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return false;

    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;

    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return Number(parsed.exp || 0) > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

export async function isAdminRequest() {
    const cookieStore = await cookies();
    return verifyAdminToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireAdmin() {
    if (await isAdminRequest()) return null;
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function setAdminCookie(response) {
    response.cookies.set(COOKIE_NAME, createAdminToken(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: TOKEN_TTL_SECONDS,
    });
    return response;
}

export function clearAdminCookie(response) {
    response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
    });
    return response;
}

export function verifyAdminPassword(password) {
    const expected = getSecret();
    return typeof password === 'string' && password.length > 0 && safeEqual(password, expected);
}
