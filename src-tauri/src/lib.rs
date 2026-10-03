use keyring::Entry;
use serde::Serialize;
#[cfg(debug_assertions)]
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

/// 开发联调（debug 构建限定）：读取应用数据目录下的 spike 请求文件。
/// release 构建返回 None，不参与生产逻辑。
#[cfg(debug_assertions)]
#[tauri::command]
fn dev_spike_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let path = dir.join(name);
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
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(name), content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(debug_assertions)]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            keyring_set,
            keyring_get,
            keyring_delete,
            keyring_probe,
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
            keyring_probe
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
}
