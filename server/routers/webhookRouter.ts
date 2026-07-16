import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { webhookConfigs, webhookDeliveryLogs } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// Available webhook event types
const WEBHOOK_EVENTS = [
  "inspection.created",
  "inspection.updated",
  "alert.triggered",
  "machine.status_changed",
  "machine.offline",
  "production_order.created",
  "production_order.completed",
  "yield.threshold_exceeded",
  "backup.completed",
  "system.error",
] as const;

// Send webhook helper (exported for use by other modules)
export async function sendWebhookEvent(eventType: string, payload: Record<string, any>) {
  const db = await getDb();
  if (!db) return;

  try {
    // Find all enabled webhooks subscribed to this event
    const webhooks = await db.select().from(webhookConfigs)
      .where(eq(webhookConfigs.isEnabled, true));

    const matchingWebhooks = webhooks.filter(wh => {
      const events = wh.events as string[];
      return events.includes(eventType) || events.includes("*");
    });

    for (const webhook of matchingWebhooks) {
      // Fire and forget - don't block the caller
      deliverWebhook(webhook, eventType, payload).catch(err => {
        console.error(`[Webhook] Failed to deliver to ${webhook.url}:`, err.message);
      });
    }
  } catch (error) {
    console.error("[Webhook] Error dispatching events:", error);
  }
}

async function deliverWebhook(
  webhook: typeof webhookConfigs.$inferSelect,
  eventType: string,
  payload: Record<string, any>,
  attempt: number = 1
) {
  const db = await getDb();
  if (!db) return;

  const startTime = Date.now();
  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
    webhookId: webhook.id,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": eventType,
    "X-Webhook-Delivery": nanoid(),
    ...(webhook.headers as Record<string, string> || {}),
  };

  // HMAC signature if secret configured
  if (webhook.secret) {
    const crypto = await import("crypto");
    const signature = crypto.createHmac("sha256", webhook.secret).update(body).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs);

    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseTimeMs = Date.now() - startTime;
    const responseBody = await response.text().catch(() => "");

    // Log the delivery
    await db.insert(webhookDeliveryLogs).values({
      webhookId: webhook.id,
      eventType,
      payload: { event: eventType, data: payload },
      responseStatus: response.status,
      responseBody: responseBody.substring(0, 1000), // Truncate
      responseTimeMs,
      success: response.ok,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
      attempt,
    });

    // Update stats
    if (response.ok) {
      await db.update(webhookConfigs)
        .set({
          successCount: sql`${webhookConfigs.successCount} + 1`,
          lastTriggeredAt: new Date(),
        })
        .where(eq(webhookConfigs.id, webhook.id));
    } else {
      await db.update(webhookConfigs)
        .set({
          failureCount: sql`${webhookConfigs.failureCount} + 1`,
          lastTriggeredAt: new Date(),
        })
        .where(eq(webhookConfigs.id, webhook.id));

      // Retry if needed
      if (attempt < webhook.retryCount) {
        setTimeout(() => {
          deliverWebhook(webhook, eventType, payload, attempt + 1);
        }, webhook.retryDelayMs * attempt);
      }
    }
  } catch (error: any) {
    const responseTimeMs = Date.now() - startTime;

    await db.insert(webhookDeliveryLogs).values({
      webhookId: webhook.id,
      eventType,
      payload: { event: eventType, data: payload },
      responseTimeMs,
      success: false,
      errorMessage: error.message,
      attempt,
    });

    await db.update(webhookConfigs)
      .set({
        failureCount: sql`${webhookConfigs.failureCount} + 1`,
        lastTriggeredAt: new Date(),
      })
      .where(eq(webhookConfigs.id, webhook.id));

    // Retry if needed
    if (attempt < webhook.retryCount) {
      setTimeout(() => {
        deliverWebhook(webhook, eventType, payload, attempt + 1);
      }, webhook.retryDelayMs * attempt);
    }
  }
}

