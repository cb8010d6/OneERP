-- Add sales price to products
ALTER TABLE "Product"
ADD COLUMN "listPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
