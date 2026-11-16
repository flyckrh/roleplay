# 交接说明

你回来先看这一页就够。

## 现在的状态

源码已经在本地提交好了，接口实测能通。剩下三步都卡在同一件事上——**需要你的账号**，我做不了。

## 我做了什么

1. 装了 Git 2.56（`winget`，装到 `C:\Program Files\Git`）
2. 在 `roleplay-web/` 里初始化了仓库，提交了 29 个文件，commit `2612df7`，分支 `main`
3. 加了 `.gitattributes`，强制 `*.sh`、`Dockerfile`、`Caddyfile` 用 LF。不加的话 Windows 会把 `backup.sh` 存成 CRLF，拉到 Linux 服务器上会直接报 `bash: \r: command not found`
4. 读了本地数据库，核对了你保存的接口配置
5. 用你保存的 key 实测了一次 DeepSeek（一条 32 token 的请求，成本不到一分钱）

## 实测结果：接口是通的

```
url   = https://api.deepseek.com/chat/completions
model = deepseek-flash
结果  = HTTP 200，返回 "OK"，979ms
```

之前那个 404 已经解决了，地址和密钥都对。角色也已经存进库里（`character_versions` 1 行），对话还没开始过（`chat_sessions` 0 行）。

## 但发现两个隐患，实验前最好处理

**一、模型默认在"思考"。** 回包里带了 `reasoning_content` 字段，说明 `deepseek-flash` 这一路是带推理的。而 `src/server.mjs` 第 143 行写死了 20 秒超时（`AbortSignal.timeout(20000)`），思考型模型偶尔会顶到这条线，被试看到的是"服务暂时不可用"。

**二、思考模式和你的角色设定是反的。** 会推理的模型天然倾向"想周全再答"，而角色卡要求的是"像恋人一样即时反应、别分析、别面面俱到"。这两股力会互相拉扯，实测时很可能出现"太完整、太像 AI"的回复。

建议：正式收数据前先手动聊三轮，记一下每次的耗时和回复长度。如果又慢又啰嗦，要么换非思考模型，要么把角色卡里"每次只回应一个反应"那条再往前压。

## 你自己要做的三件事

**1. 建 GitHub 私有仓库**（别勾 README），然后：

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-11-16-17-39-33\roleplay-web
git config user.name "你的名字"
git config user.email "你的邮箱"
git commit --amend --reset-author --no-edit
git remote add origin https://github.com/你的用户名/roleplay-web.git
git push -u origin main
```

第二、三行是必须的——我用的是占位身份 `Administrator` 提交的，不改成你自己的，提交记录里就不是你。

**2. 拿 Fly 令牌填进仓库 Secret**

```powershell
fly auth signup
fly tokens create deploy -x 999999h
```

把输出的那串贴到 GitHub → Settings → Secrets and variables → Actions → `FLY_API_TOKEN`。

**3. 第一次手动部署**（不能交给 Actions，它不会建卷、不会设密钥）

```powershell
fly apps create nju-roleplay-1116
# 把 fly.toml 第一行 app 改成上面这个名字
fly volumes create roleplay_data -a nju-roleplay-1116 --region nrt --size 1
fly secrets set ADMIN_PASSWORD="换一个新密码" -a nju-roleplay-1116
fly secrets set PUBLIC_URL="https://nju-roleplay-1116.fly.dev" -a nju-roleplay-1116
fly deploy -a nju-roleplay-1116 --ha=false
```

细节在 `FLY-DEPLOY.md`，Git 那半段在 `GIT-FLY-SETUP.md`。

## 三个别忘

**后台密码换掉。** `qzy634295785` 在对话里出现过好几次，线上不要再用它。

**本地服务已停。** 想继续在本机调试，双击 `启动网页.cmd` 就行，`.env` 已经配好了。

**备份要整目录。** `.local` 里现在 `chat.sqlite` 只有 4KB，但 `chat.sqlite-wal` 有 135KB——真正的数据还在 WAL 里没合并。只拷 `.sqlite` 会丢东西，必须连 `-wal`、`-shm` 和 `api-encryption.key` 一起。

## 一个可以删的目录

`_extract/` 是我最初解压出来的原始副本，内容和现在的 `roleplay-web/` 一样但没有 `.env`。留着当对照可以，嫌乱直接删。
