import { getAppContext } from '@forge/api';
import { kvs } from '@forge/kvs';
import { migrationRunner } from '@forge/sql';
import { errorLabel } from '../engine/errors';

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

// New gaps wait here until the nightly job comments on them.
const CREATE_PENDING_GAP_COMMENTS = `CREATE TABLE IF NOT EXISTS tg_pending_gap_comments (
  event_id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_key VARCHAR(32) NOT NULL,
  req_key VARCHAR(64) NOT NULL,
  gap_code VARCHAR(32) NOT NULL,
  queued_at DATETIME NOT NULL,
  INDEX idx_pending_project (project_key)
)`;

// One row per comment allowed each UTC day, so the daily limit stays exact.
const CREATE_COMMENT_SLOTS = `CREATE TABLE IF NOT EXISTS tg_comment_slots (
  comment_day VARCHAR(10) NOT NULL,
  slot INT NOT NULL,
  PRIMARY KEY (comment_day, slot)
)`;

// Every page load reads the latest finished scans of one project.
const CREATE_SCAN_HISTORY_INDEX = `CREATE INDEX IF NOT EXISTS idx_scan_runs_history
  ON tg_scan_runs (project_key, finished_at, started_at)`;

const SCHEMA_VERSION = 'v006_tg_scan_runs_history_index';
const SCHEMA_VERSION_KEY = 'schema-version';

// Declared once at module level, as Forge recommends.
const runner = migrationRunner
  .enqueue('v001_tg_requirements', CREATE_REQUIREMENTS)
  .enqueue('v002_tg_scan_runs', CREATE_SCAN_RUNS)
  .enqueue('v003_tg_gap_events', CREATE_GAP_EVENTS)
  .enqueue('v004_tg_pending_gap_comments', CREATE_PENDING_GAP_COMMENTS)
  .enqueue('v005_tg_comment_slots', CREATE_COMMENT_SLOTS)
  .enqueue(SCHEMA_VERSION, CREATE_SCAN_HISTORY_INDEX);

// Forge can reuse one process for several customers, so readiness is kept per install.
const readyInstallations = new Set();

function currentInstallationId() {
  try {
    return getAppContext().installationAri.installationId;
  } catch {
    return null;
  }
}

function markReady() {
  const installationId = currentInstallationId();
  if (installationId) readyInstallations.add(installationId);
}

async function schemaIsCurrent() {
  try {
    return (await kvs.get(SCHEMA_VERSION_KEY)) === SCHEMA_VERSION;
  } catch (error) {
    console.error(`[TG] Could not read the schema version: ${errorLabel(error)}`);
    return false;
  }
}

async function rememberSchemaVersion() {
  try {
    await kvs.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  } catch (error) {
    console.error(`[TG] Could not save the schema version: ${errorLabel(error)}`);
  }
}

async function applyMigrations() {
  try {
    const applied = await runner.run();
    if (applied.length > 0) console.log('[TG] migrations applied:', applied);
  } catch (error) {
    console.error(`[TG] Migrations failed: ${errorLabel(error)}`);
    throw new Error('Could not prepare the TraceGuard database.');
  }
  await rememberSchemaVersion();
}

export async function ensureMigrations() {
  if (readyInstallations.has(currentInstallationId())) return;

  if (!(await schemaIsCurrent())) await applyMigrations();
  markReady();
}

// The hourly job always runs, so it can repair a missing or failed migration.
export const runMigrations = async () => {
  await applyMigrations();
  markReady();
};
