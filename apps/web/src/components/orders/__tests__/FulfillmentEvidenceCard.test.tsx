import { render, screen } from '@testing-library/react';
import {
  FulfillmentEvidenceCard,
  type FulfillmentEvidenceLoadState,
} from '../FulfillmentEvidenceCard';

const evidence = {
  assessment: 'WORK_ORDER_COVERAGE',
  issues: [],
  materialDemandGroups: [
    {
      materialId: 'material-uuid-1',
      materialName: 'Synthetic Widget',
      materialSku: 'SYN-WIDGET',
      materialUnit: '件',
      orderItemIds: ['order-line-uuid-1'],
      productIds: ['synthetic-product'],
      orderedQty: 10,
      netShippedQty: 6,
      remainingQty: 4,
      onHandQty: 0,
      openWorkOrderQty: 4,
      onHandGapQty: 4,
      projectedGapQty: 0,
      assessment: 'WORK_ORDER_COVERAGE',
      issues: [],
    },
  ],
  stockBasis: 'UNRESERVED_SNAPSHOT',
  workOrderBasis: 'UNFINISHED_NOT_ETA',
};

function renderCard(
  value: unknown,
  loadState: FulfillmentEvidenceLoadState = 'ready',
  permissions: string[] = [],
) {
  return render(
    <FulfillmentEvidenceCard
      value={value}
      loadState={loadState}
      permissions={permissions}
    />,
  );
}

describe('FulfillmentEvidenceCard', () => {
  it('explains material-group quantities and makes no reservation, ETA, or line-allocation promise', () => {
    renderCard(evidence);

    expect(
      screen.getByRole('heading', { name: '交付备料评估（参考）' }),
    ).toBeInTheDocument();
    expect(screen.getByText('SYN-WIDGET · 件')).toBeInTheDocument();
    expect(screen.getByText('订购数量').parentElement).toHaveTextContent('10');
    expect(screen.getByText('净发货数量').parentElement).toHaveTextContent('6');
    expect(screen.getByText('剩余数量').parentElement).toHaveTextContent('4');
    expect(screen.getByText('未预留库存快照，不代表当前可分配数量。')).toBeInTheDocument();
    expect(screen.getByText(/仅计未完工数量；不包含 ETA/)).toBeInTheDocument();
    expect(screen.getByText(/不拆分到具体订单行/)).toBeInTheDocument();
    expect(screen.queryByText('现货可交')).not.toBeInTheDocument();
    expect(screen.queryByText('交付可承诺')).not.toBeInTheDocument();

    const idsDetails = screen.getByText('查看关联 ID').closest('details');
    expect(idsDetails).toBeInTheDocument();
    expect(idsDetails).toHaveTextContent('material-uuid-1');
    expect(idsDetails).toHaveTextContent('order-line-uuid-1');
  });

  it('shows unknown for legacy-only and unrecognized API status, never a green fallback', () => {
    const { rerender } = renderCard({
      overallStatus: 'READY',
      lines: [{ status: 'READY', projectedQty: 10 }],
    });
    expect(screen.getByText('评估未知')).toBeInTheDocument();
    expect(screen.getByText(/接口未提供可识别的新履约证据/)).toBeInTheDocument();
    expect(screen.queryByText('现货可交')).not.toBeInTheDocument();

    rerender(
      <FulfillmentEvidenceCard
        value={{ ...evidence, assessment: 'READY' }}
        loadState="ready"
      />,
    );
    expect(screen.getByText('评估未知')).toBeInTheDocument();
  });

  it('renders explicit API failure instead of treating evidence as zero', () => {
    renderCard(null, 'error');

    expect(screen.getByRole('alert')).toHaveTextContent('履约证据读取失败');
    expect(screen.getByText('评估未知')).toBeInTheDocument();
  });

  it('exposes only links allowed by permission wildcards and the target page requirements', () => {
    const { rerender } = renderCard(evidence, 'ready', ['*:read']);
    expect(screen.getByRole('link', { name: '查看库存' })).toHaveAttribute(
      'href',
      '/dashboard/inventory',
    );
    expect(screen.getByRole('link', { name: '查看生产工单' })).toHaveAttribute(
      'href',
      '/dashboard/production',
    );
    expect(screen.getByRole('link', { name: '查看产品' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/product',
    );

    rerender(
      <FulfillmentEvidenceCard
        value={evidence}
        loadState="ready"
        permissions={['production:read', 'inventory:read']}
      />,
    );
    expect(screen.queryByRole('link', { name: '查看生产工单' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看库存' })).toBeInTheDocument();

    rerender(
      <FulfillmentEvidenceCard
        value={evidence}
        loadState="ready"
        permissions={['*:*']}
      />,
    );
    expect(screen.getByRole('link', { name: '查看生产工单' })).toBeInTheDocument();
  });
});
