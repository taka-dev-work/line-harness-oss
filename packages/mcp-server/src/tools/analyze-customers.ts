import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

async function apiCall(path: string) {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || "未分類";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function registerAnalyzeCustomers(server: McpServer): void {
  server.tool(
    "analyze_customers",
    "LINE顧客を分析します。タグ、温度感、診断結果、予約状況から高温度リードや運用サマリーを出します。",
    {
      limit: z.number().optional().describe("Friend fetch limit. Default 200"),
      includeRaw: z.boolean().optional().describe("Include raw friends/bookings in response"),
    },
    async ({ limit = 200, includeRaw = false }) => {
      try {
        const [friendsRes, bookingsRes] = await Promise.all([
          apiCall(`/api/friends?limit=${limit}`),
          apiCall("/api/booking/bookings"),
        ]);
        const friends = (friendsRes.data?.items ?? friendsRes.data ?? []) as Array<{
          id: string;
          displayName?: string | null;
          lineUserId?: string;
          tags?: Array<{ name: string }>;
          createdAt?: string;
        }>;
        const bookings = (bookingsRes.data ?? []) as Array<{
          id: string;
          serviceName?: string | null;
          lineUserId?: string;
          status?: string;
          createdAt?: string;
        }>;

        const tagCounts = countBy(
          friends.flatMap((friend) => friend.tags ?? []),
          (tag) => tag.name,
        );
        const hotTags = ["温度_高", "商談候補", "希望_個別相談", "希望_法人導入", "見込み_法人相談"];
        const hotLeads = friends.filter((friend) => {
          const tagNames = (friend.tags ?? []).map((tag) => tag.name);
          return hotTags.some((tag) => tagNames.includes(tag)) || tagNames.some((tag) => tag.startsWith("診断_"));
        });
        const bookingStatusCounts = countBy(bookings, (booking) => booking.status);
        const bookingServiceCounts = countBy(bookings, (booking) => booking.serviceName);

        const summary = {
          friendCount: friends.length,
          bookingCount: bookings.length,
          hotLeadCount: hotLeads.length,
          tagCounts,
          bookingStatusCounts,
          bookingServiceCounts,
          topHotLeads: hotLeads.slice(0, 20).map((friend) => ({
            id: friend.id,
            displayName: friend.displayName,
            lineUserId: friend.lineUserId,
            tags: (friend.tags ?? []).map((tag) => tag.name),
            createdAt: friend.createdAt,
          })),
          nextActions: [
            "温度_高 または 希望_個別相談 の顧客に個別フォローを送る",
            "診断結果タグ別にガイド/勉強会/個別相談の導線を分ける",
            "予約済みユーザーと未予約の高温度ユーザーを分けて追客する",
          ],
          ...(includeRaw ? { friends, bookings } : {}),
        };

        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, summary }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(error) }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
