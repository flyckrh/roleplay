import { createServer } from "node:http";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./dist/server/index.js";

export async function createApplication(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 4177);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const origin = new URL(options.origin ?? process.env.PUBLIC_URL ?? "http://127.0.0.1:" + port).origin;
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  if (typeof password !== "string" || password.length < 12) throw Error("请在 .env 中设置至少 12 字符的 ADMIN_PASSWORD。");
  const directory = resolve(options.directory ?? process.env.DATA_DIR ?? ".local");
  await mkdir(directory, { recursive: true });
  const keyPath = join(directory, "api-encryption.key");
  let encryptionKey;
  try {
    encryptionKey = await readFile(keyPath);
  } catch (failure) {
    if (failure.code !== "ENOENT") throw failure;
    encryptionKey = randomBytes(32);
    await writeFile(keyPath, encryptionKey, { flag: "wx", mode: 0o600 });
  }
  if (encryptionKey.length !== 32) throw Error("API 加密文件损坏。请恢复数据目录备份。");
  const db = new DatabaseSync(join(directory, "chat.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(await readFile(new URL("drizzle/0000_chat.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE IF NOT EXISTS provider_config (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)");
  const DB = { prepare(sql) {
    const statement = db.prepare(sql);
    return { bind(...values) {
      return {
        first: async () => statement.get(...values) ?? null,
        run: async () => ({ meta: { changes: statement.run(...values).changes } })
      };
    }};
  }};
  const passwordDigest = createHash("sha256").update("admin:" + password).digest();
  const attempts = new Map();
  const upstreamFetch = options.fetch ?? fetch;

  function authorized(incoming) {
    const auth = incoming.headers.authorization ?? "";
    if (!auth.startsWith("Basic ") || auth.length > 4096) return false;
    const supplied = Buffer.from(auth.slice(6), "base64").toString("utf8");
    return timingSafeEqual(createHash("sha256").update(supplied).digest(), passwordDigest);
  }

  function loadProvider() {
    const record = db.prepare("SELECT payload FROM provider_config WHERE id = 1").get();
    if (!record) return { url: "", model: "", key: "" };
    const data = JSON.parse(record.payload);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(data.iv, "base64"));
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body, "base64")), decipher.final()]).toString("utf8"));
  }
  function saveProvider(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const payload = JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") });
    db.prepare("INSERT INTO provider_config (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(payload);
  }
  const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

  async function providerRoute(request, path) {
    const existing = loadProvider();
    if (request.method === "GET" && path === "/api/research/provider") {
      return json({ url: existing.url, model: existing.model, hasKey: Boolean(existing.key) });
    }
    if (request.method !== "POST") return json({error:"请求方式无效。"},405);
    if (path === "/api/research/provider/test") {
      if (!existing.url || !existing.key || !existing.model) return json({error:"请先保存完整的 API 配置。"},400);
      try {
        const response = await upstreamFetch(existing.url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
          headers: { Authorization: "Bearer " + existing.key, "Content-Type": "application/json" },
          body: JSON.stringify({ model: existing.model, messages: [{role:"user",content:"Reply with OK."}], max_tokens:32 })
        });
        if (!response.ok) return json({error:"服务商返回 HTTP " + response.status + "，请核对接口、模型和密钥。"},502);
        const data = await response.json();
        if (typeof data.choices?.[0]?.message?.content !== "string") return json({error:"接口返回格式不符合 Chat Completions。"},502);
        return json({ok:true,message:"连接测试成功，可以开始对话。"});
      } catch {
        return json({error:"连接失败或超时，请检查接口地址及服务器网络。"},502);
      }
    }
    if (path !== "/api/research/provider") return json({error:"页面不存在。"},404);
    let data;
    try { data = await request.json(); } catch { return json({error:"配置格式错误。"},400); }
    if (!data || typeof data.url !== "string" || typeof data.model !== "string" || typeof data.key !== "string"
      || data.url.length > 2000 || data.model.length > 200 || data.key.length > 8000) return json({error:"请正确填写 API 配置。"},400);
    let url;
    try { url = new URL(data.url.trim()); } catch { return json({error:"请输入完整的 HTTPS API 地址。"},400); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return json({error:"请输入无用户信息的 HTTPS API 地址。"},400);
    const model = data.model.trim();
    const key = data.key.trim() || existing.key;
    if (!model || !key || /[\r\n]/.test(key)) return json({error:"请填写模型名称和 API Key。"},400);
    saveProvider({ url:url.href, model, key });
    return json({ok:true,hasKey:true});
  }

  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(origin + incoming.url);
      const adminPath = url.pathname === "/research" || url.pathname === "/research/" || url.pathname === "/research.html"
        || url.pathname === "/research.js" || url.pathname.startsWith("/api/research/");
      const admin = authorized(incoming);
      if (adminPath && !admin) {
        const ip = incoming.socket.remoteAddress;
        const now = Date.now();
        const entry = attempts.get(ip);
        const count = entry && entry.until > now ? entry.count + 1 : 1;
        if (attempts.size > 10000) attempts.clear();
        attempts.set(ip, { count, until:now + 60000 });
        outgoing.writeHead(count > 20 ? 429 : 401, { "WWW-Authenticate": 'Basic realm="Research", charset="UTF-8"', "Cache-Control":"no-store" }).end("Researcher authentication required.");
        return;
      }
      if (incoming.method === "POST" && incoming.headers.origin !== origin) {
        outgoing.writeHead(403).end("Invalid origin.");
        return;
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 640000) { outgoing.writeHead(413).end("Request too large."); return; }
        chunks.push(chunk);
      }
      const headers = new Headers(incoming.headers);
      headers.delete("oai-authenticated-user-email");
      headers.delete("authorization");
      const request = new Request(url, {
        method: incoming.method, headers,
        ...(["GET","HEAD"].includes(incoming.method) ? {} : { body:Buffer.concat(chunks) })
      });
      const provider = loadProvider();
      const response = url.pathname.startsWith("/api/research/provider")
        ? await providerRoute(request, url.pathname)
        : await worker.fetch(request, {
          DB, ADMIN_AUTHENTICATED: admin,
          CHAT_API_URL:provider.url, CHAT_API_KEY:provider.key, CHAT_MODEL:provider.model
        });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
      else outgoing.end();
    } catch {
      outgoing.writeHead(500, {"Cache-Control":"no-store"}).end("Service unavailable.");
    }
  });
  server.requestTimeout = 30000;
  server.on("close", () => db.close());
  return {server, host, port, origin};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {server, host, port, origin} = await createApplication();
    server.listen(port, host, () => console.log("Chat: " + origin + "\nConfiguration: " + origin + "/research"));
  } catch (failure) {
    console.error(failure.message);
    process.exitCode = 1;
  }
}
