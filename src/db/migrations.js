import { migrationRunner } from '@forge/sql';

const CREATE_REQUIREMENTS = `CREATE TABLE IF NOT EXISTS tg_requirements (
  project_key VARCHAR(32) NOT NULL,
  req_key VARCHAR(64) NOT NULL,
  summary VARCHAR(512) NOT NULL,
  status VARCHAR(64),
  owner_account_id VARCHAR(128),
  owner_name VARCHAR(255),
  owner_team VARCHAR(255),
  rag VARCHAR(8) NOT NULL,
  gaps_json TEXT NOT NULL,
  chain_json MEDIUMTEXT NOT NULL,
  explanation TEXT,
  explanation_hash VARCHAR(64),
  scanned_at DATETIME NOT NULL,
  PRIMARY KEY (project_key, req_key)
)`;

const CREATE_SCAN_RUNS = `CREATE TABLE IF NOT EXISTS tg_scan_runs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_key VARCHAR(32) NOT NULL,
  source VARCHAR(16) NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  total INT,
  green INT,
  amber INT,
  red INT
)`;

const CREATE_GAP_EVENTS = `CREATE TABLE IF NOT EXISTS tg_gap_events (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_key VARCHAR(32) NOT NULL,
  req_key VARCHAR(64) NOT NULL,
  gap_code VARCHAR(32) NOT NULL,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME,
  INDEX idx_gap_req (project_key, req_key)
)`;

// Declared once at module level, as Forge recommends.
const runner = migrationRunner
  .enqueue('v001_tg_requirements', CREATE_REQUIREMENTS)
  .enqueue('v002_tg_scan_runs', CREATE_SCAN_RUNS)
  .enqueue('v003_tg_gap_events', CREATE_GAP_EVENTS);

let ready = false;

// Logging must never stop a scan, so a failure here is only reported.
async function logAppliedMigrations() {
  try {
    const migrations = await runner.list();
    console.log(
      '[TG] migrations in database:',
      migrations.map(({ name, migratedAt }) => `${name} (${String(migratedAt)})`),
    );
  } catch (error) {
    console.error(`[TG] Could not list migrations: ${error.message}`);
  }
}

export async function ensureMigrations() {
  if (ready) return;

  try {
    const applied = await runner.run();
    console.log('[TG] migrations applied:', applied);
  } catch (error) {
    console.error(`[TG] Migrations failed: ${error.message}`);
    throw new Error('Could not prepare the TraceGuard database.');
  }

  await logAppliedMigrations();
  ready = true;
}

export const runMigrations = async () => {
  await ensureMigrations();
};
