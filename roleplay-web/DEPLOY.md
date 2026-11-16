# 阿里云轻量（香港）部署手册

这套包在原始源码上加了三个文件：`docker-compose.yml`、`Caddyfile`、`backup.sh`，以及一份 `.env.deploy.example`。目标是一台服务器 + 两条命令把站点跑起来，HTTPS 证书自动申请自动续期。

架构：Caddy 占 80/443 做反向代理并自动签证书 → 转发给 app 容器的 4177 → 数据写在 `roleplay-data` 卷里（`chat.sqlite` + `api-encryption.key`）。

---

## 0. 买之前先确认一件事

香港节点在法律上属于**境外**。如果你的实验过了伦理审查，且审查意见要求数据存储在境内，那么香港不合规，得换大陆节点并做 ICP 备案。这一条先跟导师确认清楚，再付钱。

---

## 1. 买服务器

阿里云 → 轻量应用服务器 → 地域选 **中国香港**。

- 规格：**2 核 2G** 起。1 核 1G 也能跑，但 `docker build` 容易内存不足
- 镜像：**Ubuntu 24.04**
- 系统盘 40G 足够
- 参考价：活动价常在 24–40 元/月，年付更便宜
- 香港节点**不需要 ICP 备案**，这是选它的理由

## 2. 域名解析

在阿里云注册一个便宜后缀（`.top` / `.xyz`，首年常个位数到二三十元），然后：

云解析 DNS → 添加记录 → 类型 `A`，主机记录填 `chat`（或 `@`），记录值填轻量服务器的**公网 IP**。

几分钟生效。验证：

```bash
dig +short chat.你的域名.com
# 应该输出你服务器的公网 IP
```

## 3. 放行端口

轻量应用服务器控制台 → 你的实例 → **防火墙** → 添加规则：

| 端口 | 协议 | 用途 |
|---|---|---|
| 22 | TCP | SSH（通常默认已开） |
| 80 | TCP | Let's Encrypt 证书校验，**必须开** |
| 443 | TCP | HTTPS |
| 443 | UDP | HTTP/3，可不开 |

80 端口不放行，证书一定申请失败——这是最常见的卡点。

## 4. 装 Docker

SSH 登录后执行：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
docker compose version
```

如果拉镜像很慢，加个镜像加速：

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.mirrors.ustc.edu.cn"]
}
EOF
sudo systemctl restart docker
```

## 5. 上传代码

**方式一：scp**（在你自己电脑的 PowerShell 里跑）

```powershell
scp -r "本地路径\roleplay-web" root@你的服务器IP:/opt/
```

**方式二：GitHub（推荐，方便以后更新）**

先把项目推到 GitHub 私有仓库，然后在服务器上：

```bash
cd /opt
git clone https://github.com/你的用户名/roleplay-web.git
```

`.gitignore` 里应该已经排除了 `.env` 和 `.local`，别把密码和密钥传上去。确认一下：`git status` 里不该出现 `.env`。

## 6. 配置

```bash
cd /opt/roleplay-web
cp .env.deploy.example .env
nano .env
```

三个值都要填：

```dotenv
ADMIN_PASSWORD=至少12个字符的密码
PUBLIC_URL=https://chat.你的域名.com
DOMAIN=chat.你的域名.com
```

- `ADMIN_PASSWORD` 少于 12 位，容器会直接启动失败
- `PUBLIC_URL` 的**协议和域名**必须与最终访问地址完全一致：`https` 不能写成 `http`，`www.` 有就是有、没有就是没有。写错的后果不是报错，而是页面能打开、但所有提交请求静默返回 403
- `DOMAIN` 只填域名，不带协议和路径

## 7. 启动

```bash
docker compose up -d --build
docker compose ps
```

首次构建要拉 `node:24-bookworm-slim`（约 80MB）并编译前端，两三分钟。然后：

```bash
docker compose logs -f caddy
```

看到 `certificate obtained successfully` 就成功了。没看到等 30 秒再刷。

