# 角色对话网页源码

这是可自行部署的完整项目。包含被试对话页、研究者配置页、模型 API 代理和 SQLite 数据存储。角色卡、人物图、情境与提示词由你提供。

## 两个入口

| 地址 | 功能 |
|---|---|
| / | 被试打开角色消息、发送对话、结束体验 |
| /research | 密码登录后导入角色卡、上传人物图、修改提示词、设置 API |

研究者用户名固定为 admin。密码在服务器的 ADMIN_PASSWORD 中设置。被试页面没有后台链接，研究者页面和接口均验证密码。API 密钥加密存储在服务器，不返回给浏览器。

## 先在电脑上运行

准备 Node.js 24 或更新版本。项目仅使用 Node.js 内置模块，无需安装 npm 依赖。

Windows 可以双击“启动网页.cmd”。首次运行会打开 .env，请填写 ADMIN_PASSWORD，至少 12 个字符，保存并关闭记事本。命令窗口保持打开。

也可以在解压后的项目目录运行：

```powershell
Copy-Item .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD
npm run build
npm start
```

然后打开 http://127.0.0.1:4177/research，用 admin 和你设置的密码登录。

## 在配置页设置 API

1. 填写完整 HTTPS 接口地址，例如服务商提供的 https://api.example.com/v1/chat/completions。
2. 填写准确的模型 ID 和 API Key。
3. 点击“保存 API 配置”。
4. 点击“测试已保存接口”。测试会调用一次模型，可能产生服务商费用。
5. 导入 JSON / PNG 角色卡或手动填写角色，上传人物图并保存。
6. 打开 http://127.0.0.1:4177/ 开始体验。

兼容使用 messages 请求、choices[0].message.content 响应的 Chat Completions 接口。留空 API Key 后保存会保留已有密钥，填写新值会替换。真实服务商的可用性需要你提供接口后验证。

支持 SillyTavern V1/V2/V3 JSON 和含 chara/ccv3 文本块的 PNG。导入基本设定、性格、情境、开场白、对话示例、系统提示词和历史后指令。支持 {{char}} 和 {{user}} 占位符。独立世界书和扩展宏需要将所需文本填入提示词。

上传的 PNG 卡片头像会重新编码，去除图片里的角色卡元数据。JPG、PNG 和 WebP 均可作为人物图。

## 部署到你自己的服务器

需要能够运行 Node.js 并保存数据的服务器或应用托管平台。普通静态 HTML 托管只能展示前端，真实 API 调用和后台密码验证需要运行随包提供的后端。

把解压后的整个项目上传，设置环境变量：

```dotenv
ADMIN_PASSWORD=你自己设置的后台密码
PUBLIC_URL=https://chat.example.com
PORT=4177
HOST=0.0.0.0
DATA_DIR=/data/roleplay
```

PUBLIC_URL 填写最终对外访问的网站根地址。若平台分配端口，使用其提供的 PORT。DATA_DIR 指向可写且持久保留的目录。

构建命令为 npm run build，启动命令为 npm start。使用反向代理或平台的 HTTPS 域名，把请求转给 PORT。HTTP Basic 后台密码需要在 HTTPS 下传输。反向代理应保留 Authorization 请求头。应用部署在域名根路径。

例如你的域名是 https://chat.example.com，发给被试的地址就是该域名，后台是 https://chat.example.com/research。

## Docker 部署

已提供 Dockerfile。先创建自己的 .env，把 PUBLIC_URL 改为域名，HOST 改为 0.0.0.0，DATA_DIR 改为 /data，然后运行：

```sh
docker build -t roleplay-web .
docker run -d --name roleplay-web --restart unless-stopped --env-file .env -p 4177:4177 -v roleplay-data:/data roleplay-web
```

在服务器或平台配置 HTTPS 入口。此包没有依赖任何专有网站发布平台的登录或数据库。

## 源码位置

| 文件 | 用途 |
|---|---|
| src/chat.html、src/chat.js | 被试网页及交互 |
| src/research.html、src/research.js | 角色与 API 配置网页 |
| src/ui.css | 两个页面样式 |
| src/role.mjs | 角色字段与提示词拼装 |
| src/server.mjs | 对话、会话和角色保存逻辑 |
| server.mjs | HTTP 服务、后台密码、API 配置与加密 |
| build.mjs | 将资源打包为可运行的服务模块 |
| drizzle/0000_chat.sql | 自动初始化的数据表 |
| dist/server/index.js | 已构建的运行文件 |

修改 src 后运行 npm run build。启动服务后会自动初始化数据库。

## 数据与运行行为

角色卡、人物图和配置保存在 DATA_DIR。API 密钥由 AES-256-GCM 加密后入库，加密密钥文件也在该目录。迁移和备份时复制整个数据目录，并限制服务器上的文件访问权限。更换后台密码不会丢失 API 配置。

每次对话锁定开始时的角色版本。当前默认最多八条用户消息，在 src/server.mjs 的 maxTurns 处修改并重建。对话结束会清除该会话文本，闲置三十分钟后过期，过期记录在后续新建会话时清理。浏览器的 Basic 登录通常会保持到窗口关闭，研究者可使用独立浏览器配置文件管理后台。

压缩包不含真实角色、头像、API 密钥、密码或运行数据库。
