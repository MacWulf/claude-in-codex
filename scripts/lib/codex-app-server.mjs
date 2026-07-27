/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";

const CLIENT_INFO = {
  name: "claude-in-codex",
  version: "1.0.0",
};
const DEFAULT_TIMEOUT_MS = 15000;

export function resolveAppServerCommand() {
  const configuredExecutable = process.env.CC_PLUGIN_CODEX_EXECUTABLE;
  const executable = resolveCodexExecutable(configuredExecutable);
  const rawArgs = process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON;

  if (!rawArgs) {
    return { executable, args: ["app-server"] };
  }

  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch (error) {
    throw new Error(
      `Invalid CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new Error(
      "CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON must be a JSON array of strings."
    );
  }

  return { executable, args };
}

function resolveCodexExecutable(configuredExecutable) {
  if (!configuredExecutable || !path.isAbsolute(configuredExecutable)) {
    return configuredExecutable || "codex";
  }
  if (fs.existsSync(configuredExecutable)) {
    return configuredExecutable;
  }

  // Codex desktop injects a versioned executable path. App auto-updates remove
  // old version directories while the existing process still carries that path.
  // Its stable sibling launcher always resolves the currently installed build.
  const stableLauncher = path.join(
    path.dirname(path.dirname(configuredExecutable)),
    path.basename(configuredExecutable)
  );
  if (fs.existsSync(stableLauncher)) {
    return stableLauncher;
  }

  return "codex";
}

export async function callCodexAppServer({ cwd, method, params }) {
  const { executable, args } = resolveAppServerCommand();
  const timeoutMs = Number.parseInt(
    process.env.CC_PLUGIN_CODEX_APP_SERVER_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
    10
  );

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let settled = false;
    let stderr = "";
    const timeoutHandle = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          finish(
            rejectPromise,
            new Error(
              `${executable} app-server timed out waiting for ${method} after ${timeoutMs}ms`
            )
          );
        }, timeoutMs)
      : null;

    function cleanup() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      lines.close();
      child.stdin.end();
      if (!child.killed && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }

    function finish(handler, value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler(value);
    }

    function writeMessage(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.stdin.on("error", (error) => {
      finish(
        rejectPromise,
        new Error(`Failed to write to ${executable} app-server stdin: ${error.message}`)
      );
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish(
        rejectPromise,
        new Error(`Failed to start ${executable}: ${error.message}`)
      );
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      const suffix = stderr.trim() ? `\n${stderr.trim()}` : "";
      finish(
        rejectPromise,
        new Error(
          `${executable} app-server exited before responding to ${method} ` +
            `(code=${code}, signal=${signal})${suffix}`
        )
      );
    });

    lines.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        writeMessage({
          jsonrpc: "2.0",
          id: 2,
          method,
          params,
        });
        return;
      }

      if (message.id !== 2) {
        return;
      }

      if (message.error) {
        const suffix = stderr.trim() ? `\n${stderr.trim()}` : "";
        finish(
          rejectPromise,
          new Error(
            `Codex app-server ${method} failed: ${JSON.stringify(message.error)}${suffix}`
          )
        );
        return;
      }

      finish(resolvePromise, message.result);
    });

    writeMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: CLIENT_INFO,
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [],
        },
      },
    });
  });
}

export async function readCodexThread(cwd, threadId) {
  return callCodexAppServer({
    cwd,
    method: "thread/read",
    params: { threadId },
  });
}

export async function listCodexThreadItems(cwd, threadId) {
  return callCodexAppServer({
    cwd,
    method: "thread/items/list",
    params: { threadId },
  });
}
