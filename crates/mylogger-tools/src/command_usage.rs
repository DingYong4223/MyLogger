use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::Path};

#[derive(Default, Serialize, Deserialize)]
pub struct CommandUsage(BTreeMap<String, Usage>);

#[derive(Default, Serialize, Deserialize)]
struct Usage {
    count: u64,
    last_used: u64,
}

impl CommandUsage {
    pub fn record(&mut self, command: &str) {
        let next = self
            .0
            .values()
            .map(|u| u.last_used)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        let usage = self.0.entry(command.to_owned()).or_default();
        usage.count = usage.count.saturating_add(1);
        usage.last_used = next;
    }

    pub fn rank(&self, command: &str) -> (u64, u64) {
        self.0
            .get(command)
            .map_or((0, 0), |u| (u.count, u.last_used))
    }

    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .with_context(|| format!("命令排序记录无法解析，原文件已保留：{}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        Self::load(path)?;
        let bytes = serde_json::to_vec_pretty(self)?;
        let (partial, mut file) = crate::operations::prepare_file(path, true)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        crate::operations::finish_file(&partial, path, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_survives_reload_and_corrupt_files_are_preserved() {
        let dir = std::env::temp_dir().join(format!(
            "mylogger-command-usage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join("command-usage.json");
        let mut usage = CommandUsage::load(&path).unwrap();
        usage.record("/schema");
        usage.record("/log");
        usage.record("/schema");
        usage.save(&path).unwrap();
        let mut restored = CommandUsage::load(&path).unwrap();
        assert_eq!(restored.rank("/schema"), (2, 3));
        assert_eq!(restored.rank("/log"), (1, 2));
        restored.record("/log");
        assert!(restored.rank("/log") > restored.rank("/schema"));
        restored.save(&path).unwrap();
        assert_eq!(CommandUsage::load(&path).unwrap().rank("/log"), (2, 4));
        std::fs::write(&path, b"broken").unwrap();
        assert!(CommandUsage::load(&path).is_err());
        assert!(restored.save(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
