use crate::scan::{NodeView, Scan};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Safe,
    Caution,
    Dangerous,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleReason {
    pub rule_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub field: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleAssessment {
    pub scan_id: u64,
    pub node_id: u32,
    pub revision: u64,
    pub rule_version: String,
    pub verdict: Verdict,
    pub reasons: Vec<RuleReason>,
    pub evidence: Vec<Evidence>,
    pub missing: Vec<String>,
}

struct RuleSpec {
    id: &'static str,
    verdict: Verdict,
    reason: &'static str,
    matcher: fn(&str) -> bool,
}

fn contains(value: &str, needle: &str) -> bool {
    value.to_ascii_lowercase().contains(needle)
}

fn is_windows(path: &str) -> bool {
    contains(path, "\\windows\\") || path.ends_with("\\windows")
}
fn is_program_files_match(path: &str) -> bool {
    contains(path, "\\program files\\") || contains(path, "\\program files (x86)\\")
}
fn is_program_data(path: &str) -> bool {
    contains(path, "\\programdata\\")
}
fn is_recycle(path: &str) -> bool {
    contains(path, "\\$recycle.bin\\") || path.ends_with("\\$recycle.bin")
}
fn is_system_volume(path: &str) -> bool {
    contains(path, "\\system volume information\\") || path.ends_with("\\system volume information")
}
fn is_pagefile(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with("\\pagefile.sys")
}
fn is_hiberfile(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with("\\hiberfil.sys")
}
fn is_boot(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with("\\bootmgr") || contains(path, "\\boot\\")
}
fn is_temp(path: &str) -> bool {
    contains(path, "\\appdata\\local\\temp\\") || contains(path, "\\windows\\temp\\")
}
fn is_cache(path: &str) -> bool {
    contains(path, "\\cache\\") || contains(path, "\\caches\\")
}
fn is_browser_cache(path: &str) -> bool {
    contains(path, "\\chrome\\user data\\") && contains(path, "\\cache")
        || contains(path, "\\edge\\user data\\") && contains(path, "\\cache")
}
fn is_node_modules(path: &str) -> bool {
    contains(path, "\\node_modules\\") || path.to_ascii_lowercase().ends_with("\\node_modules")
}
fn is_pycache(path: &str) -> bool {
    contains(path, "\\__pycache__\\") || path.to_ascii_lowercase().ends_with("\\__pycache__")
}
fn is_git(path: &str) -> bool {
    contains(path, "\\.git\\") || path.to_ascii_lowercase().ends_with("\\.git")
}
fn is_target(path: &str) -> bool {
    contains(path, "\\target\\") || path.to_ascii_lowercase().ends_with("\\target")
}
fn is_dist(path: &str) -> bool {
    contains(path, "\\dist\\") || contains(path, "\\build\\")
}
fn is_venv(path: &str) -> bool {
    contains(path, "\\.venv\\") || contains(path, "\\venv\\")
}
fn is_tmp(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".tmp") || path.to_ascii_lowercase().ends_with(".temp")
}
fn is_log(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".log")
}
fn is_dump(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".dmp") || path.to_ascii_lowercase().ends_with(".mdmp")
}
fn is_archive(path: &str) -> bool {
    [".zip", ".7z", ".rar", ".tar", ".gz"]
        .iter()
        .any(|x| path.to_ascii_lowercase().ends_with(x))
}
fn is_iso(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".iso")
}
fn is_vm(path: &str) -> bool {
    [".vhd", ".vhdx", ".qcow2"]
        .iter()
        .any(|x| path.to_ascii_lowercase().ends_with(x))
}
fn is_installer(path: &str) -> bool {
    [".msi", ".exe", ".msix"]
        .iter()
        .any(|x| path.to_ascii_lowercase().ends_with(x))
}
fn is_backup(path: &str) -> bool {
    contains(path, "\\backup\\") || path.to_ascii_lowercase().ends_with(".bak")
}
fn is_document(path: &str) -> bool {
    contains(path, "\\documents\\") || contains(path, "\\desktop\\")
}
fn is_download(path: &str) -> bool {
    contains(path, "\\downloads\\")
}
fn is_appdata(path: &str) -> bool {
    contains(path, "\\appdata\\roaming\\") || contains(path, "\\appdata\\local\\")
}
fn is_font(path: &str) -> bool {
    contains(path, "\\fonts\\") && path.to_ascii_lowercase().ends_with(".ttf")
}
fn is_driver(path: &str) -> bool {
    contains(path, "\\drivers\\") && path.to_ascii_lowercase().ends_with(".sys")
}

