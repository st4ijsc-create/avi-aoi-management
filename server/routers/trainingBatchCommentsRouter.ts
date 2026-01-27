/**
 * Training Batch Comments & Tags Router
 * Quản lý nhận xét và gắn thẻ cho từng lô đào tạo AI
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { 
  trainingBatchComments, 
  trainingBatchTags,
  trainingBatchTagAssignments,
  aiTrainingBatches
} from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export const trainingBatchCommentsRouter = router({
  // ============= Comments =============
  
  // Add comment to batch
  addComment: protectedProcedure
    .input(z.object({
      batchId: z.string(),
      content: z.string().min(1).max(5000),
      parentId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Verify batch exists
      const [batch] = await db
        .select()
        .from(aiTrainingBatches)
        .where(eq(aiTrainingBatches.batchId, input.batchId));

      if (!batch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Training batch không tồn tại" });
      }

      const [result] = await db.insert(trainingBatchComments).values({
        batchId: input.batchId,
        userId: ctx.user.id,
        userName: ctx.user.name || ctx.user.openId,
        content: input.content,
        parentId: input.parentId,
      }).returning({ id: trainingBatchComments.id });

      return { id: result.id };
    }),

  // List comments for batch
  listComments: protectedProcedure
    .input(z.object({
      batchId: z.string(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { comments: [], total: 0 };

      const comments = await db
        .select()
        .from(trainingBatchComments)
        .where(eq(trainingBatchComments.batchId, input.batchId))
        .orderBy(desc(trainingBatchComments.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trainingBatchComments)
        .where(eq(trainingBatchComments.batchId, input.batchId));

      return {
        comments,
        total: countResult?.count || 0,
      };
    }),

  // Update comment
  updateComment: protectedProcedure
    .input(z.object({
      commentId: z.number(),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Verify ownership
      const [comment] = await db
        .select()
        .from(trainingBatchComments)
        .where(eq(trainingBatchComments.id, input.commentId));

      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment không tồn tại" });
      }

      if (comment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền sửa comment này" });
      }

      await db
        .update(trainingBatchComments)
        .set({ content: input.content })
        .where(eq(trainingBatchComments.id, input.commentId));

      return { success: true };
    }),

  // Delete comment
  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Verify ownership
      const [comment] = await db
        .select()
        .from(trainingBatchComments)
        .where(eq(trainingBatchComments.id, input.commentId));

      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment không tồn tại" });
      }

      if (comment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền xóa comment này" });
      }

      // Delete replies first
      await db
        .delete(trainingBatchComments)
        .where(eq(trainingBatchComments.parentId, input.commentId));

      // Delete comment
      await db
        .delete(trainingBatchComments)
        .where(eq(trainingBatchComments.id, input.commentId));

      return { success: true };
    }),

  // ============= Tags =============

  // Create tag
  createTag: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3b82f6"),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Check if tag already exists
      const [existing] = await db
        .select()
        .from(trainingBatchTags)
        .where(eq(trainingBatchTags.name, input.name));

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Tag với tên này đã tồn tại" });
      }

      const [result] = await db.insert(trainingBatchTags).values({
        name: input.name,
        color: input.color,
        description: input.description,
      }).returning({ id: trainingBatchTags.id });

      return { id: result.id };
    }),

  // List all tags
  listTags: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(trainingBatchTags)
        .orderBy(trainingBatchTags.name);
    }),

  // Update tag
  updateTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const updateData: Record<string, string | undefined> = {};
      if (input.name) updateData.name = input.name;
      if (input.color) updateData.color = input.color;
      if (input.description !== undefined) updateData.description = input.description;

      await db
        .update(trainingBatchTags)
        .set(updateData)
        .where(eq(trainingBatchTags.id, input.tagId));

      return { success: true };
    }),

  // Delete tag
  deleteTag: protectedProcedure
    .input(z.object({ tagId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Delete all assignments first
      await db
        .delete(trainingBatchTagAssignments)
        .where(eq(trainingBatchTagAssignments.tagId, input.tagId));

      // Delete tag
      await db
        .delete(trainingBatchTags)
        .where(eq(trainingBatchTags.id, input.tagId));

      return { success: true };
    }),

  // ============= Tag Assignments =============

  // Assign tag to batch
  assignTag: protectedProcedure
    .input(z.object({
      batchId: z.string(),
      tagId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Check if already assigned
      const [existing] = await db
        .select()
        .from(trainingBatchTagAssignments)
        .where(and(
          eq(trainingBatchTagAssignments.batchId, input.batchId),
          eq(trainingBatchTagAssignments.tagId, input.tagId)
        ));

      if (existing) {
        return { success: true, message: "Tag đã được gán" };
      }

      const [result] = await db.insert(trainingBatchTagAssignments).values({
        batchId: input.batchId,
        tagId: input.tagId,
        assignedBy: ctx.user.id,
      }).returning({ id: trainingBatchTagAssignments.id });

      return { id: result.id };
    }),

  // Remove tag from batch
  removeTag: protectedProcedure
    .input(z.object({
      batchId: z.string(),
      tagId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db
        .delete(trainingBatchTagAssignments)
        .where(and(
          eq(trainingBatchTagAssignments.batchId, input.batchId),
          eq(trainingBatchTagAssignments.tagId, input.tagId)
        ));

      return { success: true };
    }),

  // Get tags for batch
  getBatchTags: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const assignments = await db
        .select({
          assignment: trainingBatchTagAssignments,
          tag: trainingBatchTags,
        })
        .from(trainingBatchTagAssignments)
        .innerJoin(trainingBatchTags, eq(trainingBatchTagAssignments.tagId, trainingBatchTags.id))
        .where(eq(trainingBatchTagAssignments.batchId, input.batchId));

      return assignments.map(a => ({
        ...a.tag,
        assignedAt: a.assignment.assignedAt,
      }));
    }),

  // Get batches by tag
  getBatchesByTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { batches: [], total: 0 };

      const assignments = await db
        .select({
          assignment: trainingBatchTagAssignments,
          batch: aiTrainingBatches,
        })
        .from(trainingBatchTagAssignments)
        .innerJoin(aiTrainingBatches, eq(trainingBatchTagAssignments.batchId, aiTrainingBatches.batchId))
        .where(eq(trainingBatchTagAssignments.tagId, input.tagId))
        .orderBy(desc(aiTrainingBatches.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trainingBatchTagAssignments)
        .where(eq(trainingBatchTagAssignments.tagId, input.tagId));

      return {
        batches: assignments.map(a => a.batch),
        total: countResult?.count || 0,
      };
    }),

  // Get comment count for batch
  getCommentCount: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return 0;

      const [result] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trainingBatchComments)
        .where(eq(trainingBatchComments.batchId, input.batchId));

      return result?.count || 0;
    }),
});

export type TrainingBatchCommentsRouter = typeof trainingBatchCommentsRouter;
