// Schema domain: Dashboard tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { themeEnum, templateTypeEnum, shadowEnum, presetTypeEnum } from "./enums";

export const dashboardWidgetLayouts = pgTable("dashboard_widget_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  layoutName: varchar("layoutName", { length: 100 }).default("default").notNull(),
  // Widget configuration as JSON array
  widgets: json("widgets").$type<Array<{
    id: string; // Unique widget ID
    type: string; // Widget type (e.g., 'yield_chart', 'throughput', 'alerts', etc.)
    title: string; // Display title
    // Position and size (grid-based)
    x: number; // Column position (0-based)
    y: number; // Row position (0-based)
    w: number; // Width in grid units
    h: number; // Height in grid units
    // Widget-specific settings
    settings?: Record<string, any>;
    // Visibility
    visible: boolean;
  }>>().notNull(),
  // Active layout
  isActive: boolean("isActive").default(true).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_widget_layouts_user").on(table.userId),
  index("idx_widget_layouts_active").on(table.isActive),
  index("idx_widget_layouts_user_active").on(table.userId, table.isActive),
]);

export type DashboardWidgetLayout = typeof dashboardWidgetLayouts.$inferSelect;
export type InsertDashboardWidgetLayout = typeof dashboardWidgetLayouts.$inferInsert;

/**
 * User Custom Dashboards - Cho phép mỗi user tạo nhiều dashboard tùy chỉnh
 */
export const userCustomDashboards = pgTable("user_custom_dashboards", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Widget configuration as JSON array
  widgets: json("widgets").$type<Array<{
    id: string;
    type: string;
    title: string;
    size: 'small' | 'medium' | 'large' | 'full';
    position: { x: number; y: number };
    config: Record<string, any>;
  }>>().notNull().default([]),
  gridCols: integer("gridCols").default(4).notNull(),
  isPublic: boolean("isPublic").default(false).notNull(),
  isFavorite: boolean("isFavorite").default(false).notNull(),
  // Auto-refresh interval in seconds (0 = disabled)
  autoRefreshInterval: integer("autoRefreshInterval").default(0).notNull(),
  // Global filters applied to all widgets
  globalFilters: json("globalFilters").$type<{
    factoryId?: number;
    lineId?: number;
    machineId?: number;
    dateRange?: { from: string; to: string };
  }>().default({}),
  // Theme/style preset
  themePreset: varchar("themePreset", { length: 50 }).default("default"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_custom_dashboards_user").on(table.userId),
  index("idx_user_custom_dashboards_public").on(table.isPublic),
  index("idx_user_custom_dashboards_favorite").on(table.userId, table.isFavorite),
]);

export type UserCustomDashboard = typeof userCustomDashboards.$inferSelect;
export type InsertUserCustomDashboard = typeof userCustomDashboards.$inferInsert;

/**
 * User Settings - Cài đặt chung của user (bao gồm language)
 */
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(), // FK to users
  // Language preference
  language: varchar("language", { length: 10 }).default("vi").notNull(), // vi, en, zh, ja
  // Theme preference
  theme: themeEnum("theme").default("system").notNull(),
  // Timezone
  timezone: varchar("timezone", { length: 50 }).default("Asia/Ho_Chi_Minh"),
  // Date/time format preferences
  dateFormat: varchar("dateFormat", { length: 20 }).default("DD/MM/YYYY"),
  timeFormat: varchar("timeFormat", { length: 10 }).default("24h"), // 12h or 24h
  // Number format
  numberFormat: varchar("numberFormat", { length: 20 }).default("1.234,56"), // Decimal separator
  // Dashboard preferences
  defaultDashboardTab: varchar("defaultDashboardTab", { length: 50 }).default("overview"),
  // Sidebar preferences
  sidebarCollapsed: boolean("sidebarCollapsed").default(false).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_settings_user").on(table.userId),
  index("idx_user_settings_language").on(table.language),
]);

export type UserSetting = typeof userSettings.$inferSelect;
export type InsertUserSetting = typeof userSettings.$inferInsert;


// ============= Dashboard Templates (Shared) =============

/**
 * Dashboard Templates - Templates layout dashboard có thể chia sẻ
 */
export const dashboardTemplates = pgTable("dashboard_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Template type: system (preset), shared (admin created for team)
  templateType: templateTypeEnum("templateType").default("shared").notNull(),
  // Layout configuration
  widgets: json("widgets").$type<string[]>().notNull(), // Array of widget IDs
  layout: json("layout").$type<Array<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
  }>>().notNull(),
  // Preview image (optional)
  previewImageUrl: text("previewImageUrl"),
  // Access control
  isPublic: boolean("isPublic").default(true).notNull(), // Visible to all users
  createdBy: integer("createdBy").notNull(), // FK to users (admin who created)
  // Usage stats
  usageCount: integer("usageCount").default(0).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_dashboard_templates_type").on(table.templateType),
  index("idx_dashboard_templates_public").on(table.isPublic),
  index("idx_dashboard_templates_creator").on(table.createdBy),
  index("idx_dashboard_templates_usage").on(table.usageCount),
]);

export type DashboardTemplate = typeof dashboardTemplates.$inferSelect;
export type InsertDashboardTemplate = typeof dashboardTemplates.$inferInsert;


// ============= Dashboard Widget Style Presets =============

/**
 * Widget Style Presets - Preset styles cho dashboard widgets
 */
export const widgetStylePresets = pgTable("widget_style_presets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Style configuration
  backgroundColor: varchar("backgroundColor", { length: 20 }).default("#ffffff").notNull(),
  textColor: varchar("textColor", { length: 20 }).default("#1f2937").notNull(),
  borderColor: varchar("borderColor", { length: 20 }).default("#e5e7eb").notNull(),
  accentColor: varchar("accentColor", { length: 20 }).default("#3b82f6").notNull(),
  borderRadius: varchar("borderRadius", { length: 20 }).default("0.5rem").notNull(),
  shadow: shadowEnum("shadow").default("sm").notNull(),
  opacity: decimal("opacity", { precision: 3, scale: 2 }).default("1.00").notNull(),
  // Preset type: system (built-in), shared (admin created), user (personal)
  presetType: presetTypeEnum("presetType").default("user").notNull(),
  // Access control
  isPublic: boolean("isPublic").default(false).notNull(), // Visible to all users
  createdBy: integer("createdBy").notNull(), // FK to users
  // Usage stats
  usageCount: integer("usageCount").default(0).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_widget_presets_type").on(table.presetType),
  index("idx_widget_presets_public").on(table.isPublic),
  index("idx_widget_presets_creator").on(table.createdBy),
  index("idx_widget_presets_name").on(table.name),
]);

export type WidgetStylePreset = typeof widgetStylePresets.$inferSelect;
export type InsertWidgetStylePreset = typeof widgetStylePresets.$inferInsert;
