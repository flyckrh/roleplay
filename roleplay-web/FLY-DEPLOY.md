# Fly.io 部署手册（不需要域名、不需要备案）

这条路的核心：**你不用买域名、不用实名、不用备案**，平台直接给你一个 `xxx.fly.dev` 的 HTTPS 地址；一块 1GB 的持久卷挂在 `/data`，容器重建数据不丢；一台机器常驻不休眠。

## 先算清楚代价

| 项目 | 费用 |
|---|---|
| 机器 shared-cpu-1x / 512MB，常驻 | $3.69 / 月 |
| 持久卷 1GB | $0.15 / 月 |
| 出站流量（亚太） | $0.04 / GB，纯文字对话基本可忽略 |
| **合计** | **约 $3.84 / 月，合 ¥28 左右** |

Fly 没有免费额度，新账号只有 $1 的 7 天试用，**必须绑卡**。

两个要提前接受的事实：

1. **数据在境外**（东京机房）。如果你的伦理审查写了数据须存储在境内，这条路不合规，别用。
2. **国内访问 `fly.dev` 能打开，但不保证稳定**。上线前一定要用手机流量实测，不要只在校园网里试。

---

## 步骤

### 0. 安装命令行工具

在 PowerShell 里执行：

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

装完关掉终端重开一个，验证：

```powershell
fly version
```

**不需要在本机装 Docker**——构建在 Fly 的远端机器上完成，Windows 上也能直接用。

### 1. 注册并登录

```powershell
fly auth signup
```

已经注册过就 `fly auth login`。这一步会要求绑卡。

### 2. 建一个全局唯一的应用

`fly.dev` 的子域名就是应用名，全世界不能重名，起一个带随机后缀的：

```powershell
fly apps create nju-roleplay-0721
```

记下这个名字，后面每一条命令都要用。

### 3. 改一行配置

打开项目里的 `fly.toml`，把第一行的 `app` 改成刚才建的名字：

```toml
app = "nju-roleplay-0721"
primary_region = "nrt"
```

`nrt` 是东京。想换机房可以改成 `sin`（新加坡）。注意 **Fly 在 2026 年的机房列表里已经没有香港了**，东亚最近的就是东京。

### 4. 建持久卷

```powershell
fly volumes create roleplay_data -a nju-roleplay-0721 --region nrt --size 1
```

**这一步必须在部署之前做**。卷不存在的话，机器起来会因为挂载失败反复重启。

### 5. 设置三个密钥

```powershell
fly secrets set ADMIN_PASSWORD="至少12位的密码" -a nju-roleplay-0721
fly secrets set PUBLIC_URL="https://nju-roleplay-0721.fly.dev" -a nju-roleplay-0721
```

- `ADMIN_PASSWORD` 少于 12 个字符，容器会直接启动失败
- `PUBLIC_URL` 的协议和域名必须和最终地址完全一致，写错会导致页面能开、但所有提交请求静默返回 403
- 这两条要在部署**之前**设，否则第一次启动会因为没有密码而崩

### 6. 部署

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-11-16-17-39-33\roleplay-web
fly deploy -a nju-roleplay-0721 --ha=false
```

`--ha=false` 不能省。默认会起两台机器做高可用，但一台持久卷只能挂在一台机器上，第二台会挂载失败、不停重启。

首次构建两分钟左右。

### 7. 验证

```powershell
fly logs -a nju-roleplay-0721
```

看到 `Chat: https://nju-roleplay-0721.fly.dev` 就起来了。然后：

- 被试页：`https://nju-roleplay-0721.fly.dev/`
- 后台：`https://nju-roleplay-0721.fly.dev/research`，账号 `admin` + 你设的密码

## 日常操作

**改密码或换地址**

```powershell
fly secrets set ADMIN_PASSWORD="新密码" -a nju-roleplay-0721
```

设完会自动重启一次，数据不受影响。

**看日志 / 进容器**

```powershell
fly logs -a nju-roleplay-0721
fly ssh console -a nju-roleplay-0721
```

**备份数据**

先把整目录打包，再拉回本地：

```powershell
fly ssh console -a nju-roleplay-0721 -C "tar czf /tmp/data.tgz -C /data ."
fly ssh sftp get /tmp/data.tgz .\backup-data.tgz -a nju-roleplay-0721
```

注意：**别用 PowerShell 的 `>` 重定向**去接二进制输出，它会把文件写坏。用上面的 `sftp get`。

备份包里必须包含 `api-encryption.key`，只备份 `chat.sqlite` 的话密钥对不上，API Key 就解不开了。

**确认只有一台机器在跑**

```powershell
fly scale count 1 -a nju-roleplay-0721
```

多于一台就说明 `--ha=false` 没生效，两台各写各的 SQLite，数据会分裂。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 机器反复重启，日志提示 ADMIN_PASSWORD | 密码没设或不足 12 位 | `fly secrets set` 后重新部署 |
| 页面能开，点开始/保存返回 403 | `PUBLIC_URL` 与实际地址不一致 | 改成 `https://应用名.fly.dev`，重新 set |
| 启动报挂载失败 | 卷没建，或卷的 region 与 `primary_region` 不一致 | 按第 4 步重建，region 对齐 |
| 起不来或 502 | 构建失败、端口不对 | `fly logs` 看构建日志；确认 `internal_port` 是 4177 |
| 有两台机器轮流响应、数据错乱 | 高可用没关 | `fly scale count 1` |
| 国内打不开 | 线路问题 | 换 `sin` 机房重试，或用手机流量多试几次 |

## 上线前

- [ ] 手机流量打开一次，确认外网可达、速度能接受
- [ ] `/research` 能登进去，API 配置测试通过
- [ ] 角色卡导入、人物图上传正常
- [ ] 完整跑完八轮对话
- [ ] 备份命令跑通一次，确认能拉到本地
- [ ] 记下 `PUBLIC_URL` 的值，以后换应用名要同步改
