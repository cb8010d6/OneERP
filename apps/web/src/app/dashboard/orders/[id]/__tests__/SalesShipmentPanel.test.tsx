import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { SalesShipmentPanel } from "../SalesShipmentPanel";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedToast = toast as jest.Mocked<typeof toast>;

const items = [
  { id: "line-1", productId: "product-1", quantity: 2 },
  { id: "line-2", productId: "product-2", quantity: 1 },
];

describe("SalesShipmentPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.get.mockResolvedValue({
      data: [
        {
          id: "location-1",
          name: "成品库位",
          warehouse: { name: "成品仓" },
        },
      ],
    });
  });

  it("submits the default shipment as an atomic whole-order posting", async () => {
    const user = userEvent.setup();
    const onPosted = jest.fn();
    mockedApi.post.mockResolvedValue({
      data: {
        status: "SHIPPED",
        postingStatus: "POSTED",
        message: "销售订单自动过账完成",
        postedLines: [
          {
            productId: "product-1",
            requestedQuantity: 2,
            quantity: 2,
            allocations: [],
          },
          {
            productId: "product-2",
            requestedQuantity: 1,
            quantity: 1,
            allocations: [],
          },
        ],
        skippedLines: [],
      },
    });

    render(
      <SalesShipmentPanel
        orderId="order-1"
        orderNo="SO-001"
        items={items}
        onPosted={onPosted}
      />,
    );

    await screen.findByRole("option", { name: "成品仓 / 成品库位" });
    await user.click(screen.getByRole("button", { name: "执行整单原子发货" }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/posting/sale-order/order-1/ship",
        expect.objectContaining({
          sourceLocationId: "location-1",
          allowPartial: false,
          items: [
            { productId: "product-1", shipQuantity: 2 },
            { productId: "product-2", shipQuantity: 1 },
          ],
        }),
      );
    });
    expect(await screen.findByText(/已过账 2 行/)).toBeInTheDocument();
    expect(mockedToast.success).toHaveBeenCalledWith("整单发货已原子过账");
    expect(onPosted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SHIPPED" }),
    );
  });

  it("requires an explicit choice for partial posting and shows skipped lines", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValue({
      data: {
        status: "PARTIAL_SHIPPED",
        postingStatus: "POSTED",
        message: "销售订单部分发货完成",
        postedLines: [
          {
            productId: "product-1",
            requestedQuantity: 2,
            quantity: 1,
            allocations: [],
          },
        ],
        skippedLines: [
          {
            productId: "product-2",
            requestedQuantity: 1,
            reason: "当前库存不足，最大可发货量为 0",
          },
        ],
      },
    });

    render(
      <SalesShipmentPanel orderId="order-1" orderNo="SO-001" items={items} />,
    );

    await screen.findByRole("option", { name: "成品仓 / 成品库位" });
    await user.click(screen.getByLabelText("允许部分发货"));
    await user.click(screen.getByRole("button", { name: "执行部分发货" }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/posting/sale-order/order-1/ship",
        expect.objectContaining({ allowPartial: true }),
      );
    });
    expect(
      await screen.findByText(/产品 product-2：当前库存不足/),
    ).toBeInTheDocument();
    expect(mockedToast.success).toHaveBeenCalledWith(
      "部分发货完成：过账 1 行，跳过 1 行",
    );
  });

  it("keeps one selected duplicate-product row and omits its zero sibling from the request", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValue({
      data: {
        status: "PARTIAL_SHIPPED",
        postingStatus: "POSTED",
        message: "销售订单部分发货完成",
        postedLines: [],
        skippedLines: [],
      },
    });

    render(
      <SalesShipmentPanel
        orderId="order-1"
        orderNo="SO-001"
        items={[
          { id: "line-a", productId: "product-1", quantity: 2 },
          { id: "line-b", productId: "product-1", quantity: 3 },
        ]}
      />,
    );

    await screen.findByRole("option", { name: "成品仓 / 成品库位" });
    const duplicateInputs = screen.getAllByRole("spinbutton", {
      name: "产品 product-1 发货数量",
    });
    fireEvent.change(duplicateInputs[0], { target: { value: "2.5" } });
    fireEvent.change(duplicateInputs[1], { target: { value: "0" } });
    expect(duplicateInputs[0]).toHaveAttribute("step", "0.0001");
    await user.click(screen.getByRole("button", { name: "执行整单原子发货" }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/posting/sale-order/order-1/ship",
        expect.objectContaining({
          items: [{ productId: "product-1", shipQuantity: 2.5 }],
        }),
      );
    });
  });

  it("aggregates both duplicate-product rows using four-place quantity precision", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValue({
      data: {
        status: "SHIPPED",
        postingStatus: "POSTED",
        message: "销售订单自动过账完成",
        postedLines: [],
        skippedLines: [],
      },
    });

    render(
      <SalesShipmentPanel
        orderId="order-1"
        orderNo="SO-001"
        items={[
          { id: "line-a", productId: "product-1", quantity: 0.0001 },
          { id: "line-b", productId: "product-1", quantity: 8.9999 },
          { id: "line-zero", productId: "product-2", quantity: 0 },
        ]}
      />,
    );

    await screen.findByRole("option", { name: "成品仓 / 成品库位" });
    expect(screen.getByText(/本次申请 9 件/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "执行整单原子发货" }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/posting/sale-order/order-1/ship",
        expect.objectContaining({
          items: [{ productId: "product-1", shipQuantity: 9 }],
        }),
      );
    });
  });
});
