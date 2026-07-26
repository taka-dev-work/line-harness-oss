import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshExistingMcpConfig } from "./mcp-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("refreshExistingMcpConfig", () => {
  it("updates and deduplicates the existing entry for the resumed Worker", () => {
    const directory = mkdtempSync(join(tmpdir(), "line-harness-mcp-"));
    temporaryDirectories.push(directory);
    const mcpJsonPath = join(directory, ".mcp.json");
    const workerUrl = "https://customer-worker.example.workers.dev";
    writeFileSync(
      mcpJsonPath,
      JSON.stringify({
        mcpServers: {
          "line-harness": {
            command: "npx",
            args: ["-y", "@line-harness/mcp-server@latest"],
            env: {
              LINE_HARNESS_API_URL: workerUrl,
              LINE_HARNESS_API_KEY: "old-key",
            },
          },
          "line-harness-old-key": {
            command: "npx",
            args: ["-y", "@line-harness/mcp-server@latest"],
            env: {
              LINE_HARNESS_API_URL: workerUrl,
              LINE_HARNESS_API_KEY: "duplicate-old-key",
            },
          },
          unrelated: {
            command: "other-command",
          },
          "same-worker-other-mcp": {
            command: "npx",
            args: ["-y", "@example/other-mcp"],
            env: {
              LINE_HARNESS_API_URL: workerUrl,
              LINE_HARNESS_API_KEY: "other-mcp-key",
            },
          },
        },
      }),
    );

    const refreshed = refreshExistingMcpConfig({
      workerUrl,
      apiKey: "current-key",
      mcpJsonPath,
    });
    const config = JSON.parse(readFileSync(mcpJsonPath, "utf8")) as {
      mcpServers: Record<
        string,
        {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        }
      >;
    };
    const matchingEntries = Object.entries(config.mcpServers).filter(
      ([, server]) =>
        server.command === "npx" &&
        server.args?.includes("@line-harness/mcp-server@latest") &&
        server.env?.LINE_HARNESS_API_URL === workerUrl,
    );

    expect(refreshed).toBe(true);
    expect(matchingEntries).toEqual([
      [
        "line-harness",
        expect.objectContaining({
          env: {
            LINE_HARNESS_API_URL: workerUrl,
            LINE_HARNESS_API_KEY: "current-key",
          },
        }),
      ],
    ]);
    expect(config.mcpServers.unrelated).toEqual({
      command: "other-command",
    });
    expect(config.mcpServers["same-worker-other-mcp"]).toEqual({
      command: "npx",
      args: ["-y", "@example/other-mcp"],
      env: {
        LINE_HARNESS_API_URL: workerUrl,
        LINE_HARNESS_API_KEY: "other-mcp-key",
      },
    });
  });
});
