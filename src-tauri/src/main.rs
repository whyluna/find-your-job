// 防止 release 构建在 Windows 上弹出控制台（macOS 无影响，保持模板惯例）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    find_your_job_lib::run()
}