const RULES: &[RuleSpec] = &[
    RuleSpec {
        id: "protected.windows",
        verdict: Verdict::Dangerous,
        reason: "Windows 系统目录受保护",
        matcher: is_windows,
    },
    RuleSpec {
        id: "protected.program-files",
        verdict: Verdict::Dangerous,
        reason: "Program Files 受保护",
        matcher: is_program_files_match,
    },
    RuleSpec {
        id: "protected.program-data",
        verdict: Verdict::Dangerous,
        reason: "ProgramData 受保护",
        matcher: is_program_data,
    },
    RuleSpec {
        id: "protected.recycle-bin",
        verdict: Verdict::Dangerous,
        reason: "回收站目录不能作为清理目标",
        matcher: is_recycle,
    },
    RuleSpec {
        id: "protected.system-volume",
        verdict: Verdict::Dangerous,
        reason: "System Volume Information 受保护",
        matcher: is_system_volume,
    },
    RuleSpec {
        id: "protected.pagefile",
        verdict: Verdict::Dangerous,
        reason: "pagefile.sys 是系统分页文件",
        matcher: is_pagefile,
    },
    RuleSpec {
        id: "protected.hiberfile",
        verdict: Verdict::Dangerous,
        reason: "hiberfil.sys 是系统休眠文件",
        matcher: is_hiberfile,
    },
    RuleSpec {
        id: "protected.boot",
        verdict: Verdict::Dangerous,
        reason: "引导相关内容受保护",
        matcher: is_boot,
    },
    RuleSpec {
        id: "protected.driver",
        verdict: Verdict::Dangerous,
        reason: "系统驱动文件不能作为普通清理目标",
        matcher: is_driver,
    },
    RuleSpec {
        id: "cleanup.temp",
        verdict: Verdict::Caution,
        reason: "临时目录通常可清理，但仍需确认来源和占用状态",
        matcher: is_temp,
    },
    RuleSpec {
        id: "cleanup.cache",
        verdict: Verdict::Caution,
        reason: "缓存目录可能可重建，但不能仅凭名称确认",
        matcher: is_cache,
    },
    RuleSpec {
        id: "cleanup.browser-cache",
        verdict: Verdict::Caution,
        reason: "浏览器缓存可能可重建",
        matcher: is_browser_cache,
    },
    RuleSpec {
        id: "cleanup.node-modules",
        verdict: Verdict::Caution,
        reason: "node_modules 可由项目重新安装，需确认项目状态",
        matcher: is_node_modules,
    },
    RuleSpec {
        id: "cleanup.pycache",
        verdict: Verdict::Caution,
        reason: "Python 字节码缓存可重建",
        matcher: is_pycache,
    },
    RuleSpec {
        id: "development.git",
        verdict: Verdict::Caution,
        reason: ".git 包含版本历史，不能按普通缓存处理",
        matcher: is_git,
    },
    RuleSpec {
        id: "development.target",
        verdict: Verdict::Caution,
        reason: "构建目录可能可重建，但需确认项目状态",
        matcher: is_target,
    },
    RuleSpec {
        id: "development.dist",
        verdict: Verdict::Caution,
        reason: "发布或构建产物可能可重建",
        matcher: is_dist,
    },
    RuleSpec {
        id: "development.venv",
        verdict: Verdict::Caution,
        reason: "虚拟环境可重建，但可能包含未保存依赖",
        matcher: is_venv,
    },
    RuleSpec {
        id: "temporary.extension",
        verdict: Verdict::Caution,
        reason: "临时扩展名只能提供清理线索",
        matcher: is_tmp,
    },
    RuleSpec {
        id: "diagnostic.log",
        verdict: Verdict::Caution,
        reason: "日志可能可清理，但可能仍用于故障排查",
        matcher: is_log,
    },
    RuleSpec {
        id: "diagnostic.dump",
        verdict: Verdict::Caution,
        reason: "转储文件可能包含诊断信息",
        matcher: is_dump,
    },
    RuleSpec {
        id: "archive.zip",
        verdict: Verdict::Caution,
        reason: "压缩包可能是用户保留的归档",
        matcher: is_archive,
    },
    RuleSpec {
        id: "archive.iso",
        verdict: Verdict::Caution,
        reason: "ISO 镜像通常体积较大且可能仍有用途",
        matcher: is_iso,
    },
    RuleSpec {
        id: "virtual-disk",
        verdict: Verdict::Dangerous,
        reason: "虚拟磁盘可能包含完整用户数据",
        matcher: is_vm,
    },
    RuleSpec {
        id: "installer",
        verdict: Verdict::Caution,
        reason: "安装程序可能仍被用户需要",
        matcher: is_installer,
    },
    RuleSpec {
        id: "backup",
        verdict: Verdict::Caution,
        reason: "备份内容不能仅凭路径判定可删",
        matcher: is_backup,
    },
    RuleSpec {
        id: "user.documents",
        verdict: Verdict::Caution,
        reason: "用户文档属于高风险数据",
        matcher: is_document,
    },
    RuleSpec {
        id: "user.downloads",
        verdict: Verdict::Caution,
        reason: "下载目录可能包含用户尚未归档的文件",
        matcher: is_download,
    },
    RuleSpec {
        id: "user.appdata",
        verdict: Verdict::Caution,
        reason: "应用数据可能包含设置和登录状态",
        matcher: is_appdata,
    },
    RuleSpec {
        id: "system.font",
        verdict: Verdict::Dangerous,
        reason: "系统字体文件受系统组件使用",
        matcher: is_font,
    },
];

