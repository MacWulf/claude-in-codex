/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { resolvePluginDataRoot } from "./codex-paths.mjs";

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
export const MODELS_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const MODELS_CATALOG_TIMEOUT_MS = 5_000;
export const MODELS_CATALOG_MAX_BYTES = 100 * 1024;
export const MODELS_CATALOG_CACHE_FILE = "models-catalog.json";

const FALLBACK_MODELS = [
  { id: "opus", displayName: "Claude CLI latest Opus alias", source: "cli-alias" },
  { id: "sonnet", displayName: "Claude CLI latest Sonnet alias", source: "cli-alias" },
  { id: "haiku", displayName: "Claude CLI latest Haiku alias", source: "cli-alias" },
];

function resolveCacheFile(cacheFile) {
  return cacheFile ?? path.join(resolvePluginDataRoot(), MODELS_CATALOG_CACHE_FILE);
}

function normalizeModel(model) {
  if (!model || typeof model !== "object" || typeof model.id !== "string") {
    return null;
  }
  const id = model.id.trim();
  if (!id || id.length > 512) return null;
  return {
    id,
    displayName:
      typeof (model.display_name ?? model.displayName) === "string" &&
      (model.display_name ?? model.displayName).trim()
        ? (model.display_name ?? model.displayName).trim()
        : id,
    createdAt: typeof model.created_at === "string" ? model.created_at : null,
    type: typeof model.type === "string" ? model.type : "model",
  };
}

function normalizeModels(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  return payload.data.map(normalizeModel).filter(Boolean);
}

function buildFallbackCatalog(warning, now = Date.now()) {
  return {
    version: 1,
    source: "cli-alias-fallback",
    fetchedAt: new Date(now).toISOString(),
    models: FALLBACK_MODELS.map((model) => ({ ...model })),
    warning: warning ?? null,
  };
}

function validateCatalog(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.models)) {
    return null;
  }
  const models = value.models.map(normalizeModel).filter(Boolean);
  if (models.length === 0 || typeof value.fetchedAt !== "string") return null;
  return {
    version: 1,
    source: typeof value.source === "string" ? value.source : "cache",
    fetchedAt: value.fetchedAt,
    models,
    warning: typeof value.warning === "string" ? value.warning : null,
  };
}

function readCache(cacheFile) {
  try {
    if (fs.statSync(cacheFile).size > MODELS_CATALOG_MAX_BYTES) return null;
    return validateCatalog(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
  } catch {
    return null;
  }
}

function writeCache(cacheFile, catalog) {
  const parent = path.dirname(cacheFile);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tempFile = `${cacheFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(catalog)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempFile, cacheFile);
  try {
    fs.chmodSync(cacheFile, 0o600);
  } catch {}
}

function hasApiCredentials(env = process.env) {
  return Boolean(
    String(env.ANTHROPIC_API_KEY ?? "").trim() ||
      String(env.ANTHROPIC_AUTH_TOKEN ?? "").trim()
  );
}

export async function fetchModelsCatalog({
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = Date.now(),
  timeoutMs = MODELS_CATALOG_TIMEOUT_MS,
} = {}) {
  if (!hasApiCredentials(env)) {
    throw new Error("Anthropic API credentials are not configured.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime does not provide fetch().");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      accept: "application/json",
      "anthropic-version": "2023-06-01",
    };
    const apiKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
    const authToken = String(env.ANTHROPIC_AUTH_TOKEN ?? "").trim();
    if (apiKey) headers["x-api-key"] = apiKey;
    else headers.authorization = `Bearer ${authToken}`;

    const response = await fetchImpl(ANTHROPIC_MODELS_URL, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MODELS_CATALOG_MAX_BYTES) {
      throw new Error("Anthropic model catalog response is too large.");
    }
    if (!response.ok) {
      throw new Error(`Anthropic model catalog request failed (${response.status}).`);
    }
    const models = normalizeModels(JSON.parse(body));
    if (models.length === 0) {
      throw new Error("Anthropic model catalog response contained no models.");
    }
    return {
      version: 1,
      source: "api",
      fetchedAt: new Date(now).toISOString(),
      models,
      warning: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {{
 *   refresh?: boolean,
 *   cacheFile?: string,
 *   env?: NodeJS.ProcessEnv,
 *   now?: number,
 *   maxAgeMs?: number,
 *   fetchImpl?: typeof globalThis.fetch,
 * }} options
 */
export async function getModelsCatalog({
  refresh = false,
  cacheFile,
  env = process.env,
  now = Date.now(),
  maxAgeMs = MODELS_CATALOG_TTL_MS,
  fetchImpl,
} = {}) {
  const resolvedCacheFile = resolveCacheFile(cacheFile);
  const cached = readCache(resolvedCacheFile);
  const cacheAge = cached ? now - Date.parse(cached.fetchedAt) : Infinity;
  if (!refresh && cached && Number.isFinite(cacheAge) && cacheAge <= maxAgeMs) {
    return { ...cached, source: "cache", warning: null };
  }

  try {
    const fresh = await fetchModelsCatalog({ fetchImpl, env, now });
    // A read-only or otherwise unwritable cache must not hide a successful API response.
    try {
      writeCache(resolvedCacheFile, fresh);
    } catch {}
    return fresh;
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        source: "stale-cache",
        warning: error instanceof Error ? error.message : "Catalog refresh failed.",
      };
    }
    return buildFallbackCatalog(
      error instanceof Error ? error.message : "Catalog refresh failed.",
      now
    );
  }
}

export function renderModelsCatalog(catalog) {
  const lines = [
    "# Claude Models",
    `Source: ${catalog.source}`,
    "",
    "| Model | Display name |",
    "| --- | --- |",
    ...catalog.models.map((model) => `| ${model.id} | ${model.displayName} |`),
  ];
  if (catalog.warning) {
    lines.push("", `Notice: ${catalog.warning}`);
  }
  return `${lines.join("\n")}\n`;
}
