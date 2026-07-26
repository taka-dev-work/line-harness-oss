import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ensureAuth } from "../steps/auth.js";
import {
  loadInstallerConfig,
  updateWranglerConfig,
} from "../lib/config.js";
import { setAccountId, wrangler } from "../lib/wrangler.js";
import { execa } from "execa";

export async function runUpdate(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness アップデート ")));

  // Load saved config or ask for project name
  const savedState = loadInstallerConfig(repoDir);
  let projectName: string;

  if (savedState?.projectName) {
    projectName = savedState.projectName;
    p.log.success(`プロジェクト名: ${projectName}`);
  } else {
    const name = await p.text({
      message: "プロジェクト名（setup 時に指定した名前）",
      placeholder: "line-harness",
      defaultValue: "line-harness",
    });
    if (p.isCancel(name)) {
      p.cancel("アップデートをキャンセルしました");
      process.exit(0);
    }
    projectName = (name as string).trim() || "line-harness";
  }

  await ensureAuth();
  if (savedState?.accountId) {
    setAccountId(savedState.accountId);
  }

  const s = p.spinner();

  // Run pending migrations
  s.start("マイグレーション確認中...");
  try {
    await wrangler(
      [
        "d1",
        "migrations",
        "apply",
        savedState?.d1DatabaseName ?? projectName,
        "--remote",
      ],
      { cwd: join(repoDir, "packages/db") },
    );
    s.stop("マイグレーション完了");
  } catch {
    s.stop("マイグレーション完了（変更なし）");
  }

  // Redeploy Worker
  s.start("Worker 再デプロイ中...");
  const workerDir = join(repoDir, "apps/worker");
  const tomlPath = join(workerDir, "wrangler.toml");
  const originalToml = existsSync(tomlPath)
    ? readFileSync(tomlPath, "utf8")
    : null;
  const deployToml = updateWranglerConfig(originalToml ?? "", {
    name: savedState?.workerName ?? projectName,
    accountId: savedState?.accountId,
    d1DatabaseName: savedState?.d1DatabaseName,
    d1DatabaseId: savedState?.d1DatabaseId,
    r2BucketName: savedState?.r2BucketName,
    assetsDirectory: "dist/client",
  });
  writeFileSync(tomlPath, deployToml);
  try {
    await wrangler(
      ["deploy", "--name", savedState?.workerName ?? projectName],
      { cwd: workerDir },
    );
  } finally {
    if (originalToml === null) {
      unlinkSync(tomlPath);
    } else {
      writeFileSync(tomlPath, originalToml);
    }
  }
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
  const adminProjectName = savedState?.adminProjectName ?? (savedState?.adminUrl
    ? new URL(savedState.adminUrl as string).hostname.replace(".pages.dev", "")
    : `${projectName}-admin`);
  s.start("Admin UI 再デプロイ中...");
  const webDir = join(repoDir, "apps/web");
  await execa("pnpm", ["run", "build"], { cwd: webDir });
  await wrangler(
    ["pages", "deploy", "out", "--project-name", adminProjectName],
    { cwd: webDir },
  );
  s.stop("Admin UI 再デプロイ完了");

  p.outro(pc.green("アップデート完了！"));
}
