export interface StockLedgerRow {
  locationId: string;
  locationName: string;
  warehouseId: string | null;
  warehouseName: string | null;
  materialId: string;
  materialSku: string;
  materialName: string;
  materialUnit: string;
  minStock: number;
  netQty: number;
  batchCount: number;
  averageCost: number;
  inventoryValue: number;
  isLow: boolean;
}

export interface ReplenishmentSuggestionRow {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  minStock: number;
  onHandQty: number;
  incomingQty: number;
  projectedQty: number;
  shortageQty: number;
  suggestedPurchaseQty: number;
  unitPrice: number;
  estimatedAmount: number;
  severity: 'OUT_OF_STOCK' | 'SHORTAGE';
}

export interface ReplenishmentSuggestionResult {
  totalSuggestions: number;
  totalShortageQty: number;
  totalEstimatedAmount: number;
  rows: ReplenishmentSuggestionRow[];
}
