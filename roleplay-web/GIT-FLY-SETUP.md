# GitHub + 自动发布手册

## 先说清楚一件事

**Cloudflare 承载不了这套代码的运行时。**

- Cloudflare Pages 只发静态文件，而这个项目的核心是 `node:sqlite` 往本地文件写数据 + 一个常驻 Node 进程，Pages 上跑不起来
- Workers 没有持久文件系统；要改成 D1，得重写整个数据层（`server.mjs` 是 `node:http` 服务，Workers 的 fetch handler 不兼容），不是几天的活
- Cloudflare 里唯一能用在你这套上的是 **Tunnel**，但它解决的是"把已有机器暴露到公网"，前提是你先有一台机器

所以这条链路保留你的思路（**源码在 Git，push 就自动发布**），把执行平台换成 Fly.io——它已经在项目里配好了，加上这份 workflow 就变成：`git push` → 自动构建 → 自动上线。

---

## 0. 先装 Git

这台机器上目前没有 Git（我查过了）。二选一：

```powershell
winget install --id Git.Git -e --source winget
```

或者装 [GitHub Desktop](https://desktop.github.com)，它自带 Git，还有图形界面，后面 push 可以完全点鼠标。

装完关掉终端重开，`git --version` 能出版本号就行。

## 1. 建一个私有仓库

GitHub → New repository：

- 名字随意，比如 `roleplay-web`
- **选 Private**
- 不要勾 "Add a README"

## 2. 把代码推上去

在项目目录里执行（把地址换成你自己的）：

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-11-16-17-39-33\roleplay-web
git init -b main
git add .
git status
```

**先看 `git status` 的输出。** 确认列表里**没有** `.env` 这一行——里面有你的后台密码，不能进仓库。`.gitignore` 已经排除了它，但推之前自己扫一眼比事后删安全。

确认没问题再提交：

```powershell
git commit -m "角色对话网页：初始版本"
git remote add origin https://github.com/你的用户名/roleplay-web.git
git push -u origin main
```

推完到 GitHub 页面上看一眼，文件列表里应该有 `fly.toml`、`Dockerfile`、`.github/workflows/deploy.yml`，且**没有** `.env`。

## 3. 让 GitHub 能部署到 Fly

先去 Fly 拿一个长期有效的部署令牌：

```powershell
fly tokens create deploy -x 999999h
```

它输出一长串 `FlyV1 ...`，复制下来。

然后 GitHub 仓库 → Settings → Secrets and variables → Actions → **New repository secret**：

- Name：`FLY_API_TOKEN`
- Secret：粘贴刚才那串

## 4. 先手动部署一次

这一步不能跳过。自动部署的 workflow 只会 `deploy`，不会建卷、不会设密钥——第一次必须手动把地基打好：

```powershell
fly volumes create roleplay_data -a 你的应用名 --region nrt --size 1
fly secrets set ADMIN_PASSWORD="你的12位密码" -a 你的应用名
fly secrets set PUBLIC_URL="https://你的应用名.fly.dev" -a 你的应用名
fly deploy -a 你的应用名 --ha=false
```

细节见项目里的 `FLY-DEPLOY.md`。

## 5. 之后的更新流程

改完代码，三条命令：

```powershell
git add .
git commit -m "改了什么"
git push
```

GitHub Actions 自动接着跑：构建镜像 → 推给 Fly → 滚动上线。进度在仓库的 **Actions** 标签页里看。

大约两三分钟。数据不受影响，卷是独立于容器的。

## 几个必须知道的点

**卷和密钥不在 Git 里。** 它们属于 Fly 上的应用实例，不在仓库中。换一台机器重新部署、或者在别处重建应用，都要重新建卷、重新设密钥。这也是为什么备份要做——数据只在那一块卷上。

**`.env` 永远不进仓库。** 线上用的是 `fly secrets`，本地用的是 `.env`，两者互不相干。别人 clone 你的仓库也应该能构建，因为构建时不需要密钥。

**workflow 里保留了 `--ha=false`。** 和手动部署一样，多起一台机器会抢同一块卷，两台各写各的数据库，数据会分裂而且查不出来。

**别改应用名。** `PUBLIC_URL` 里写的是 `https://应用名.fly.dev`，改名字就得同步改密钥，否则所有提交请求静默 403。

## 顺带说一句 Cloudflare

如果以后你课题组有了一台常开的机器，Cloudflare Tunnel 可以和这套共存：代码仍然在 Git，机器上 `git pull` 后重启容器，Tunnel 负责把内网端口映射出去，连备案都不用。到那时才真正用得上 Cloudflare。
