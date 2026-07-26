import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const SETUP_STATE_FILE = ".line-harness-setup.json";
export const INSTALLER_CONFIG_FILE = ".line-harness-config.json";

export interface SetupState {
  projectName?: string;
  lineChannelId?: string;
  lineLoginChannelId?: string;
  liffId?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  workerName?: string;
  accountId?: string;
  botBasicId?: string;
  workerUrl?: string;
  adminUrl?: string;
  adminProjectName?: string;
  completedSteps: string[];
}

export interface InstallerConfig {
  projectName?: string;
  workerName?: string;
  workerUrl?: string;
  adminUrl?: string;
  adminProjectName?: string;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  r2BucketName?: string;
  accountId?: string;
}

export interface WranglerConfigUpdates {
  name?: string;
  accountId?: string;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  r2BucketName?: string;
  assetsDirectory: string;
}

interface TomlSection {
  header: string | null;
  path: string;
  lines: string[];
}

const STATE_STRING_FIELDS = [
  "projectName",
  "lineChannelId",
  "lineLoginChannelId",
  "liffId",
  "d1DatabaseId",
  "d1DatabaseName",
  "r2BucketName",
  "workerName",
  "accountId",
  "botBasicId",
  "workerUrl",
  "adminUrl",
  "adminProjectName",
] as const;

// These steps consume values that are intentionally never persisted. A resumed
// setup obtains fresh credentials and rotates the API key/admin deployment.
const NON_RESUMABLE_SECRET_STEPS = new Set([
  "credentials",
  "secrets",
  "admin",
]);

function sanitizeSetupState(value: unknown): SetupState {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const state: SetupState = { completedSteps: [] };

  for (const field of STATE_STRING_FIELDS) {
    if (typeof input[field] === "string") {
      state[field] = input[field];
    }
  }

  if (Array.isArray(input.completedSteps)) {
    state.completedSteps = input.completedSteps.filter(
      (step): step is string =>
        typeof step === "string" && !NON_RESUMABLE_SECRET_STEPS.has(step),
    );
  }

  return state;
}

function writeSetupState(repoDir: string, state: SetupState): void {
  writeFileSync(
    join(repoDir, SETUP_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function loadSetupState(repoDir: string): SetupState {
  const path = join(repoDir, SETUP_STATE_FILE);
  if (!existsSync(path)) {
    return { completedSteps: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const sanitized = sanitizeSetupState(parsed);
    // Rewrite immediately so legacy plaintext values are removed even if the
    // resumed process exits before the next setup step.
    writeSetupState(repoDir, sanitized);
    return sanitized;
  } catch {
    return { completedSteps: [] };
  }
}

export function saveSetupState(repoDir: string, value: SetupState): void {
  writeSetupState(repoDir, sanitizeSetupState(value));
}

export function loadInstallerConfig(repoDir: string): InstallerConfig | null {
  const path = join(repoDir, INSTALLER_CONFIG_FILE);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const input = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const config: InstallerConfig = {};
    for (const field of [
      "projectName",
      "workerName",
      "workerUrl",
      "adminUrl",
      "adminProjectName",
      "d1DatabaseName",
      "d1DatabaseId",
      "r2BucketName",
      "accountId",
    ] as const) {
      if (typeof input[field] === "string") {
        config[field] = input[field];
      }
    }
    return config;
  } catch {
    return null;
  }
}

function parseTomlSections(content: string): TomlSection[] {
  const sections: TomlSection[] = [{ header: null, path: "", lines: [] }];

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*(\[\[?)([^\]]+)\]\]?\s*(?:#.*)?$/);
    if (match) {
      sections.push({
        header: line,
        path: match[2].trim(),
        lines: [],
      });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  return sections;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function setStringValue(
  section: TomlSection,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) return;
  const assignment = `${key} = ${tomlString(value)}`;
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  const index = section.lines.findIndex((line) => keyPattern.test(line));

  if (index >= 0) {
    const comment = section.lines[index].match(/\s+(#.*)$/)?.[1];
    section.lines[index] = comment ? `${assignment} ${comment}` : assignment;
    return;
  }

  while (
    section.lines.length > 0 &&
    section.lines[section.lines.length - 1] === ""
  ) {
    section.lines.pop();
  }
  section.lines.push(assignment);
}

function getOrCreateSection(
  sections: TomlSection[],
  header: string,
  path: string,
): TomlSection {
  const existing = sections.find((section) => section.path === path);
  if (existing) return existing;

  const section = { header, path, lines: [] };
  sections.push(section);
  return section;
}

function serializeTomlSections(sections: TomlSection[]): string {
  const chunks = sections
    .map((section) => {
      const body = section.lines.join("\n").replace(/\n+$/, "");
      return section.header === null
        ? body
        : `${section.header}${body ? `\n${body}` : ""}`;
    })
    .filter((chunk) => chunk.length > 0);
  return `${chunks.join("\n\n")}\n`;
}

export function updateWranglerConfig(
  content: string,
  updates: WranglerConfigUpdates,
): string {
  const sections = parseTomlSections(content);
  const root = sections[0];

  if (content.trim() === "") {
    root.lines = [
      `name = ${tomlString(updates.name ?? "line-harness")}`,
      'main = "src/index.ts"',
      'compatibility_date = "2024-12-01"',
      "workers_dev = true",
    ];
  }

  setStringValue(root, "name", updates.name);
  setStringValue(root, "account_id", updates.accountId);

  const assets = getOrCreateSection(sections, "[assets]", "assets");
  setStringValue(assets, "directory", updates.assetsDirectory);
  if (!assets.lines.some((line) => /^\s*binding\s*=/.test(line))) {
    setStringValue(assets, "binding", "ASSETS");
  }

  const d1 = getOrCreateSection(
    sections,
    "[[d1_databases]]",
    "d1_databases",
  );
  if (!d1.lines.some((line) => /^\s*binding\s*=/.test(line))) {
    setStringValue(d1, "binding", "DB");
  }
  setStringValue(d1, "database_name", updates.d1DatabaseName);
  setStringValue(d1, "database_id", updates.d1DatabaseId);

  if (updates.r2BucketName !== undefined) {
    const r2 = getOrCreateSection(
      sections,
      "[[r2_buckets]]",
      "r2_buckets",
    );
    if (!r2.lines.some((line) => /^\s*binding\s*=/.test(line))) {
      setStringValue(r2, "binding", "IMAGES");
    }
    setStringValue(r2, "bucket_name", updates.r2BucketName);
  }

  return serializeTomlSections(sections);
}

export interface DeployConfig {
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineLoginChannelId: string;
  apiKey: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  workerUrl: string;
  adminProjectName: string;
  adminUrl: string;
  liffProjectName: string;
  liffUrl: string;
}
