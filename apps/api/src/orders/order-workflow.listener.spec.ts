import { OrderWorkflowListener } from './order-workflow.listener';

describe('OrderWorkflowListener', () => {
  it('aggregates repeated order rows when replaying a legacy shipped event without explicit items', async () => {
    const ship = jest.fn().mockResolvedValue({});
    const findFirst = jest.fn().mockResolvedValue({
      items: [
        { productId: 'p1', quantity: 3 },
        { productId: 'p2', quantity: 1 },
        { productId: 'p1', quantity: 2 },
      ],
    });
    const listener = new OrderWorkflowListener(
      { postSaleOrderShipment: ship } as unknown as ConstructorParameters<
        typeof OrderWorkflowListener
      >[0],
      { order: { findFirst } } as unknown as ConstructorParameters<
        typeof OrderWorkflowListener
      >[1],
    );
    await listener.onSaleOrderShipped({
      recordId: 'o1',
      companyId: 'c1',
      operatorId: 'u1',
    });
    expect(ship).toHaveBeenCalledWith(
      'c1',
      'o1',
      expect.objectContaining({
        items: [
          { productId: 'p1', shipQuantity: 5 },
          { productId: 'p2', shipQuantity: 1 },
        ],
      }),
      'u1',
    );
  });
});
