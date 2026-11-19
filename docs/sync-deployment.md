# 自托管同步

要求 Node.js 24.12+。服务状态保存在单个 JSON 文件内；同一文件只启动一个服务进程。服务退出后客户端仍可编辑，重启后自动重连。

Linux 示例：

```sh
npm ci --omit=dev
export SYNC_TOKEN="$(openssl rand -hex 32)"
export SYNC_HOST=127.0.0.1
export SYNC_PORT=8787
export SYNC_DATA=/var/lib/duefold/tasks.json
node server/index.mjs
```

首次生成后，将密钥保存到自己受保护的服务配置，后续重启复用同一密钥。不要每次重启都重新生成。运行用户需要数据目录写权限。任务文件应定期备份。

Caddy 反向代理示例（已准备域名、DNS 与服务器）：

```caddyfile
sync.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

客户端地址填 `wss://sync.example.com`。Caddy 自动处理 HTTPS 与 WebSocket 升级。只需开放代理入口 443，不必将服务 8787 暴露公网。

## 协议 v1

1. 客户端建立 WebSocket，在首条消息发送 `{ "type": "auth", "token": "..." }`。5 秒内未认证即断开。
2. 服务验证后回复 `{ "type": "snapshot", "protocol": 1, "tasks": [...] }`。
3. 客户端先合并服务快照与本地任务，再发送 `{ "type": "merge", "tasks": [...] }`。
4. 服务校验每条任务并原子落盘后，向全部已认证客户端广播完整 snapshot；该消息也作为发送方确认。
5. 后续修改发送 merge。连接中断后指数退避 1–30 秒重连；密钥错误需要修改设置。心跳检测连接存活。

数据规则见 `shared/model.mjs`。删除也是有版本的完整任务记录，`deleted=true`。同版本记录通过稳定比较打破冲突；普通写入使用递增 Lamport 时钟，同计数时设备 ID 字典序决定胜者。服务器不是多用户账号系统；不同用户应运行不同实例与密钥。

限制：最大 100 个连接，最大消息 8 MiB，最多 10000 条记录。完整快照方案适合个人学习待办，不用于大规模团队协作。服务为单实例设计，不能直接多副本共享同一 JSON 数据文件。
