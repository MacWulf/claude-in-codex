/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTHROPIC_MODELS_URL,
  MODELS_CATALOG_TTL_MS,
  fetchModelsCatalog,
  getModelsCatalog,
  renderModelsCatalog,
} from "../scripts/lib/models-catalog.mjs";

function tempCacheFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-models-"));
  return {
    file: path.join(directory, "models-catalog.json"),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function fakeResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

const apiPayload = {
  data: [
    {
      type: "model",
      id: "claude-future-1",
      display_name: "Claude Future 1",
      created_at: "2026-07-11T00:00:00Z",
    },
  ],
};

test("fetchModelsCatalog normalizes the Anthropic Models API response", async () => {
  let request;
  const catalog = await fetchModelsCatalog({
    env: { ANTHROPIC_API_KEY: "test-key" },
    now: Date.parse("2026-07-11T00:00:00Z"),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return fakeResponse(apiPayload);
    },
  });

  assert.equal(request.url, ANTHROPIC_MODELS_URL);
  assert.equal(request.options.headers["x-api-key"], "test-key");
  assert.deepEqual(catalog.models[0], {
    id: "claude-future-1",
    displayName: "Claude Future 1",
    createdAt: "2026-07-11T00:00:00Z",
    type: "model",
  });
  assert.equal(catalog.source, "api");
});

test("getModelsCatalog caches successful API results", async (t) => {
  const cache = tempCacheFile();
  t.after(cache.cleanup);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(apiPayload);
  };
  const now = Date.parse("2026-07-11T00:00:00Z");

  const first = await getModelsCatalog({
    cacheFile: cache.file,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl,
    now,
  });
  const second = await getModelsCatalog({
    cacheFile: cache.file,
    env: {},
    fetchImpl: async () => {
      throw new Error("network should not be called for a fresh cache");
    },
    now: now + 60_000,
  });

  assert.equal(first.source, "api");
  assert.equal(second.source, "cache");
  assert.equal(calls, 1);
});

test("refresh bypasses the cache", async (t) => {
  const cache = tempCacheFile();
  t.after(cache.cleanup);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(apiPayload);
  };
  const now = Date.parse("2026-07-11T00:00:00Z");

  await getModelsCatalog({
    cacheFile: cache.file,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl,
    now,
  });
  await getModelsCatalog({
    cacheFile: cache.file,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl,
    now: now + 60_000,
    refresh: true,
  });

  assert.equal(calls, 2);
});

test("missing credentials degrade to CLI aliases without a network call", async () => {
  const catalog = await getModelsCatalog({
    cacheFile: path.join(os.tmpdir(), `cc-models-missing-${process.pid}.json`),
    env: {},
    fetchImpl: async () => {
      throw new Error("network should not be called without credentials");
    },
  });

  assert.equal(catalog.source, "cli-alias-fallback");
  assert.deepEqual(catalog.models.map((model) => model.id), ["opus", "sonnet", "haiku"]);
});

test("stale cache is returned when refresh fails", async (t) => {
  const cache = tempCacheFile();
  t.after(cache.cleanup);
  const now = Date.parse("2026-07-11T00:00:00Z");

  await getModelsCatalog({
    cacheFile: cache.file,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => fakeResponse(apiPayload),
    now,
  });
  const stale = await getModelsCatalog({
    cacheFile: cache.file,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => {
      throw new Error("service unavailable");
    },
    now: now + MODELS_CATALOG_TTL_MS + 1,
  });

  assert.equal(stale.source, "stale-cache");
  assert.match(stale.warning, /service unavailable/);
});

test("renderModelsCatalog produces a compact human-readable table", () => {
  const output = renderModelsCatalog({
    source: "api",
    models: [{ id: "claude-future-1", displayName: "Claude Future 1" }],
    warning: null,
  });
  assert.match(output, /Claude Models/);
  assert.match(output, /claude-future-1/);
});