export const webhookRouter = router({
  // List all webhook events available
  listEvents: protectedProcedure.query(async () => {
    return WEBHOOK_EVENTS.map(event => ({
      value: event,
      label: event,
      category: event.split(".")[0],
    }));
  }),

  // List all webhook configs
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const configs = await db.select().from(webhookConfigs).orderBy(desc(webhookConfigs.createdAt));
    return configs;
  }),

  // Get webhook by ID with delivery logs
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [config] = await db.select().from(webhookConfigs).where(eq(webhookConfigs.id, input.id));
      if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook không tồn tại" });

      const logs = await db.select().from(webhookDeliveryLogs)
        .where(eq(webhookDeliveryLogs.webhookId, input.id))
        .orderBy(desc(webhookDeliveryLogs.createdAt))
        .limit(50);

      return { ...config, deliveryLogs: logs };
    }),

  // Create webhook config
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      url: z.string().url("URL không hợp lệ"),
      secret: z.string().optional(),
      events: z.array(z.string()).min(1, "Chọn ít nhất 1 event"),
      headers: z.record(z.string(), z.string()).optional(),
      retryCount: z.number().min(0).max(10).default(3),
      retryDelayMs: z.number().min(1000).max(60000).default(5000),
      timeoutMs: z.number().min(1000).max(30000).default(10000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền tạo webhook" });
      }

      const [config] = await db.insert(webhookConfigs).values({
        name: input.name,
        description: input.description,
        url: input.url,
        secret: input.secret,
        events: input.events,
        headers: input.headers as Record<string, string> | undefined,
        retryCount: input.retryCount,
        retryDelayMs: input.retryDelayMs,
        timeoutMs: input.timeoutMs,
        createdBy: ctx.user!.id,
      }).returning();

      return { success: true, id: config.id, message: "Tạo webhook thành công" };
    }),

  // Update webhook config
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      url: z.string().url().optional(),
      secret: z.string().optional(),
      events: z.array(z.string()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      retryCount: z.number().min(0).max(10).optional(),
      retryDelayMs: z.number().min(1000).max(60000).optional(),
      timeoutMs: z.number().min(1000).max(30000).optional(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền cập nhật webhook" });
      }

      const { id, ...updateData } = input;
      const setData: Record<string, any> = { ...updateData, updatedAt: new Date() };
      if (updateData.headers) {
        setData.headers = updateData.headers as Record<string, string>;
      }
      await db.update(webhookConfigs)
        .set(setData)
        .where(eq(webhookConfigs.id, id));

      return { success: true, message: "Cập nhật webhook thành công" };
    }),

  // Delete webhook config
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền xóa webhook" });
      }

      // Delete delivery logs first
      await db.delete(webhookDeliveryLogs).where(eq(webhookDeliveryLogs.webhookId, input.id));
      await db.delete(webhookConfigs).where(eq(webhookConfigs.id, input.id));

      return { success: true, message: "Đã xóa webhook" };
    }),

  // Test webhook by sending a test event
  test: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [webhook] = await db.select().from(webhookConfigs).where(eq(webhookConfigs.id, input.id));
      if (!webhook) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook không tồn tại" });

      const testPayload = {
        test: true,
        message: "This is a test webhook delivery",
        timestamp: new Date().toISOString(),
        webhookName: webhook.name,
      };

      await deliverWebhook(webhook, "system.test", testPayload);

      return { success: true, message: "Đã gửi test webhook" };
    }),

  // Toggle webhook enabled/disabled
  toggle: protectedProcedure
    .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db.update(webhookConfigs)
        .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
        .where(eq(webhookConfigs.id, input.id));

      return { success: true, message: input.isEnabled ? "Đã bật webhook" : "Đã tắt webhook" };
    }),

  // Get delivery logs for a webhook
  getDeliveryLogs: protectedProcedure
    .input(z.object({
      webhookId: z.number().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (input.webhookId) {
        return await db.select().from(webhookDeliveryLogs)
          .where(eq(webhookDeliveryLogs.webhookId, input.webhookId))
          .orderBy(desc(webhookDeliveryLogs.createdAt))
          .limit(input.limit);
      }

      return await db.select().from(webhookDeliveryLogs)
        .orderBy(desc(webhookDeliveryLogs.createdAt))
        .limit(input.limit);
    }),

  // Get webhook stats
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const totalWebhooks = await db.select({ count: sql<number>`count(*)` }).from(webhookConfigs);
    const activeWebhooks = await db.select({ count: sql<number>`count(*)` }).from(webhookConfigs).where(eq(webhookConfigs.isEnabled, true));
    const totalDeliveries = await db.select({ count: sql<number>`count(*)` }).from(webhookDeliveryLogs);
    const successDeliveries = await db.select({ count: sql<number>`count(*)` }).from(webhookDeliveryLogs).where(eq(webhookDeliveryLogs.success, true));

    return {
      totalWebhooks: Number(totalWebhooks[0]?.count) || 0,
      activeWebhooks: Number(activeWebhooks[0]?.count) || 0,
      totalDeliveries: Number(totalDeliveries[0]?.count) || 0,
      successDeliveries: Number(successDeliveries[0]?.count) || 0,
      successRate: Number(totalDeliveries[0]?.count) > 0
        ? Math.round((Number(successDeliveries[0]?.count) / Number(totalDeliveries[0]?.count)) * 100)
        : 100,
    };
  }),

  // Clear old delivery logs
  clearLogs: protectedProcedure
    .input(z.object({
      webhookId: z.number().optional(),
      olderThanDays: z.number().min(1).max(365).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền xóa logs" });
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.olderThanDays);

      let conditions = [sql`${webhookDeliveryLogs.createdAt} < ${cutoffDate.toISOString()}`];
      if (input.webhookId) {
        conditions.push(eq(webhookDeliveryLogs.webhookId, input.webhookId));
      }

      await db.delete(webhookDeliveryLogs).where(and(...conditions));

      return { success: true, message: `Đã xóa logs cũ hơn ${input.olderThanDays} ngày` };
    }),
});
