# 归序 · Duefold

[Windows 桌面端](https://github.com/BIT-Duefold/Duefold) · [Android 客户端](https://github.com/BIT-Duefold/Duefold-Android) · [项目组织](https://github.com/BIT-Duefold)

归序是一款 Windows 优先的个人学习待办工具：按天收纳截止日，连接教学平台自动读取作业与测试，在自建或云端同步服务上合并多台设备的任务。

## 下载与安装

- 最新安装版见 [GitHub Releases](https://github.com/BIT-Duefold/Duefold/releases)，当前版本 **0.1.92**。
- Windows 新安装的默认文件夹名为 `Duefold`；卸载时默认保留本机数据，可选择删除。
- 从 0.1.91 起，数据统一保存在 `%APPDATA%\duefold`；旧 `拾期` / `deadline-hub` / `归序` 目录需要先迁移到该目录。
- Windows x64 安装包为 `Duefold-<版本>-Setup.exe`：安装时可自选安装目录（默认 `%LOCALAPPDATA%\Programs\归序`），支持中文路径；卸载时保留本机数据。
- 首次启动没有待办；“体验演示数据”需手动点击，并可在“使用帮助”中清除。
- 当前安装包未做代码签名，Windows SmartScreen 可能提示“未知发布者”。
- 数据保存在当前 Windows 用户的应用数据目录，升级时沿用同一目录。

## 功能

- 今日、全部、日历、已完成视图；支持完成、忽略、回收站恢复，以及 JSON / ICS 导入导出。
- “管理平台连接”支持延河课堂、乐学、中国大学 MOOC 和智慧树。延河、乐学与 MOOC 登录后自动读取课程列表及勾选课程的作业、测试；支持“选择课程”和多账号隔离。
- 可选保存北理工统一认证密码，默认关闭；密码只在本机加密保存。
- 桌面待办小组件：置顶、贴边吸附、5 秒收起、条数与日期切换。
- 多端同步：可连接自建 WebSocket 服务或 Supabase Cloud；对话框默认进入“自建服务”。只同步待办，不同步学校登录会话。
- 浅色 / 深色 / 跟随系统，支持减少动态效果与系统对比度。

## 自托管同步

仓库自带轻量 WebSocket 同步服务：

```powershell
npm run sync:server
```

部署、协议和反向代理示例见 [自托管同步](docs/sync-deployment.md)。

## 数据与隐私

- 平台凭据、Cookie 与同步密钥只保存在本机；Windows 使用 DPAPI（Electron `safeStorage`）加密。
- 密码不会进入渲染快照、设置、导入导出备份或同步服务；同步只传待办。
- 短信与图形验证码不会被自动发送、识别或提交，遇到时需在官方窗口完成。
- 导出的备份不包含平台凭据或同步密钥。

## 已知限制

- 当前提供 Windows x64；Linux 待开发，Android 客户端在独立仓库维护。
- 平台页面或接口变化可能导致读取失败；失败时会明确提示，不会伪造任务，请以原平台为准。
- 没有后台系统通知、关机提醒或开机启动。
- 安装包尚未进行代码签名。

## 许可

当前仓库尚未附开源许可证；转载或再分发前请先联系维护者。
