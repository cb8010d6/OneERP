import React from 'react';
import { DynamicView } from '@/components/core';

export default function OrdersPage() {
  return <DynamicView modelName="order" title="生产订单管理" />;
}
