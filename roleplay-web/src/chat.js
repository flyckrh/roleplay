const $ = id => document.getElementById(id);
const thread = $("thread");
const form = $("compose");
const message = $("message");
let current;
let busy = false;
let finished = false;
let attempted;

async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "请求未完成，请重试。");
  return result;
}

function portrait(role) {
  const avatar = $("avatar");
  avatar.replaceChildren();
  if (role?.portrait) {
    const img = new Image();
    img.src = role.portrait;
    img.alt = "";
    avatar.append(img);
  } else {
    avatar.textContent = role ? Array.from(role.name)[0] : "···";
  }
}

function bubble(text, speaker, side = "") {
  const item = document.createElement("div");
  item.className = "bubble-row " + side;
  const label = document.createElement("p");
  label.className = "speaker";
  label.textContent = speaker;
  const body = document.createElement("p");
  body.className = "bubble";
  body.textContent = text;
  item.append(label, body);
  return item;
}

function empty(title, detail) {
  const box = document.createElement("div");
  box.className = "empty";
  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "···";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  box.append(icon, heading, paragraph);
  thread.append(box);
}

function startButton(label) {
  const button = document.createElement("button");
  button.className = "button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => act(async () => {
    current = await request("/api/chat/start", {});
    finished = false;
    render();
    if (!form.hidden) message.focus();
  }, button));
  $("chat-foot").append(button);
}

function render() {
  thread.replaceChildren();
  $("chat-foot").replaceChildren();
  form.hidden = true;
  $("end").hidden = !current?.active;
  const role = current?.role;
  $("character").textContent = role?.name ?? "情境对话";
  portrait(role);
  if (finished) {
    $("status").textContent = "体验结束";
    empty("对话已结束", "你可以关闭此页面。");
    if (role) startButton("重新开始");
    return;
  }
  if (!role) {
    $("status").textContent = "等待开放";
    empty("对话暂未开放", "请稍后从原入口重新打开。");
    return;
  }
  $("status").textContent = "虚构角色";
  if (!current.active) {
    empty("开始一段对话", "准备好后，打开角色发来的第一条消息。");
    startButton("打开消息");
    return;
  }
  thread.append(bubble(role.greeting, role.name));
  for (const item of current.messages) {
    const yours = item.role === "user";
    thread.append(bubble(item.content, yours ? "你" : role.name, yours ? "mine" : ""));
  }
  const remaining = current.maxTurns - current.turns;
  if (current.available && remaining > 0) {
    form.hidden = false;
    $("chat-foot").textContent = "AI 角色模拟 · 发送的文字会交由模型服务生成回复，还可发送 " + remaining + " 条。";
  } else {
    $("chat-foot").textContent = remaining === 0 ? "本次对话轮次已用完，可以结束对话。" : "当前可阅读角色消息，实时回复暂未开启。";
  }
  thread.scrollTop = thread.scrollHeight;
}

async function act(task, button) {
  if (busy) return;
  busy = true;
  $("error").textContent = "";
  if (button) button.disabled = true;
  try {
    await task();
  } catch (failure) {
    $("error").textContent = failure.message;
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const text = message.value.trim();
  if (!text) return;
  if (attempted?.text !== text) attempted = { text, requestId: crypto.randomUUID() };
  act(async () => {
    message.readOnly = true;
    $("status").textContent = "正在等待回复";
    try {
      current = await request("/api/chat/message", attempted);
      message.value = "";
      attempted = undefined;
      render();
    } finally {
      message.readOnly = false;
      $("status").textContent = "虚构角色";
      if (!form.hidden) message.focus();
    }
  }, form.querySelector("button"));
});

$("end").addEventListener("click", () => act(async () => {
  await request("/api/chat/end", {});
  current = await request("/api/chat");
  finished = true;
  message.value = "";
  attempted = undefined;
  render();
}, $("end")));

try {
  current = await request("/api/chat");
  render();
} catch (failure) {
  $("status").textContent = "暂时无法连接";
  empty("对话未能载入", "请刷新页面后重试。");
  $("error").textContent = failure.message;
}
