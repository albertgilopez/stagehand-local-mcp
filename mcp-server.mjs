// stagehand-local-mcp — a self-hosted MCP server wrapping the Stagehand library.
//
// Runs a LOCAL, headed, *persistent* browser (one window alive for the whole MCP session →
// no open/close per action; userDataDir reuses an authenticated session across restarts, so
// you log in once). The model API key is read from the environment, never from the MCP config.
//
// Tools: navigate, act, extract, observe, type, screenshot, status.
//
// Why self-hosted instead of a community package: the official Browserbase MCP is cloud-only,
// and giving a third-party package control of your authenticated browser + API key is a
// supply-chain risk. This wraps the audited Stagehand library directly — you own the code.
//
// MCP/stdio rule: stdout is reserved for the JSON-RPC protocol. ALL logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

// ── API key: env var first; optionally from a dotenv-style file via ENV_FILE (keeps the key
//    out of the MCP config in plaintext). Never logged, never returned by any tool.
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  const envFile = process.env.ENV_FILE;
  if (envFile && fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}
const apiKey = resolveApiKey();
if (!apiKey) { console.error("[stagehand-mcp] Missing ANTHROPIC_API_KEY (env var or ENV_FILE)"); process.exit(1); }
process.env.ANTHROPIC_API_KEY = apiKey; // the AI SDK reads it from the env var

const MODEL = process.env.STAGEHAND_MODEL || "anthropic/claude-sonnet-4-6";
const HEADLESS = /^(1|true|yes)$/i.test(process.env.STAGEHAND_HEADLESS || "");
const USER_DATA_DIR = process.env.STAGEHAND_USER_DATA_DIR || path.join(__dir, ".auth", "chrome-profile");
fs.mkdirSync(USER_DATA_DIR, { recursive: true }); // Stagehand writes chrome-out.log here; must exist

const log = (...a) => console.error("[stagehand-mcp]", ...a);

let sh = null;
async function ensure() {
  if (sh) return sh;
  log(`launching Stagehand (headless=${HEADLESS}, model=${MODEL})`);
  sh = new Stagehand({
    env: "LOCAL",
    model: { modelName: MODEL, apiKey },
    localBrowserLaunchOptions: { headless: HEADLESS, userDataDir: USER_DATA_DIR },
    verbose: 0,
    logger: (line) => log("sh:", typeof line === "string" ? line : (line?.message || JSON.stringify(line))),
  });
  await sh.init();
  log("Stagehand ready");
  return sh;
}
const pg = () => sh.context.pages()[0];
const txt = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });

const server = new McpServer({ name: "stagehand-local-mcp", version: "0.1.0" });

server.tool("stagehand_navigate", { url: z.string().describe("absolute URL to navigate to") },
  async ({ url }) => {
    await ensure(); const p = pg();
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2000);
    return txt(`navigated -> ${p.url()} | title: ${await p.title()}`);
  });

server.tool("stagehand_act", { instruction: z.string().describe("natural-language action, e.g. 'click the login button'. To type into a field use 'type \"X\" into the Y field' (maps to fill)") },
  async ({ instruction }) => {
    await ensure();
    const r = await sh.act(instruction);
    await pg().waitForTimeout(1500);
    return txt({ acted: instruction, result: r, url: pg().url() });
  });

server.tool("stagehand_extract", {
  instruction: z.string().describe("what to extract, in natural language"),
  fields: z.array(z.string()).optional().describe("keys to extract per row; if omitted, returns free text"),
  screenshot: z.boolean().optional().describe("also send a viewport screenshot (vision) alongside the a11y tree"),
}, async ({ instruction, fields, screenshot }) => {
  await ensure();
  let schema;
  if (fields && fields.length) {
    const shape = {}; for (const f of fields) shape[f] = z.string();
    schema = z.object({ items: z.array(z.object(shape)) });
  } else {
    schema = z.object({ text: z.string() });
  }
  const r = await sh.extract(instruction, schema, screenshot ? { screenshot: true } : undefined);
  return txt(r);
});

server.tool("stagehand_observe", { instruction: z.string().describe("which elements to locate") },
  async ({ instruction }) => {
    await ensure();
    return txt(await sh.observe(instruction));
  });

// NOTE: the Stagehand page wrapper does not expose page.keyboard in all builds.
// If this errors, write text via stagehand_act("type 'X' into the Y field") which maps to fill.
server.tool("stagehand_type", {
  text: z.string().describe("text to type into the focused element"),
  pressEnter: z.boolean().optional().describe("press Enter afterwards"),
}, async ({ text, pressEnter }) => {
  await ensure(); const p = pg();
  await p.keyboard.type(text, { delay: 25 });
  if (pressEnter) await p.keyboard.press("Enter");
  await p.waitForTimeout(1000);
  return txt(`typed: "${text}"${pressEnter ? " + Enter" : ""}`);
});

server.tool("stagehand_screenshot", {}, async () => {
  await ensure();
  const buf = await pg().screenshot({ type: "png" });
  return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }] };
});

server.tool("stagehand_status", {}, async () => {
  if (!sh) return txt("Stagehand not initialized yet (no tool used).");
  const p = pg();
  return txt({ url: p.url(), title: await p.title() });
});

const transport = new StdioServerTransport();
await server.connect(transport);
log("stagehand-local-mcp connected (7 tools).");
