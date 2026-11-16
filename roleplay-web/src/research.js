const $ = id => document.getElementById(id);
const fields = ["name", "description", "personality", "scenario", "greeting", "examples", "instructions", "afterHistory"];
let version = null;
let pendingPortrait;
let previewUrl;
let ready = false;
let filesPending = 0;
let saving = false;

function busyState() {
  $("publish").disabled = !ready || saving || filesPending > 0;
}
function status(message, error = false) {
  $("config-status").textContent = message;
  $("config-status").classList.toggle("error", error);
}
function providerStatus(available) {
  $("api-status").textContent = available ? "实时回复已接入。" : "实时回复待连接。已发布的角色仍可展示开场白。";
}

function showPortrait(url) {
  if (previewUrl && previewUrl !== url) URL.revokeObjectURL(previewUrl);
  previewUrl = url?.startsWith("blob:") ? url : undefined;
  const preview = $("portrait-preview");
  preview.replaceChildren();
  if (!url) {
    preview.textContent = "···";
    return;
  }
  const image = new Image();
  image.alt = "";
  image.src = url;
  preview.append(image);
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

function readPngCard(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (data.length < 20 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw Error("这不是可读的 PNG 文件。");
  const embedded = {};
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = view.getUint32(offset);
    const type = bytesToText(data.subarray(offset + 4, offset + 8));
    const end = offset + 8 + length;
    if (end + 4 > data.length) throw Error("PNG 文件已损坏。");
    if (type === "IEND") break;
    if (type === "tEXt") {
      const chunk = data.subarray(offset + 8, end);
      const separator = chunk.indexOf(0);
      const key = separator > 0 ? bytesToText(chunk.subarray(0, separator)).toLowerCase() : "";
      if ((key === "ccv3" || key === "chara") && !embedded[key]) embedded[key] = bytesToText(chunk.subarray(separator + 1));
    }
    offset = end + 4;
  }
  const value = embedded.ccv3 ?? embedded.chara;
  if (!value) throw Error("PNG 中没有找到 SillyTavern 角色卡。可导入 JSON，或在人物图栏中单独上传此图。");
  return JSON.parse(bytesToText(Uint8Array.from(atob(value), symbol => symbol.charCodeAt(0))));
}

function fieldsFromCard(card) {
  const role = card?.data ?? card;
  if (!role || typeof role.name !== "string" || !role.name.trim()) throw Error("角色卡缺少角色名称。");
  const mapping = { name: "name", description: "description", personality: "personality", scenario: "scenario", greeting: "first_mes", examples: "mes_example", instructions: "system_prompt", afterHistory: "post_history_instructions" };
  return Object.fromEntries(Object.entries(mapping).map(([field, key]) => {
    const value = typeof role[key] === "string" ? role[key] : "";
    if (value.length > $(field).maxLength) throw Error($(field).labels[0].textContent.trim() + "超出长度，请先缩短该字段。");
    return [field, value];
  }));
}

async function cleanPortrait(file) {
  if (file.size > 12 * 1024 * 1024) throw Error("人物图须小于 12 MB。");
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw Error("无法读取人物图。请上传 PNG、JPG 或 WebP。");
  }
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 720 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8ece2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .8).split(",")[1];
  } finally {
    image.close();
  }
}

function setPortrait(value) {
  pendingPortrait = value;
  const blob = new Blob([Uint8Array.from(atob(value), symbol => symbol.charCodeAt(0))], { type: "image/jpeg" });
  showPortrait(URL.createObjectURL(blob));
}

async function useFile(event, handle) {
  const file = event.target.files?.[0];
  if (!file) return;
  filesPending++;
  busyState();
  try {
    await handle(file);
  } catch (failure) {
    status(failure.message, true);
  } finally {
    event.target.value = "";
    filesPending--;
    busyState();
  }
}

$("card").addEventListener("change", event => useFile(event, async file => {
  if (file.size > 12 * 1024 * 1024) throw Error("角色卡须小于 12 MB。");
  const png = file.name.toLowerCase().endsWith(".png");
  const card = png ? readPngCard(await file.arrayBuffer()) : JSON.parse(await file.text());
  const imported = fieldsFromCard(card);
  const image = png ? await cleanPortrait(file) : null;
  for (const [field, value] of Object.entries(imported)) $(field).value = value;
  if (image) setPortrait(image);
  status("角色卡已导入。检查内容后可保存角色。");
}));

$("portrait").addEventListener("change", event => useFile(event, async file => {
  setPortrait(await cleanPortrait(file));
  status("人物图已选中，保存后生效。");
}));

$("clear-portrait").addEventListener("click", () => {
  pendingPortrait = "";
  showPortrait(null);
  status("人物图已移除，保存后生效。");
});

$("settings").addEventListener("submit", async event => {
  event.preventDefault();
  if ($("publish").disabled) return;
  saving = true;
  busyState();
  try {
    const role = Object.fromEntries(fields.map(field => [field, $(field).value]));
    const response = await fetch("/api/research/role", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, role, portrait: pendingPortrait })
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "保存未完成。");
    version = result.version;
    pendingPortrait = undefined;
    status("已保存。下一次开始的对话会加载此版本。");
    providerStatus(result.available);
  } catch (failure) {
    status(failure.message, true);
  } finally {
    saving = false;
    busyState();
  }
});

try {
  const response = await fetch("/api/research/role");
  if (!response.ok) throw Error("无法读取角色配置。");
  const value = await response.json();
  version = value.version;
  for (const field of fields) $(field).value = value.role?.[field] ?? "";
  showPortrait(value.portrait);
  status(value.role ? "已加载当前发布版本。" : "尚未发布角色。可导入角色卡或手动填写。");
  providerStatus(value.available);
  ready = true;
  busyState();
} catch (failure) {
  status(failure.message, true);
}

async function apiAction(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '接口配置未完成。');
  return value;
}

async function withApiButtons(task) {
  $('save-api').disabled = true;
  $('test-api').disabled = true;
  $('provider-message').classList.remove('error');
  try { await task(); } catch (failure) {
    $('provider-message').textContent = failure.message;
    $('provider-message').classList.add('error');
  } finally {
    $('save-api').disabled = false;
    $('test-api').disabled = false;
  }
}

$('api-settings').addEventListener('submit', event => {
  event.preventDefault();
  withApiButtons(async () => {
    await apiAction('/api/research/provider', {
      url: $('api-url').value, model: $('api-model').value, key: $('api-key').value
    });
    $('api-key').value = '';
    $('api-key').placeholder = '已保存密钥，留空保留原值';
    $('provider-message').textContent = 'API 配置已保存，可以测试连接。';
    providerStatus(true);
  });
});

$('test-api').addEventListener('click', () => withApiButtons(async () => {
  $('provider-message').textContent = '正在测试已保存的接口…';
  const result = await apiAction('/api/research/provider/test', {});
  $('provider-message').textContent = result.message;
}));

try {
  const provider = await apiAction('/api/research/provider');
  $('api-url').value = provider.url;
  $('api-model').value = provider.model;
  $('api-key').placeholder = provider.hasKey ? '已保存密钥，留空保留原值' : '填写服务商提供的 API Key';
  $('provider-message').textContent = provider.hasKey ? '已加载接口配置。' : '填写接口、模型和密钥后保存。';
  $('save-api').disabled = false;
} catch (failure) {
  $('provider-message').textContent = failure.message;
}
