import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

async function apiCall(path: string, method = "GET", body?: unknown) {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

export function registerManageBookings(server: McpServer): void {
  server.tool(
    "manage_bookings",
    "予約管理を操作します。AI個別相談、AI講座、AI勉強会などの予約サービス確認、予約枠生成、予約一覧確認、Google Calendar設定更新ができます。",
    {
      action: z
        .enum(["list_services", "list_slots", "generate_slots", "list_bookings", "update_google_settings"])
        .describe("Action to perform"),
      serviceId: z.string().optional().describe("Booking service ID"),
      serviceSlug: z.string().optional().describe("Booking service slug, e.g. ai-consultation, ai-course, ai-workshop"),
      dateFrom: z.string().optional().describe("Start date for generating slots, YYYY-MM-DD"),
      dateTo: z.string().optional().describe("End date for generating slots, YYYY-MM-DD"),
      startTime: z.string().optional().describe("Daily start time, HH:MM"),
      endTime: z.string().optional().describe("Daily end time, HH:MM"),
      intervalMinutes: z.number().optional().describe("Slot length in minutes, e.g. 30, 60, 90"),
      capacity: z.number().optional().describe("Capacity per slot"),
      daysOfWeek: z.array(z.number().min(0).max(6)).optional().describe("0=Sunday ... 6=Saturday"),
      googleCalendarId: z.string().nullable().optional().describe("Google Calendar ID. Null or empty uses the Worker default"),
      enableGoogleMeet: z.boolean().optional().describe("Whether to create Google Meet URL on confirmed bookings"),
    },
    async (input) => {
      try {
        if (input.action === "list_services") {
          const data = await apiCall("/api/booking/services");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        let serviceId = input.serviceId;
        if (!serviceId && input.serviceSlug) {
          const services = await apiCall("/api/booking/services") as { data?: Array<{ id: string; slug: string }> };
          serviceId = services.data?.find((service) => service.slug === input.serviceSlug)?.id;
        }
        if (!serviceId) throw new Error("serviceId or serviceSlug is required for this action");

        if (input.action === "list_slots") {
          const data = await apiCall(`/api/booking/slots${query({ serviceId })}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (input.action === "list_bookings") {
          const data = await apiCall(`/api/booking/bookings${query({ serviceId })}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (input.action === "generate_slots") {
          if (!input.dateFrom || !input.dateTo || !input.startTime || !input.endTime) {
            throw new Error("dateFrom, dateTo, startTime, and endTime are required for generate_slots");
          }
          const data = await apiCall("/api/booking/slots/generate", "POST", {
            serviceId,
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            startTime: input.startTime,
            endTime: input.endTime,
            intervalMinutes: input.intervalMinutes ?? 30,
            capacity: input.capacity ?? 1,
            daysOfWeek: input.daysOfWeek ?? [1, 2, 3, 4, 5],
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (input.action === "update_google_settings") {
          const data = await apiCall(`/api/booking/services/${serviceId}`, "PUT", {
            googleCalendarId: input.googleCalendarId || null,
            enableGoogleMeet: input.enableGoogleMeet ?? true,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        throw new Error(`Unknown action: ${input.action}`);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(error) }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
