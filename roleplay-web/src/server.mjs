import { expand, messagesFor, validateRole } from "./role.mjs";
import { assets } from "./assets.mjs";

const sessionAge = 30 * 60 * 1000;
const maxTurns = 8;
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const error = (message, status) => json({ error: message }, status);
const statement = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);

function isAdmin(request, env) {
  return env.ADMIN_AUTHENTICATED === true;
}

function sessionId(request) {
  const value = request.headers.get("Cookie")?.match(/(?:^|;\s*)scene_chat=([^;]+)/)?.[1];
  return idPattern.test(value ?? "") ? value : null;
}

function cookie(request, id, age) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "scene_chat=" + id + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + age + secure;
}

async function parseBody(request, limit) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json") || !request.body) return null;
  const stream = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await stream.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function endpoint(env) {
  if (!env.CHAT_MODEL || !env.CHAT_API_KEY) return null;
  try {
    const url = new URL(env.CHAT_API_URL);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url : null;
  } catch {
    return null;
  }
}

async function latest(env) {
  return statement(env, "SELECT * FROM character_versions ORDER BY rowid DESC LIMIT 1").first();
}

async function session(request, env) {
  const id = sessionId(request);
  if (!id) return null;
  return statement(env, "SELECT * FROM chat_sessions WHERE id = ? AND updated_at >= ?", id, Date.now() - sessionAge).first();
}

function roleView(row) {
  const role = JSON.parse(row.settings);
  return { name: role.name, greeting: expand(role.greeting, role.name), portrait: row.portrait ? "/avatar/" + row.id : null };
}

async function state(request, env) {
  const active = await session(request, env);
  const character = active
    ? await statement(env, "SELECT * FROM character_versions WHERE id = ?", active.character_id).first()
    : await latest(env);
  return {
    role: character ? roleView(character) : null,
    available: Boolean(endpoint(env)),
    active: Boolean(active), turns: active?.turns ?? 0, maxTurns,
    messages: active ? JSON.parse(active.transcript).flatMap(turn => [
      { role: "user", content: turn.input }, { role: "assistant", content: turn.reply }
    ]) : []
  };
}

async function adminRoute(request, env, path) {
  if (!isAdmin(request, env)) return error("页面不存在。", 404);
  if (request.method === "GET" && path === "/api/research/role") {
    const row = await latest(env);
    return json({
      role: row ? JSON.parse(row.settings) : null,
      portrait: row?.portrait ? "/avatar/" + row.id : null,
      version: row?.id ?? null,
      available: Boolean(endpoint(env))
    });
  }
  if (request.method !== "POST" || path !== "/api/research/role") return error("页面不存在。", 404);
  const input = await parseBody(request, 630000);
  const role = validateRole(input?.role);
  if (!role) return error("请填写角色名称、开场白，以及人物设定、情境或提示词。", 400);
  const current = await latest(env);
  if ((input.version ?? null) !== (current?.id ?? null)) return error("已有新版本，请刷新页面后重新编辑。", 409);
  const portrait = input.portrait === undefined ? current?.portrait ?? "" : input.portrait;
  if (typeof portrait !== "string" || portrait.length > 420000 || (portrait && !/^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(portrait))) {
    return error("人物图未能保存，请重新选择图片。", 400);
  }
  const id = crypto.randomUUID();
  const saved = await statement(env,
    "INSERT INTO character_versions (id, settings, portrait, created_at) SELECT ?, ?, ?, ? WHERE COALESCE((SELECT id FROM character_versions ORDER BY rowid DESC LIMIT 1), '') = ?",
    id, JSON.stringify(role), portrait, Date.now(), current?.id ?? "").run();
  if (!saved.meta.changes) return error("已有新版本，请刷新页面后重新编辑。", 409);
  return json({ version: id, portrait: portrait ? "/avatar/" + id : null, available: Boolean(endpoint(env)) });
}

