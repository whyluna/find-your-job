// 临时探针：直连真实数据库复现线上查询（跑完即删）
use fyj_core::services::*;

#[tokio::test]
async fn probe_real_db() {
    let path = std::env::var("FYJ_DB").unwrap_or_else(|_| {
        format!("{}/Library/Application Support/com.findyourjob/findyourjob.db", std::env::var("HOME").unwrap())
    });
    let pool = fyj_core::db::init_pool(std::path::Path::new(&path)).await.unwrap();
    let s = Services::new(pool);
    match s.list_applications(&Default::default()).await {
        Ok(list) => println!("list OK, count = {}", list.len()),
        Err(e) => println!("list ERROR = {e}"),
    }
    match s.get_stats().await {
        Ok(_) => println!("stats OK"),
        Err(e) => println!("stats ERROR = {e}"),
    }
    match s.get_upcoming(3, 7).await {
        Ok(u) => println!("upcoming OK = {}", u.len()),
        Err(e) => println!("upcoming ERROR = {e}"),
    }
}
