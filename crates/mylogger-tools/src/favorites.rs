use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaFavorite {
    pub name: String,
    pub uri: String,
    pub package: Option<String>,
}

pub fn favorites_path() -> Result<PathBuf> {
    let directory = if let Some(path) = std::env::var_os("XDG_CONFIG_HOME") {
        PathBuf::from(path)
    } else {
        PathBuf::from(std::env::var_os("HOME").context("无法定位用户配置目录")?).join(".config")
    };
    Ok(directory.join("mylogger").join("favorites.json"))
}
pub fn load_favorites(path: &Path) -> Result<Vec<SchemaFavorite>> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .with_context(|| format!("收藏文件无法解析，原文件已保留：{}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.into()),
    }
}
pub fn save_favorite(path: &Path, favorite: SchemaFavorite) -> Result<()> {
    if favorite.name.trim().is_empty()
        || favorite.uri.trim().is_empty()
        || favorite.uri.contains('\0')
    {
        bail!("收藏名称与 schema 不能为空或包含 NUL");
    }
    let mut entries = load_favorites(path)?;
    if let Some(entry) = entries.iter_mut().find(|e| e.name == favorite.name) {
        *entry = favorite;
    } else {
        entries.push(favorite);
    }
    let bytes = serde_json::to_vec_pretty(&entries)?;
    let (partial, mut file) = crate::operations::prepare_file(path, true)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    crate::operations::finish_file(&partial, path, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_favorites_are_preserved() {
        let dir = std::env::temp_dir().join(format!(
            "mylogger-favorite-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("favorites.json");
        std::fs::write(&path, b"broken").unwrap();
        assert!(
            save_favorite(
                &path,
                SchemaFavorite {
                    name: "test".into(),
                    uri: "demo://test".into(),
                    package: None
                }
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"broken");
        std::fs::remove_file(&path).unwrap();
        save_favorite(
            &path,
            SchemaFavorite {
                name: "test".into(),
                uri: "demo://中文".into(),
                package: None,
            },
        )
        .unwrap();
        assert_eq!(load_favorites(&path).unwrap()[0].uri, "demo://中文");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
