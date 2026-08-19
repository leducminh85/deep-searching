import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';

const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

function normalizeBoolean(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

function trimSlashes(value) {
    return String(value || '').replace(/^\/+|\/+$/g, '');
}

function getR2Config() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const endpoint = process.env.R2_ENDPOINT || (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : '');

    return {
        enabled: normalizeBoolean(process.env.R2_BACKUP_ENABLED),
        endpoint,
        bucket: process.env.R2_BUCKET_NAME,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        prefix: process.env.R2_BACKUP_PREFIX || 'backups',
    };
}

function validateR2Config(config) {
    const missing = [];
    if (!config.endpoint) missing.push('R2_ENDPOINT');
    if (!config.bucket) missing.push('R2_BUCKET_NAME');
    if (!config.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
    if (!config.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');

    if (missing.length) {
        throw new Error(`Missing Cloudflare R2 backup config: ${missing.join(', ')}`);
    }
}

export function isR2BackupEnabled() {
    return getR2Config().enabled;
}

export function assertR2BackupReady() {
    const config = getR2Config();
    if (!config.enabled) return false;
    validateR2Config(config);
    return true;
}

export function buildR2BackupKey(filename) {
    const prefix = trimSlashes(process.env.R2_BACKUP_PREFIX || 'backups');
    const objectName = process.env.R2_BACKUP_OBJECT_NAME || filename;
    return prefix ? `${prefix}/${objectName}` : objectName;
}

export async function uploadBackupStreamToR2(stream, filename) {
    const config = getR2Config();
    if (!config.enabled) {
        return { skipped: true, reason: 'R2 backup disabled' };
    }

    validateR2Config(config);

    const client = new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
    const key = buildR2BackupKey(filename);
    const body = Readable.fromWeb(stream);

    const upload = new Upload({
        client,
        params: {
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: NDJSON_CONTENT_TYPE,
            CacheControl: 'no-store',
            Metadata: {
                source: 'deep-video-search-admin',
                format: 'ndjson',
            },
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
    });

    const result = await upload.done();
    return {
        uploaded: true,
        bucket: config.bucket,
        key,
        etag: result.ETag || null,
    };
}
