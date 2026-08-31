# Security Policy

## Supported versions

安全修复目前只针对最新 GitHub Release 和 `main` 分支。

## Reporting a vulnerability

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告入口。报告中请包含影响范围、复现条件和建议修复方向，但不要附带真实简历、API Key、扩展 Token 或其他个人数据。

如果仓库暂未启用私密漏洞报告，请仅提交一个不含漏洞细节的 Issue，请求维护者开启私密沟通渠道。

## Data boundary

FindYourJob 的数据库、简历和附件默认保存在本机。JSON 备份不包含 LLM API Key 或浏览器扩展 Token；备份仍可能包含简历、附件、JD 和求职记录，请按敏感文件妥善保管。
