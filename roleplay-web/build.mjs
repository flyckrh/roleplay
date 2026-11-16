import { mkdir, readFile, writeFile } from "node:fs/promises";

const read = filename => readFile(new URL(filename, import.meta.url), "utf8");
const output = new URL("dist/server/", import.meta.url);
await mkdir(output, { recursive: true });
const routes = {
  "/index.html": ["src/chat.html", "text/html; charset=utf-8"],
  "/research.html": ["src/research.html", "text/html; charset=utf-8"],
  "/ui.css": ["src/ui.css", "text/css; charset=utf-8"],
  "/chat.js": ["src/chat.js", "text/javascript; charset=utf-8"],
  "/research.js": ["src/research.js", "text/javascript; charset=utf-8"]
};
const assets = Object.fromEntries(await Promise.all(Object.entries(routes).map(async ([route, [filename, type]]) => [
  route, { body: await read(filename), type }
])));
const role = (await read("src/role.mjs")).replace(/^export /gm, "");
const server = (await read("src/server.mjs")).replace(/^import .+;\r?\n/gm, "");
await writeFile(new URL("index.js", output), "const assets = " + JSON.stringify(assets) + ";\n" + role + "\n" + server);