async function reply(request, env, data) {
  const provider = endpoint(env);
  if (!provider) return error("实时对话暂未开启。", 503);
  const input = typeof data.text === "string" ? data.text.trim() : "";
  if (!input || [...input].length > 500 || !idPattern.test(data.requestId ?? "")) return error("请输入 1 至 500 字。", 400);
  const current = await session(request, env);
  if (!current) return error("这次对话已结束，请重新开始。", 409);
  const history = JSON.parse(current.transcript);
  if (history.some(turn => turn.id === data.requestId)) return json(await state(request, env));
  const now = Date.now();
  const pending = crypto.randomUUID();
  const claimed = await statement(env,
    "UPDATE chat_sessions SET pending = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND turns = ? AND turns < ? AND attempts < 12 AND (pending IS NULL OR updated_at < ?)",
    pending, now, current.id, current.turns, maxTurns, now - 30000).run();
  if (!claimed.meta.changes) return error("有消息正在发送，或对话已达到上限。", 409);

  try {
    const character = await statement(env, "SELECT settings FROM character_versions WHERE id = ?", current.character_id).first();
    const upstream = await fetch(provider, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: "Bearer " + env.CHAT_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.CHAT_MODEL, messages: messagesFor(JSON.parse(character.settings), history, input), max_tokens: 400 })
    });
    if (!upstream.ok) throw Error("provider");
    const result = await upstream.json();
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw Error("empty");
    const transcript = [...history, { id: data.requestId, input, reply: text.trim().slice(0, 2000) }];
    const saved = await statement(env,
      "UPDATE chat_sessions SET transcript = ?, pending = NULL, turns = turns + 1, updated_at = ? WHERE id = ? AND pending = ?",
      JSON.stringify(transcript), Date.now(), current.id, pending).run();
    if (!saved.meta.changes) return error("这次对话已结束。", 409);
    return json(await state(request, env), 200, { "Set-Cookie": cookie(request, current.id, 1800) });
  } catch {
    await statement(env, "UPDATE chat_sessions SET pending = NULL WHERE id = ? AND pending = ?", current.id, pending).run();
    return error("暂时没有收到回复。你可以重试或结束对话。", 502);
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin) return error("请求来源无效。", 403);

  if (path === "/research" || path === "/research.js" || path.startsWith("/api/research/")) {
    if (!isAdmin(request, env)) return new Response("页面不存在。", { status: 404, headers });
    if (path.startsWith("/api/")) return adminRoute(request, env, path);
  }
  const asset = assets[path === "/" ? "/index.html" : path === "/research" ? "/research.html" : path];
  if (request.method === "GET" && Object.hasOwn(assets, path === "/" ? "/index.html" : path === "/research" ? "/research.html" : path) && path !== "/research.html") {
    return new Response(asset.body, { headers: { ...headers, "Content-Type": asset.type } });
  }
  if (!env.DB) return error("服务尚未连接。", 503);

  if (request.method === "GET" && path.startsWith("/avatar/")) {
    const id = path.slice(8);
    const active = await session(request, env);
    const published = await latest(env);
    if (!idPattern.test(id) || (id !== published?.id && id !== active?.character_id)) return error("图片不存在。", 404);
    const row = id === published?.id ? published : await statement(env, "SELECT portrait FROM character_versions WHERE id = ?", id).first();
    if (!row?.portrait) return error("图片不存在。", 404);
    return new Response(Uint8Array.from(atob(row.portrait), letter => letter.charCodeAt(0)), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  }

  if (path === "/api/chat" && request.method === "GET") return json(await state(request, env));
  if (path === "/api/chat/start" && request.method === "POST") {
    const character = await latest(env);
    if (!character) return error("对话暂未开放。", 409);
    const existing = await session(request, env);
    if (existing) return json(await state(request, env));
    // Remove expired histories even when users close their tab without ending the chat.
    await statement(env, "DELETE FROM chat_sessions WHERE updated_at < ?", Date.now() - sessionAge).run();
    const id = crypto.randomUUID();
    await statement(env, "INSERT INTO chat_sessions (id, character_id, updated_at) VALUES (?, ?, ?)", id, character.id, Date.now()).run();
    return json({ role: roleView(character), active: true, available: Boolean(endpoint(env)), messages: [], turns: 0, maxTurns }, 200, { "Set-Cookie": cookie(request, id, 1800) });
  }
  if (path === "/api/chat/end" && request.method === "POST") {
    const id = sessionId(request);
    if (id) await statement(env, "DELETE FROM chat_sessions WHERE id = ?", id).run();
    return json({ ended: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (path === "/api/chat/message" && request.method === "POST") {
    const body = await parseBody(request, 4096);
    return body ? reply(request, env, body) : error("无法读取消息。", 400);
  }
  return error("页面不存在。", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (failure) {
      console.error("Conversation request failed", failure.name);
      return error("对话服务暂时不可用。", 500);
    }
  }
};
