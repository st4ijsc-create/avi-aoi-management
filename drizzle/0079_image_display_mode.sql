-- Add image display mode column to product_models
-- Values: "contain" (Fit), "cover" (Fill), "stretch", "none" (Center)
-- Default: "contain" (current behavior)
ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "imageDisplayMode" varchar(20) DEFAULT 'contain';
