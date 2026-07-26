import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface SqliteColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteIndex {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SqliteIndexColumn {
  seqno: number;
  name: string;
}

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, "../../../..");
const schemaPath = join(repoRoot, "packages/db/schema.sql");
const migration029Path = join(
  repoRoot,
  "packages/db/migrations/029_booking_diagnosis.sql",
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "line-harness-schema-"));
const databasePath = join(temporaryDirectory, "schema.sqlite");
const migration029DatabasePath = join(
  temporaryDirectory,
  "migration-029.sqlite",
);

function queryJson<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database, sql], {
    encoding: "utf8",
  });
  return output ? (JSON.parse(output) as T[]) : [];
}

function columnsFor(database: string, table: string): SqliteColumn[] {
  return queryJson<SqliteColumn>(
    database,
    `PRAGMA table_info("${table}")`,
  );
}

function indexesFor(
  database: string,
  table: string,
): Array<SqliteIndex & { columns: string[] }> {
  return queryJson<SqliteIndex>(
    database,
    `PRAGMA index_list("${table}")`,
  )
    .map((index) => ({
      ...index,
      columns: queryJson<SqliteIndexColumn>(
        database,
        `PRAGMA index_info("${index.name}")`,
      )
        .sort((left, right) => left.seqno - right.seqno)
        .map(({ name }) => name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

beforeAll(() => {
  execFileSync("sqlite3", [databasePath], {
    input: readFileSync(schemaPath),
    stdio: ["pipe", "pipe", "pipe"],
  });
  execFileSync("sqlite3", [migration029DatabasePath], {
    input: readFileSync(migration029Path),
    stdio: ["pipe", "pipe", "pipe"],
  });
});

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("production schema parity", () => {
  it("initializes the current concierge-ready baseline tables", () => {
    const tables = queryJson<{ name: string }>(
      databasePath,
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
    expect(columnsFor(databasePath, table).map(({ name }) => name)).toEqual(
      expect.arrayContaining(expectedColumns),
    );
  });

  it.each([
    "booking_services",
    "booking_staff",
    "booking_courses",
    "booking_slots",
    "booking_availability",
    "bookings",
    "booking_reminders",
    "diagnosis_form_config",
    "diagnosis_questions",
    "diagnosis_configs",
    "diagnosis_results",
  ])("matches migration 029 metadata and indexes for %s", (table) => {
    expect(columnsFor(databasePath, table)).toEqual(
      columnsFor(migration029DatabasePath, table),
    );
    expect(indexesFor(databasePath, table)).toEqual(
      indexesFor(migration029DatabasePath, table),
    );
  });

  it("does not add booking timestamp defaults absent from migration 029", () => {
    const timestampDefaults = [
      ["booking_services", "created_at"],
      ["booking_services", "updated_at"],
      ["booking_staff", "created_at"],
      ["booking_courses", "created_at"],
      ["booking_slots", "created_at"],
      ["booking_availability", "created_at"],
      ["bookings", "created_at"],
      ["bookings", "updated_at"],
      ["booking_reminders", "created_at"],
    ].map(([table, column]) => {
      const metadata = columnsFor(databasePath, table).find(
        ({ name }) => name === column,
      );
      return [table, column, metadata?.dflt_value];
    });

    expect(timestampDefaults).toEqual([
      ["booking_services", "created_at", null],
      ["booking_services", "updated_at", null],
      ["booking_staff", "created_at", null],
      ["booking_courses", "created_at", null],
      ["booking_slots", "created_at", null],
      ["booking_availability", "created_at", null],
      ["bookings", "created_at", null],
      ["bookings", "updated_at", null],
      ["booking_reminders", "created_at", null],
    ]);
  });
});
