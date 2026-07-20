/**
 * Clone the current PostgreSQL database into a new database for isolated analysis.
 *
 * Usage:
 *   node scripts/clone-database.js --target deep_searching_v3
 *   node scripts/clone-database.js --target deep_searching_v3 --replace
 *
 * Switch the app later by setting:
 *   POSTGRES_APP_DB=deep_searching_v3
 */
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFiles([
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '.env.local'),
]);

function loadEnvFiles(files) {
    for (const file of files) {
        if (fs.existsSync(file)) process.loadEnvFile(file);
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
        source: process.env.POSTGRES_SOURCE_DB || process.env.POSTGRES_APP_DB || process.env.POSTGRES_DB || 'deep_searching',
        target: process.env.POSTGRES_TARGET_DB || 'deep_searching_v3',
        replace: false,
        forceSourceDisconnect: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--source') parsed.source = args[++index];
        else if (arg === '--target') parsed.target = args[++index];
        else if (arg === '--replace') parsed.replace = true;
        else if (arg === '--force-source-disconnect') parsed.forceSourceDisconnect = true;
        else if (arg === '--help') {
            console.log('Usage: node scripts/clone-database.js [--source deep_searching] [--target deep_searching_v3] [--replace] [--force-source-disconnect]');
            process.exit(0);
        }
    }

    return parsed;
}

function getAdminDatabaseUrl() {
    if (process.env.POSTGRES_ADMIN_DATABASE_URL) return process.env.POSTGRES_ADMIN_DATABASE_URL;

    const password = process.env.POSTGRES_PASSWORD;
    if (!password) {
        throw new Error('Missing POSTGRES_PASSWORD in .env');
    }

    const user = process.env.POSTGRES_USER || 'postgres';
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/postgres`;
}

function quoteIdent(value) {
    const name = String(value || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`Invalid database name: ${value}`);
    }
    return `"${name.replace(/"/g, '""')}"`;
}

function buildDatabaseUrl(dbName) {
    const user = process.env.POSTGRES_USER || 'postgres';
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    return `postgresql://${user}:<POSTGRES_PASSWORD>@${host}:${port}/${dbName}`;
}

async function databaseExists(pool, name) {
    const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return result.rowCount > 0;
}

async function terminateConnections(pool, dbName) {
    await pool.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
    `, [dbName]);
}

async function cloneDatabase() {
    const { source, target, replace, forceSourceDisconnect } = parseArgs();
    if (source === target) throw new Error('Source and target database names must be different.');

    const pool = new Pool({ connectionString: getAdminDatabaseUrl() });

    try {
        const sourceExists = await databaseExists(pool, source);
        if (!sourceExists) throw new Error(`Source database "${source}" does not exist.`);

        const targetExists = await databaseExists(pool, target);
        if (targetExists && !replace) {
            throw new Error(`Target database "${target}" already exists. Use --replace to recreate it.`);
        }

        if (targetExists && replace) {
            console.log(`Dropping existing target database "${target}"...`);
            await terminateConnections(pool, target);
            await pool.query(`DROP DATABASE ${quoteIdent(target)}`);
        }

        if (forceSourceDisconnect) {
            console.log(`Terminating active connections to source database "${source}"...`);
            await terminateConnections(pool, source);
        }

        console.log(`Cloning "${source}" -> "${target}"...`);
        await pool.query(`CREATE DATABASE ${quoteIdent(target)} WITH TEMPLATE ${quoteIdent(source)}`);

        console.log('Clone completed.');
        console.log(`Use this for v3 analysis: ANALYSIS_DATABASE_URL=${buildDatabaseUrl(target)}`);
        console.log(`Switch app to v3 DB: POSTGRES_APP_DB=${target}`);
        console.log(`Switch app back: POSTGRES_APP_DB=${source}`);
    } finally {
        await pool.end();
    }
}

cloneDatabase().catch((err) => {
    console.error(`Clone failed: ${err.message}`);
    if (/being accessed by other users/i.test(err.message)) {
        console.error('Tip: stop app connections or rerun with --force-source-disconnect during a maintenance window.');
    }
    process.exit(1);
});
