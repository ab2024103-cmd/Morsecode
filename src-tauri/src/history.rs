//! Transfer history — local SQLite (rusqlite, bundled so there is no system
//! dependency). Nothing here ever leaves the machine.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::Result;
use rusqlite::{params, Connection};

use crate::model::{HistoryEntry, HistoryStatus};

pub struct HistoryStore {
    conn: Mutex<Connection>,
}

impl HistoryStore {
    pub fn open(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS transfers (
                id           TEXT PRIMARY KEY,
                ts           INTEGER NOT NULL,
                device_id    TEXT NOT NULL,
                device_name  TEXT NOT NULL,
                file_name    TEXT NOT NULL,
                size         INTEGER NOT NULL,
                duration_ms  INTEGER NOT NULL,
                status       TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_transfers_ts ON transfers(ts DESC);",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert(&self, entry: &HistoryEntry) -> Result<()> {
        let conn = self.conn.lock().expect("history mutex poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO transfers
                (id, ts, device_id, device_name, file_name, size, duration_ms, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id,
                entry.ts as i64,
                entry.device_id,
                entry.device_name,
                entry.file_name,
                entry.size as i64,
                entry.duration_ms as i64,
                entry.status.as_str(),
            ],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: usize) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().expect("history mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, ts, device_id, device_name, file_name, size, duration_ms, status
             FROM transfers ORDER BY ts DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                ts: row.get::<_, i64>(1)? as u64,
                device_id: row.get(2)?,
                device_name: row.get(3)?,
                file_name: row.get(4)?,
                size: row.get::<_, i64>(5)? as u64,
                duration_ms: row.get::<_, i64>(6)? as u64,
                status: HistoryStatus::from_str(&row.get::<_, String>(7)?),
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn clear(&self) -> Result<()> {
        let conn = self.conn.lock().expect("history mutex poisoned");
        conn.execute("DELETE FROM transfers", [])?;
        Ok(())
    }

    /// Writes a CSV export next to the user's downloads and returns its path.
    pub fn export_csv(&self, csv: &str, dir: &Path) -> Result<PathBuf> {
        std::fs::create_dir_all(dir)?;
        let stamp = crate::model::now_ms() / 1000;
        let path = dir.join(format!("morsecode-history-{stamp}.csv"));
        std::fs::write(&path, csv)?;
        Ok(path)
    }
}
