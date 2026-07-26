import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface SqliteColumn {
  name: string;
}

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, "../../../..");
const schemaPath = join(repoRoot, "packages/db/schema.sql");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "line-harness-schema-"));
const databasePath = join(temporaryDirectory, "schema.sqlite");

function queryJson<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
  });
  return output ? (JSON.parse(output) as T[]) : [];
}

function columnsFor(table: string): string[] {
  return queryJson<SqliteColumn>(`PRAGMA table_info("${table}")`).map(
    ({ name }) => name,
  );
}

beforeAll(() => {
  execFileSync("sqlite3", [databasePath], {
    input: readFileSync(schemaPath),
    stdio: ["pipe", "pipe", "pipe"],
  });
});

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("production schema parity", () => {
  it("initializes the current concierge-ready baseline tables", () => {
    const tables = queryJson<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).map(({ name }) => name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "friends",
        "line_accounts",
        "entry_routes",
        "ref_tracking",
        "tracked_links",
        "link_clicks",
        "forms",
        "form_submissions",
        "form_opens",
        "traffic_pools",
        "account_settings",
        "booking_services",
        "booking_slots",
        "bookings",
        "booking_reminders",
        "diagnosis_form_config",
        "diagnosis_questions",
        "diagnosis_configs",
        "diagnosis_results",
        "broadcasts",
        "broadcast_deliveries",
        "messages_log",
      ]),
    );
  });

  it.each([
    ["friends", ["ref_code", "metadata", "line_account_id", "first_tracked_link_id"]],
    ["scenario_steps", ["condition_type", "condition_value", "next_step_on_false"]],
    [
      "line_accounts",
      [
        "login_channel_id",
        "login_channel_secret",
        "liff_id",
        "token_expires_at",
      ],
    ],
    [
      "broadcasts",
      [
        "alt_text",
        "queue_locked_at",
        "queue_lease_token",
        "audience_cursor",
        "audience_materialized_at",
      ],
    ],
    ["messages_log", ["delivery_type", "source", "broadcast_delivery_id"]],
    [
      "forms",
      [
        "on_submit_message_type",
        "on_submit_message_content",
        "on_submit_webhook_url",
        "on_submit_webhook_headers",
        "on_submit_webhook_fail_message",
      ],
    ],
  ])("contains current columns used by %s", (table, expectedColumns) => {
    expect(columnsFor(table)).toEqual(expect.arrayContaining(expectedColumns));
  });
});
