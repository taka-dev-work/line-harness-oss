import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSetupState,
  saveSetupState,
  updateWranglerConfig,
} from "./config.js";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "line-harness-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("updateWranglerConfig", () => {
  it("always gives the default assets section a real directory", () => {
    const result = updateWranglerConfig("", {
      name: "customer-worker",
      accountId: "account-123",
      d1DatabaseName: "customer-db",
      d1DatabaseId: "database-123",
      assetsDirectory: "dist/client",
    });

    expect(result).toContain('[assets]\ndirectory = "dist/client"');
  });

  it("preserves existing deployment IDs, worker name, and environment-specific values", () => {
    const existing = `name = "customer-worker"
account_id = "account-123"

[assets]
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "customer-db"
database_id = "database-123"

[env.production]
name = "production-worker"
account_id = "production-account"

[env.production.vars]
CUSTOMER_SETTING = "keep-me"

[[env.production.d1_databases]]
binding = "DB"
database_name = "production-db"
database_id = "production-database"
`;

    const result = updateWranglerConfig(existing, {
      assetsDirectory: "dist/client",
    });

    expect(result).toContain('name = "customer-worker"');
    expect(result).toContain('account_id = "account-123"');
    expect(result).toContain('database_name = "customer-db"');
    expect(result).toContain('database_id = "database-123"');
    expect(result).toContain('name = "production-worker"');
    expect(result).toContain('account_id = "production-account"');
    expect(result).toContain('CUSTOMER_SETTING = "keep-me"');
    expect(result).toContain('database_id = "production-database"');
  });
});

describe("setup state", () => {
  it("removes secrets and serialized configuration from legacy state on load", () => {
    const repoDir = makeTemporaryDirectory();
    const statePath = join(repoDir, ".line-harness-setup.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        projectName: "customer-project",
        accountId: "account-123",
        d1DatabaseId: "database-123",
        apiKey: "api-secret",
        lineChannelAccessToken: "line-access-secret",
        lineChannelSecret: "line-channel-secret",
        originalWranglerToml: 'API_KEY = "serialized-secret"',
        completedSteps: ["database", "credentials", "secrets"],
      }),
    );

    const state = loadSetupState(repoDir);
    const persisted = readFileSync(statePath, "utf8");

    expect(state).toMatchObject({
      projectName: "customer-project",
      accountId: "account-123",
      d1DatabaseId: "database-123",
      completedSteps: ["database"],
    });
    expect(persisted).not.toContain("api-secret");
    expect(persisted).not.toContain("line-access-secret");
    expect(persisted).not.toContain("line-channel-secret");
    expect(persisted).not.toContain("serialized-secret");
  });

  it("never writes secret-looking runtime fields", () => {
    const repoDir = makeTemporaryDirectory();

    saveSetupState(repoDir, {
      projectName: "customer-project",
      accountId: "account-123",
      completedSteps: ["database"],
      apiKey: "api-secret",
      lineChannelAccessToken: "line-access-secret",
      lineChannelSecret: "line-channel-secret",
      originalWranglerToml: 'API_KEY = "serialized-secret"',
    } as never);

    const persisted = readFileSync(
      join(repoDir, ".line-harness-setup.json"),
      "utf8",
    );
    expect(persisted).toContain("customer-project");
    expect(persisted).toContain("account-123");
    expect(persisted).not.toMatch(
      /api-secret|line-access-secret|line-channel-secret|serialized-secret/,
    );
  });

  it("keeps the setup state path ignored by Git", () => {
    const packageDirectory = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(packageDirectory, "../../../..");

    expect(() =>
      execFileSync(
        "git",
        ["check-ignore", "--no-index", ".line-harness-setup.json"],
        { cwd: repoRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
