# AI LINE CRM MCP Integration Plan

## Goal

Use MCP to simplify operator-side integrations with external tools while keeping production user flows reliable.

## Current Position

The app already has:

- Production Worker API
- LINE CRM database
- Booking services
- Google Calendar direct API integration
- Existing `packages/mcp-server` for operating LINE Harness through MCP clients

## Recommended Boundary

### Keep Direct API For Production Runtime

Use direct APIs inside the Cloudflare Worker for actions that must always work:

- Booking confirmation
- Google Calendar event creation
- Google Meet URL creation
- Booking cancellation
- LINE push/reply messages

Reason: these are customer-facing flows. They need predictable auth, retries, logs, and failure handling.

### Use MCP For Operator Workflows

Use MCP for human/AI-assisted administration:

- Ask for weekly CRM summaries
- Find high-intent leads
- Create booking slots by natural language
- Draft broadcast messages
- Create or update scenarios
- Check Google Calendar sync status
- Analyze route/source performance

## Phase 1: MCP Client Setup

Create `.mcp.json` from `.mcp.example.json`.

```bash
cp .mcp.example.json .mcp.json
```

Then replace:

```text
YOUR_PRODUCTION_API_KEY
```

with the production admin API key.

## Phase 2: Add Booking MCP Tools

Add tools to `packages/mcp-server`:

- `list_booking_services`
- `list_booking_slots`
- `generate_booking_slots`
- `list_bookings`
- `update_booking_service_google_settings`
- `check_google_calendar_sync`

## Phase 3: Add Customer Analysis MCP Tools

Add tools:

- `analyze_line_customers`
- `list_hot_leads`
- `analyze_entry_routes`
- `analyze_diagnosis_results`
- `recommend_next_actions`

## Phase 4: External Tool MCP Servers

External MCP servers can be connected to the same MCP client for operator workflows.

Examples:

- Google Calendar MCP server
- Google Workspace MCP server
- Notion MCP server
- Slack MCP server

Important: use trusted or self-hosted MCP servers only. Do not let an unverified third-party MCP server handle production secrets or customer data.

## Security Rules

- Never put `.mcp.json` into git.
- Use `.mcp.example.json` for templates only.
- Keep production write operations behind confirmation.
- Separate read-only tools from send/write tools.
- Do not use MCP as the only path for customer-facing booking confirmation.

## Final Architecture

```text
MCP Client
  |
  |-- ai-line-crm MCP server
  |     |
  |     +-- Worker API
  |          |
  |          +-- D1 / LINE / Google Calendar direct APIs
  |
  |-- Google Calendar MCP server
  |-- Notion MCP server
  |-- Slack MCP server
```

This keeps the CRM reliable for users and flexible for operators.
