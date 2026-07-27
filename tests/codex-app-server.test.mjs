/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAppServerCommand } from "../scripts/lib/codex-app-server.mjs";

const originalExecutable = process.env.CC_PLUGIN_CODEX_EXECUTABLE;
const originalArgs = process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON;

function restoreEnvironment() {
  if (originalExecutable === undefined) {
    delete process.env.CC_PLUGIN_CODEX_EXECUTABLE;
  } else {
    process.env.CC_PLUGIN_CODEX_EXECUTABLE = originalExecutable;
  }
  if (originalArgs === undefined) {
    delete process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON;
  } else {
    process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON = originalArgs;
  }
}

afterEach(restoreEnvironment);

describe("resolveAppServerCommand", () => {
  it("uses Codex stable launcher when injected versioned path disappeared after update", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-codex-app-server-"));
    const stableLauncher = path.join(root, "bin", "codex.exe");
    const staleLauncher = path.join(root, "bin", "removed-build", "codex.exe");
    fs.mkdirSync(path.dirname(stableLauncher), { recursive: true });
    fs.writeFileSync(stableLauncher, "fixture", "utf8");
    process.env.CC_PLUGIN_CODEX_EXECUTABLE = staleLauncher;
    delete process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON;

    assert.deepEqual(resolveAppServerCommand(), {
      executable: stableLauncher,
      args: ["app-server"],
    });

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses command fallback when configured and stable launchers are both unavailable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-codex-app-server-"));
    process.env.CC_PLUGIN_CODEX_EXECUTABLE = path.join(root, "bin", "removed-build", "codex.exe");
    delete process.env.CC_PLUGIN_CODEX_APP_SERVER_ARGS_JSON;

    assert.deepEqual(resolveAppServerCommand(), {
      executable: "codex",
      args: ["app-server"],
    });

    fs.rmSync(root, { recursive: true, force: true });
  });
});
