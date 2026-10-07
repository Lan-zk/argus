use keyring::Entry;
use serde::Serialize;
use tauri::Manager;

/// 应用在系统钥匙串中的统一服务名。条目 user = 模型配置 id。
const KEYRING_SERVICE: &str = "com.argus.review";

#[derive(Serialize)]
pub struct KeyringProbe {
    pub service: String,
    pub user: String,
    pub roundtrip: bool,
}

#[tauri::command]
fn keyring_set(user: String, password: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &user).map_err(|e| e.to_string())?;
    entry.set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_get(user: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, &user).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keyring_delete(user: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &user).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 钥匙串可用性自检：写入 → 读回比对 → 删除，供「设置」页诊断展示。
#[tauri::command]
fn keyring_probe(user: String) -> Result<KeyringProbe, String> {
    const SENTINEL: &str = "argus-keyring-probe";
    keyring_set(user.clone(), SENTINEL.to_string())?;
    let read_back = keyring_get(user.clone())?;
    let roundtrip = read_back.as_deref() == Some(SENTINEL);
    let _ = keyring_delete(user.clone());
    Ok(KeyringProbe {
        service: KEYRING_SERVICE.to_string(),
        user,
        roundtrip,
    })
}

/// 开发联调（debug 构建限定）spike 文件路径：文件名仅允许纯名称，防 `../` 路径穿越。
#[cfg(debug_assertions)]
fn spike_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid spike file name".to_string());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

/// 开发联调（debug 构建限定）：读取应用数据目录下的 spike 请求文件。
/// release 构建返回 None，不参与生产逻辑。
#[cfg(debug_assertions)]
#[tauri::command]
fn dev_spike_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = spike_path(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// 开发联调（debug 构建限定）：向应用数据目录写入 spike 结果文件。
#[cfg(debug_assertions)]
#[tauri::command]
fn dev_spike_write(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let path = spike_path(&app, &name)?;
    std::fs::create_dir_all(path.parent().expect("spike path has parent")).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 应用数据目录下的旧版 JSON 存储文件（plugin-store 时代遗留；spec: app-persistence 存储迁移）。
const LEGACY_STORE_FILE: &str = "argus-store.json";

/// 读取旧版 JSON 存储原文（首迁数据源）。文件不存在返回 None；绝不写入。
fn legacy_read_from(dir: &std::path::Path) -> Result<Option<String>, String> {
    let path = dir.join(LEGACY_STORE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// 首迁成功后做副本式备份（copy，不移动原文件）：原文件保留原地，保证「失败可重试」与
/// 「回滚后旧版仍可读」两个承诺（spec: 存储迁移与版本兼容）。返回备份文件名。
fn legacy_backup_in(dir: &std::path::Path) -> Result<Option<String>, String> {
    let src = dir.join(LEGACY_STORE_FILE);
    if !src.exists() {
        return Ok(None);
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = format!("argus-store.backup-{secs}.json");
    std::fs::copy(&src, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(Some(name))
}

#[tauri::command]
fn legacy_store_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    legacy_read_from(&dir)
}

#[tauri::command]
fn legacy_store_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    legacy_backup_in(&dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 应用内自动更新（spec: app-updates）：更新请求/验签在 Rust 侧，不受 WebView CSP 约束
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init()); // 安装完成后 relaunch 用

    #[cfg(debug_assertions)]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            keyring_set,
            keyring_get,
            keyring_delete,
            keyring_probe,
            legacy_store_read,
            legacy_store_backup,
            dev_spike_read,
            dev_spike_write
        ]);
    }
    #[cfg(not(debug_assertions))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            keyring_set,
            keyring_get,
            keyring_delete,
            keyring_probe,
            legacy_store_read,
            legacy_store_backup
        ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spike（tasks 3.1）：真实写入系统钥匙串后读取往返一致。
    /// 在 macOS 上运行 `cargo test` 会写入登录钥匙串，条目在测试结束时删除。
    #[test]
    fn keyring_roundtrip() {
        let user = format!("argus-test-{}", std::process::id());
        keyring_set(user.clone(), "secret-value".to_string()).expect("set_password");
        let read = keyring_get(user.clone()).expect("get_password");
        assert_eq!(read.as_deref(), Some("secret-value"));
        keyring_delete(user.clone()).expect("delete_credential");
        let gone = keyring_get(user).expect("get_password after delete");
        assert!(gone.is_none());
    }

    /// 首迁文件语义（tasks 1.6/1.8）：读不写、备份为 copy 原文件保留原地、无文件时两者皆 None。
    #[test]
    fn legacy_store_read_and_copy_backup() {
        let dir = std::env::temp_dir().join(format!("argus-legacy-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        // 空目录：读取与备份都返回 None
        assert_eq!(legacy_read_from(&dir).unwrap(), None);
        assert_eq!(legacy_backup_in(&dir).unwrap(), None);

        // 放入旧文件 → 读取原文
        std::fs::write(dir.join(LEGACY_STORE_FILE), "{\"settings\":{}}").expect("write legacy");
        assert_eq!(legacy_read_from(&dir).unwrap().as_deref(), Some("{\"settings\":{}}"));

        // 备份 = copy：原文件仍在原地（回滚后旧版可读），备份副本存在
        let name = legacy_backup_in(&dir).unwrap().expect("backup name");
        assert!(name.starts_with("argus-store.backup-"));
        assert!(dir.join(LEGACY_STORE_FILE).exists(), "original must stay in place");
        assert!(dir.join(&name).exists(), "backup copy must exist");
        assert_eq!(
            std::fs::read_to_string(dir.join(&name)).unwrap(),
            "{\"settings\":{}}",
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
