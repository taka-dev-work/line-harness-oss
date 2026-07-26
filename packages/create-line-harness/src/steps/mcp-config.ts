import * as p from "@clack/prompts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
  mcpJsonPath?: string;
}

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

function normalizeWorkerUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function getMcpJsonPath(options: McpConfigOptions): string {
  return options.mcpJsonPath ?? join(process.cwd(), ".mcp.json");
}

function readMcpConfig(path: string): McpConfig | null {
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as McpConfig)
      : null;
  } catch {
    return null;
  }
}

function createServerConfig(
  options: McpConfigOptions,
  existing?: McpServerConfig,
): McpServerConfig {
  return {
    ...existing,
    command: "npx",
    args: ["-y", "@line-harness/mcp-server@latest"],
    env: {
      ...existing?.env,
      LINE_HARNESS_API_URL: normalizeWorkerUrl(options.workerUrl),
      LINE_HARNESS_API_KEY: options.apiKey,
    },
  };
}

function matchingServerNames(
  servers: Record<string, McpServerConfig>,
  workerUrl: string,
): string[] {
  const normalizedWorkerUrl = normalizeWorkerUrl(workerUrl);
  return Object.entries(servers)
    .filter(
      ([, server]) =>
        server.command === "npx" &&
        server.args?.some(
          (arg) =>
            arg === "@line-harness/mcp-server" ||
            arg.startsWith("@line-harness/mcp-server@"),
        ) === true &&
        typeof server.env?.LINE_HARNESS_API_URL === "string" &&
        normalizeWorkerUrl(server.env.LINE_HARNESS_API_URL) ===
          normalizedWorkerUrl,
    )
    .map(([name]) => name)
    .sort();
}

export function refreshExistingMcpConfig(
  options: McpConfigOptions,
): boolean {
  const mcpJsonPath = getMcpJsonPath(options);
  const mcpConfig = readMcpConfig(mcpJsonPath);
  const servers = mcpConfig?.mcpServers;
  if (!mcpConfig || !servers) return false;

  const matches = matchingServerNames(servers, options.workerUrl);
  if (matches.length === 0) return false;

  const serverName = matches.includes("line-harness")
    ? "line-harness"
    : matches[0];
  servers[serverName] = createServerConfig(options, servers[serverName]);
  for (const duplicateName of matches) {
    if (duplicateName !== serverName) {
      delete servers[duplicateName];
    }
  }

  writeFileSync(mcpJsonPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
  p.log.success(`.mcp.json の MCP 設定を更新しました（${serverName}）`);
  return true;
}

export function generateMcpConfig(options: McpConfigOptions): void {
  if (refreshExistingMcpConfig(options)) return;

  const mcpJsonPath = getMcpJsonPath(options);
  const mcpConfig = readMcpConfig(mcpJsonPath) ?? {};
  const servers = mcpConfig.mcpServers ?? {};
  mcpConfig.mcpServers = servers;

  let serverName = "line-harness";
  if (servers[serverName]) {
    const suffix = createHash("sha256")
      .update(normalizeWorkerUrl(options.workerUrl))
      .digest("hex")
      .slice(0, 12);
    serverName = `line-harness-${suffix}`;
  }

  servers[serverName] = createServerConfig(options);
  writeFileSync(mcpJsonPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
  p.log.success(`.mcp.json に MCP 設定を追加しました（${serverName}）`);
}
