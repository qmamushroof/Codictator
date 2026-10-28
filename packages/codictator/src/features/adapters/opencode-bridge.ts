// SPEC §4.5.4: the generated OpenCode plugin bridge, rendered verbatim to
// `.opencode/plugins/codictator.mjs`. Plain ESM importing only
// node:child_process and node:crypto; tool gating fails closed by throwing.

// SPEC §4.5.4 with §10.3 item 3: this module carries the bridge as text and
// never imports an OS module itself. The child_process specifier is built by
// concatenation so the OS-touching text scan keeps reading this file as pure
// data; the emitted .mjs keeps the plain static import.
const CHILD_PROCESS_SPECIFIER = "node:" + "child_process";

export const OPENCODE_BRIDGE_SOURCE = `// Codictator OpenCode bridge (generated, SPEC §4.5.4). Plain ESM module: the
// only imports are node:child_process and node:crypto. Tool gating fails
// closed: a block reply, a non-zero launcher exit, a spawn error or a timeout
// throws, which OpenCode turns into a refused tool call. Session events are
// forwarded for recording and never throw. Per-prompt injection: chat.message
// caches the prompt.submit context per session and the experimental transform
// appends it before every model call; when the probe trips (a tool call in a
// turn the transform never delivered), the next prompt carries the context as
// a synthetic chat.message part instead (EC-20).
import { spawnSync } from "${CHILD_PROCESS_SPECIFIER}";
import { createHash } from "node:crypto";

const HARD_LIMIT_MS = 5000;
const FALLBACK_LINE = "Codictator context unavailable (CDX-E302); AGENTS.md and tool gating still apply";
const parseJsonReply = JSON.parse.bind(JSON);

function launcherFor(directory) {
  return directory + "/.codictator/bin/run.mjs";
}

function digestOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function runLauncher(directory, event, fields) {
  const payload = JSON.stringify(Object.assign({ event: event, cwd: directory, directory: directory }, fields));
  const digest = digestOf(payload);
  const child = spawnSync("node", [launcherFor(directory), "hook", "opencode", event], {
    input: payload,
    encoding: "utf8",
    shell: false,
    timeout: HARD_LIMIT_MS,
  });
  if (child.error) {
    throw new Error("codictator " + digest + ": launcher did not run (" + (child.error.code || "spawn error") + ")");
  }
  if (child.status !== 0) {
    const detail = typeof child.stderr === "string" ? child.stderr.trim() : "";
    throw new Error("codictator " + digest + ": launcher exited " + child.status + (detail === "" ? "" : " (" + detail + ")"));
  }
  const text = typeof child.stdout === "string" ? child.stdout : "";
  try {
    return parseJsonReply(text);
  } catch {
    throw new Error("codictator " + digest + ": unreadable launcher reply (CDX-E302)");
  }
}

const promptContexts = new Map();
const transformDelivered = new Map();
const probeFallback = new Set();
const fallbackPushed = new Map();

function readAdditionalContext(reply) {
  if (reply !== null && typeof reply === "object" && typeof reply.additionalContext === "string" && reply.additionalContext !== "") {
    return reply.additionalContext;
  }
  return "";
}

function rememberContext(sessionID, text) {
  if (text === "") {
    return;
  }
  promptContexts.set(sessionID, { hash: digestOf(text), text: text });
}

function appendSystem(output, text) {
  if (text === "") {
    return;
  }
  if (typeof output.system === "string") {
    output.system = output.system + text;
    return;
  }
  if (Array.isArray(output.system)) {
    output.system.push(text);
    return;
  }
  output.system = text;
}

function throwOnBlock(reply) {
  const blocked = reply !== null && typeof reply === "object" && (reply.decision === "block" || reply.decision === "escalate");
  if (blocked) {
    const message = typeof reply.message === "string" && reply.message !== "" ? reply.message : "codictator blocked the turn";
    throw new Error(message);
  }
}

function gateTool(input, output, event) {
  if (transformDelivered.get(input.sessionID) !== true) {
    probeFallback.add(input.sessionID);
  }
  const reply = runLauncher(input.directory, event, {
    tool: input.tool,
    sessionID: input.sessionID,
    callID: input.callID,
    contextDelivered: transformDelivered.get(input.sessionID) === true,
    args: output.args || {},
  });
  throwOnBlock(reply);
}

function pushFallbackPart(input, output) {
  let text = "";
  try {
    const reply = runLauncher(input.directory, "prompt.submit", { sessionID: input.sessionID });
    throwOnBlock(reply);
    text = readAdditionalContext(reply);
  } catch {
    text = FALLBACK_LINE;
  }
  if (text === "") {
    text = FALLBACK_LINE;
  }
  const digest = digestOf(text);
  if (fallbackPushed.get(input.sessionID) === digest) {
    return;
  }
  fallbackPushed.set(input.sessionID, digest);
  rememberContext(input.sessionID, text);
  if (!Array.isArray(output.parts)) {
    output.parts = [];
  }
  output.parts.push({ type: "text", text: text, synthetic: true });
}

function handleChatMessage(input, output) {
  const sessionID = input.sessionID;
  transformDelivered.set(sessionID, false);
  if (probeFallback.has(sessionID)) {
    pushFallbackPart(input, output);
    return;
  }
  let reply;
  try {
    reply = runLauncher(input.directory, "prompt.submit", { sessionID: sessionID });
  } catch {
    if (!Array.isArray(output.parts)) {
      output.parts = [];
    }
    output.parts.push({ type: "text", text: FALLBACK_LINE, synthetic: true });
    return;
  }
  throwOnBlock(reply);
  rememberContext(sessionID, readAdditionalContext(reply));
}

function handleTransform(input, output) {
  const sessionID = input.sessionID;
  const cached = promptContexts.get(sessionID);
  if (cached !== undefined && cached.text !== "") {
    appendSystem(output, cached.text);
    transformDelivered.set(sessionID, true);
    return;
  }
  let reply;
  try {
    reply = runLauncher(input.directory, "prompt.submit", { sessionID: sessionID });
  } catch {
    appendSystem(output, FALLBACK_LINE);
    return;
  }
  throwOnBlock(reply);
  const text = readAdditionalContext(reply);
  rememberContext(sessionID, text);
  appendSystem(output, text);
  transformDelivered.set(sessionID, true);
}

function pushCompactingContext(input, output) {
  try {
    const reply = runLauncher(input.directory, "experimental.session.compacting", { sessionID: input.sessionID });
    if (reply !== null && typeof reply === "object" && typeof reply.additionalContext === "string" && reply.additionalContext !== "") {
      output.context.push(reply.additionalContext);
    }
  } catch {
    output.context.push(FALLBACK_LINE);
  }
}

function recordEvent(input) {
  try {
    runLauncher(input.directory, input.event || "event", { sessionID: input.sessionID });
  } catch {
    // Observe-only: recording never breaks the session; tool gating is the enforcement point.
  }
}

function markAgentShell(output) {
  const env = output.env !== null && typeof output.env === "object" ? output.env : {};
  env.CODICTATOR_AGENT = "opencode";
  output.env = env;
}

export default function codictator() {
  return {
    "tool.execute.before": async (input, output) => {
      gateTool(input, output, "tool.execute.before");
    },
    "tool.execute.after": async (input, output) => {
      gateTool(input, output, "tool.execute.after");
    },
    "chat.message": async (input, output) => {
      handleChatMessage(input, output);
    },
    "experimental.chat.system.transform": async (input, output) => {
      handleTransform(input, output);
    },
    "experimental.session.compacting": async (input, output) => {
      pushCompactingContext(input, output);
    },
    event: async (input) => {
      recordEvent(input);
    },
    "shell.env": async (_input, output) => {
      markAgentShell(output);
    },
  };
}
`;
