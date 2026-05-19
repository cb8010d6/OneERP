-- Use fixed-precision decimals for money, tax rates, and inventory quantities.
-- PostgreSQL can cast existing double precision values to numeric without data loss
-- at the scale OneERP currently stores in production-trial data.

ALTER TABLE "TaxCode"
  ALTER COLUMN "rate" TYPE DECIMAL(18,4) USING "rate"::numeric(18,4);

ALTER TABLE "Order"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(18,4) USING "totalAmount"::numeric(18,4),
  ALTER COLUMN "subTotal" TYPE DECIMAL(18,4) USING "subTotal"::numeric(18,4),
  ALTER COLUMN "taxTotal" TYPE DECIMAL(18,4) USING "taxTotal"::numeric(18,4);

ALTER TABLE "OrderItem"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(18,4) USING "unitPrice"::numeric(18,4),
  ALTER COLUMN "totalPrice" TYPE DECIMAL(18,4) USING "totalPrice"::numeric(18,4),
  ALTER COLUMN "subTotal" TYPE DECIMAL(18,4) USING "subTotal"::numeric(18,4),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,4) USING "taxAmount"::numeric(18,4),
  ALTER COLUMN "taxRate" TYPE DECIMAL(18,4) USING "taxRate"::numeric(18,4);

ALTER TABLE "Material"
  ALTER COLUMN "minStock" TYPE DECIMAL(18,4) USING "minStock"::numeric(18,4),
  ALTER COLUMN "unitPrice" TYPE DECIMAL(18,4) USING "unitPrice"::numeric(18,4);

ALTER TABLE "Product"
  ALTER COLUMN "listPrice" TYPE DECIMAL(18,4) USING "listPrice"::numeric(18,4);

ALTER TABLE "BomLine"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,4) USING "quantity"::numeric(18,4),
  ALTER COLUMN "scrapRate" TYPE DECIMAL(18,4) USING "scrapRate"::numeric(18,4);

ALTER TABLE "StockQuant"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,4) USING "quantity"::numeric(18,4);

ALTER TABLE "InventoryTransaction"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,4) USING "quantity"::numeric(18,4);

ALTER TABLE "Invoice"
  ALTER COLUMN "amount" TYPE DECIMAL(18,4) USING "amount"::numeric(18,4),
  ALTER COLUMN "subTotal" TYPE DECIMAL(18,4) USING "subTotal"::numeric(18,4),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(18,4) USING "taxAmount"::numeric(18,4);

ALTER TABLE "Payment"
  ALTER COLUMN "amount" TYPE DECIMAL(18,4) USING "amount"::numeric(18,4);

ALTER TABLE "JournalEntryLine"
  ALTER COLUMN "debit" TYPE DECIMAL(18,4) USING "debit"::numeric(18,4),
  ALTER COLUMN "credit" TYPE DECIMAL(18,4) USING "credit"::numeric(18,4);
