import React from 'react';
import { DynamicView } from '@/components/core';

export default function InventoryPage() {
  return <DynamicView modelName="stockQuant" title="仓库库存" />;
}