pub fn evaluate_node(scan_id: u64, scan: &Scan, node_id: u32) -> Result<RuleAssessment, String> {
    let node = scan.node(node_id)?;
    let revision = scan.progress().revision;
    let path = node.path.to_ascii_lowercase();
    let mut reasons = Vec::new();
    let mut evidence = vec![
        Evidence {
            field: "path".into(),
            value: node.path.clone(),
        },
        Evidence {
            field: "logicalSize".into(),
            value: node.logical_size.to_string(),
        },
        Evidence {
            field: "diskSize".into(),
            value: node.disk_size.to_string(),
        },
        Evidence {
            field: "state".into(),
            value: node.state.clone(),
        },
    ];
    for rule in RULES.iter().filter(|rule| (rule.matcher)(&path)) {
        reasons.push(RuleReason {
            rule_id: rule.id.into(),
            text: rule.reason.into(),
        });
    }
    if node.unknown > 0 || node.errors > 0 || node.skipped > 0 || !node.complete {
        evidence.push(Evidence {
            field: "unknownItems".into(),
            value: node.unknown.to_string(),
        });
        reasons.push(RuleReason {
            rule_id: "scan.incomplete".into(),
            text: "扫描结果不完整，不能给出安全结论".into(),
        });
    }
    if let Some(modified) = node.modified {
        evidence.push(Evidence {
            field: "modified".into(),
            value: modified.to_string(),
        });
    } else {
        evidence.push(Evidence {
            field: "modified".into(),
            value: "unknown".into(),
        });
    }
    let verdict = if RULES
        .iter()
        .any(|rule| (rule.matcher)(&path) && rule.verdict == Verdict::Dangerous)
        || (reasons
            .iter()
            .any(|reason| reason.rule_id == "scan.incomplete")
            && node.state == "skipped")
    {
        Verdict::Dangerous
    } else {
        if reasons.is_empty() {
            reasons.push(RuleReason {
                rule_id: "default.insufficient-evidence".into(),
                text: "没有足够证据判断可以清理".into(),
            });
        }
        Verdict::Caution
    };
    Ok(RuleAssessment {
        scan_id,
        node_id,
        revision,
        rule_version: "p1-2026-11-18".into(),
        verdict,
        reasons,
        evidence,
        missing: missing_evidence(&node),
    })
}

fn missing_evidence(node: &NodeView) -> Vec<String> {
    // shortcut: no occupancy or ownership proof, add when P1 evidence collection is expanded.
    let mut missing = vec!["occupancy".into(), "ownership".into()];
    if node.unknown > 0 {
        missing.push("reliable_size".into());
    }
    if node.modified.is_none() {
        missing.push("modified_time".into());
    }
    if node.state == "partial" || node.state == "skipped" {
        missing.push("complete_scan".into());
    }
    missing
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_and_unknown_nodes_never_look_safe() {
        assert!(
            RULES
                .iter()
                .filter(|r| matches!(r.verdict, Verdict::Dangerous))
                .count()
                >= 10
        );
        assert!(is_hiberfile(r"c:\hiberfil.sys"));
        assert!(is_node_modules(r"d:\work\node_modules"));
    }

    #[test]
    fn old_temp_file_is_not_safe_without_occupancy_or_ownership_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join("AppData").join("Local").join("Temp");
        std::fs::create_dir_all(&temp).unwrap();
        let file = std::fs::File::create(temp.join("fixture.tmp")).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(
            std::time::SystemTime::now() - std::time::Duration::from_secs(30 * 86400),
        ))
        .unwrap();
        drop(file);
        let scan = Scan::new(&temp).unwrap();
        let (done, result) = std::sync::mpsc::channel();
        scan.spawn(move |progress| {
            if progress.terminal() {
                let _ = done.send(());
            }
        })
        .unwrap();
        result
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        assert_eq!(scan.progress().phase, "completed");
        let assessment = evaluate_node(1, &scan, 1).unwrap();
        assert_eq!(assessment.verdict, Verdict::Caution);
        assert!(assessment.missing.iter().any(|field| field == "occupancy"));
    }
}