```bash
curl -I https://chat.你的域名.com/
```

返回 `HTTP/2 200` 即完成。

## 8. 首次使用

1. 打开 `https://chat.你的域名.com/research`，账号 `admin` + 你在 `.env` 里设的密码
2. 填 API 地址（必须是完整 HTTPS 的 `/v1/chat/completions`）、模型 ID、Key，保存
3. 点「测试已保存接口」——这一步只发一条 32 token 的请求，费用极低，但能立刻暴露接口/密钥问题
4. 导入角色卡、上传人物图、保存
5. 打开 `https://chat.你的域名.com/`，被试入口就在这里

## 9. 日常运维

**更新代码后重新部署**

```bash
cd /opt/roleplay-web
git pull
docker compose up -d --build
```

**改后台密码**（数据不会丢，API Key 也不受影响）

```bash
nano .env          # 改 ADMIN_PASSWORD
docker compose up -d --force-recreate app
```

**备份**

```bash
chmod +x backup.sh
./backup.sh
```

脚本会先停 app 再打包，避免 SQLite 的 WAL 处于中间状态。产物在 `backups/`，包含数据库、加密密钥、角色卡和人物图——**必须整目录备份**，只备份 sqlite 会导致密钥解不开、API Key 作废。

加到 crontab，每天凌晨 3 点自动备份并保留 7 天：

```bash
crontab -e
# 追加一行
0 3 * * * cd /opt/roleplay-web && ./backup.sh >> backups/cron.log 2>&1 && ls -1t backups/*.tar.gz | tail -n +8 | xargs -r rm
```

**恢复**

```bash
docker compose stop app
docker run --rm -v roleplay-data:/data -v "$PWD/backups":/backup alpine \
  sh -c "rm -rf /data/* /data/.[!.]* ; tar xzf /backup/roleplay-data-时间戳.tar.gz -C /data"
docker compose start app
```

**看日志**

```bash
docker compose logs -f app     # 应用
docker compose logs -f caddy   # 证书与访问日志
```

## 10. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 容器起不来，日志提示 `set ADMIN_PASSWORD` | `.env` 没填或密码不足 12 位 | 补齐后 `docker compose up -d` |
| 页面能开，但点开始/保存返回 403 | `PUBLIC_URL` 与浏览器地址不一致 | 协议和域名逐字对齐（`https`、`www` 都不能含糊），再 `--force-recreate` |
| `/research` 反复弹登录框 | 密码不对，或反代吃了 `Authorization` 头 | 确认账号是 `admin`；`Caddyfile` 里不要加 `basic_auth` |
| 证书申请失败 | 80 端口未放行，或 DNS 未生效 | 放行 80/443；`dig` 确认解析 |
| 页面空白 / 502 | app 容器没起来 | `docker compose ps` 看状态，`logs app` 看错误 |
| 上传人物图失败 | 请求体超过 640KB | 换小图；前端已压到 720px，正常够用 |
| 发送消息转圈后报错 | 模型接口不通或超时 | 回后台点「测试已保存接口」定位 |

---

## 上线前检查清单

- [ ] HTTPS 打开是绿锁，`/research` 能用 admin 登进去
- [ ] API 配置保存后，「测试已保存接口」返回成功
- [ ] 角色卡、人物图、开场白都导入正常
- [ ] 用**手机流量（不是校园网）**打开一次，确认外网可达
- [ ] 完整跑一遍八轮对话，确认结束时提示符合预期
- [ ] `./backup.sh` 跑通，crontab 已加
- [ ] 记下备份文件位置，以及 `PUBLIC_URL` 的值写在哪里

## 两个提醒

被试入口没有后台链接，但地址是可以猜到的。后台再弱也要用 12 位以上密码——它保护的是你的模型 Key 和全部角色配置。

会话有 30 分钟闲置过期机制，结束的对话会清文本。如果你的实验设计需要保留完整对话记录，得在结束前自己导出，源码默认不提供导出功能。
