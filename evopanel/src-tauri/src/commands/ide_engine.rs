//! GoGo IDE 本地引擎（openvscode-server，:18082）— Tauri 打包后的启动/状态命令。
//! dev 模式走 vite /__api（scripts/dev-api.js），打包后走这里。
//! runtime 打进安装包资源目录（tauri.conf.json resources），data 目录放 ~/.GoGo/ide-data（用户可写）。

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager};

use super::GoGo_dir;

const IDE_PORT: u16 = 18082;

/// runtime 根目录：优先安装包资源目录（release），dev 回退相对路径。
fn runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    // release：资源目录（tauri 会把 resources 复制到 resource_dir 的 ide/vscode-reh-web-win32-x64）
    #[cfg(not(debug_assertions))]
    {
        if let Ok(res) = app.path().resource_dir() {
            let cand = res.join("ide/vscode-reh-web-win32-x64");
            if cand.join("out/server-main.js").exists() {
                return Some(cand);
            }
            let cand = res.join("ide/runtime/openvscode-server");
            if cand.join("out/server-main.js").exists() {
                return Some(cand);
            }
        }
    }
    // dev：cwd 通常是 evopanel/，runtime 在 ../ide/vscode-reh-web-win32-x64
    for cand in [
        PathBuf::from("../ide/vscode-reh-web-win32-x64"),
        PathBuf::from("../../ide/vscode-reh-web-win32-x64"),
        PathBuf::from("../ide/runtime/openvscode-server"),
        PathBuf::from("../../ide/runtime/openvscode-server"),
    ] {
        if cand.join("out/server-main.js").exists() {
            return Some(cand);
        }
    }
    // 资源目录兜底（tauri dev 有时也会复制 resources）
    if let Ok(res) = app.path().resource_dir() {
        let cand = res.join("ide/vscode-reh-web-win32-x64");
        if cand.join("out/server-main.js").exists() {
            return Some(cand);
        }
        let cand = res.join("ide/runtime/openvscode-server");
        if cand.join("out/server-main.js").exists() {
            return Some(cand);
        }
    }
    None
}

/// data 目录：打包后 runtime 在只读安装目录，数据必须放用户可写位置。
/// dev（相对路径 runtime）沿用 runtime/data，保持现状。
fn data_dir(app: &AppHandle, rt: &PathBuf) -> PathBuf {
    if rt.is_absolute()
        && app
            .path()
            .resource_dir()
            .map(|r| rt.starts_with(&r))
            .unwrap_or(false)
    {
        GoGo_dir().join("ide-data")
    } else {
        rt.join("data")
    }
}

/// 引擎是否在监听 18082（openvscode-server 绑定 ::1 IPv6；TCP 连上即视为 up）。
fn engine_up() -> bool {
    for host in ["::1", "127.0.0.1"] {
        let Ok(addr) = format!("{host}:{IDE_PORT}").parse::<std::net::SocketAddr>() else {
            continue;
        };
        if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(600)) {
            let _ = s.set_read_timeout(Some(Duration::from_millis(250)));
            let _ = s.set_write_timeout(Some(Duration::from_millis(250)));
            let _ = s.write_all(b"GET / HTTP/1.0\r\n\r\n");
            let mut buf = [0u8; 1];
            if s.read(&mut buf).is_ok() {
                return true;
            }
        }
    }
    false
}

/// 解析 Node.js 运行时：
/// 1) 安装包内置 node（runtime 目录里，随 resources 分发，零依赖）——Windows 下为 node.exe
/// 2) 系统 node（enhanced_path 扫描常见安装路径）
fn resolve_node(rt: &PathBuf) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let bundled = rt.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let bundled = rt.join("node");
    if bundled.is_file() {
        return Some(bundled);
    }
    if node_available() {
        return Some(PathBuf::from("node"));
    }
    None
}

/// 系统 PATH 里是否找得到 node（enhanced_path 扫描常见安装路径，作为内置 node 的兜底）。
fn node_available() -> bool {
    let path = super::enhanced_path();
    let mut cmd = StdCommand::new("node");
    cmd.arg("--version");
    cmd.env("PATH", &path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
pub async fn ide_engine_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let rt = runtime_dir(&app);
    let node = rt.as_ref().and_then(resolve_node);
    let node_src = match node.as_deref().and_then(|p| p.file_name().and_then(|s| s.to_str())) {
        Some(name) if name == "node.exe" || name == "node" => "bundled",
        Some(_) => "system",
        None => "missing",
    };
    Ok(json!({
        "up": engine_up(),
        "runtime": if rt.is_some() { "present" } else { "missing" },
        "runtimeDir": rt.map(|p| p.to_string_lossy().to_string()),
        "node": node_src,
    }))
}

#[tauri::command]
pub async fn ide_engine_start(app: AppHandle) -> Result<serde_json::Value, String> {
    let rt = runtime_dir(&app)
        .ok_or_else(|| "GoGo IDE runtime 不存在（gogo-app/ide/vscode-reh-web-win32-x64）".to_string())?;
    if engine_up() {
        return Ok(json!({ "ok": true, "status": "already-running" }));
    }
    let data = data_dir(&app, &rt);
    let logs = data.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let extensions = rt.join("extensions");

    let path = super::enhanced_path();
    let node = resolve_node(&rt)
        .ok_or_else(|| "未找到 Node.js 运行时（安装包已内置，请重装或检查 ide/runtime 完整性）".to_string())?;
    let mut cmd = StdCommand::new(&node);
    cmd.args([
        "out/server-main.js",
        "--port",
        "18082",
        "--without-connection-token",
        &format!("--user-data-dir={}", data.display()),
        &format!("--extensions-dir={}", extensions.display()),
    ])
    .current_dir(&rt)
    .env("PATH", &path);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 IDE 引擎失败（请确认已安装 Node.js 并加入 PATH）：{e}"))?;
    let pid = child.id();
    // 不 wait：引擎作为常驻进程脱离 Tauri 生命周期
    std::mem::forget(child);
    Ok(json!({
        "ok": true,
        "status": "starting",
        "pid": pid,
        "runtimeDir": rt.to_string_lossy().to_string(),
        "dataDir": data.to_string_lossy().to_string(),
    }))
}
