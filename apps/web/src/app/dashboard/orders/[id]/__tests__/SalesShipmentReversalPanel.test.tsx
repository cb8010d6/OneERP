import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { SalesShipmentReversalPanel } from "../SalesShipmentReversalPanel";

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

describe("SalesShipmentReversalPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.get.mockImplementation((url) => {
      if (url === "/inventory/locations") {
        return Promise.resolve({
          data: [
            {
              id: "location-1",
              name: "成品库位",
              warehouse: { name: "成品仓" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: "return-1",
            returnNo: "SR-001",
            returnType: "SALES",
            sourceDocumentId: "order-1",
            sourceDocumentNo: "SO-001",
            status: "POSTED",
            postedAt: "2026-07-13T00:00:00.000Z",
            lines: [{ id: "line-1", quantity: 2 }],
          },
        ],
      });
    });
  });

  it("requires explicit acknowledgement and posts an auditable reversal", async () => {
    const user = userEvent.setup();
    const onReversed = jest.fn();
    mockedApi.post.mockResolvedValue({
      data: {
        message: "销售订单冲销完成，订单状态已回退为 IN_PRODUCTION",
        reversedLines: [
          { materialId: "material-1", quantity: 2, transactionId: "move-1" },
        ],
        returnDocument: {
          id: "return-2",
          returnNo: "SR-002",
          lines: [],
        },
      },
    });

    render(
      <SalesShipmentReversalPanel
        orderId="order-1"
        orderNo="SO-001"
        onReversed={onReversed}
      />,
    );

    await screen.findByRole("option", { name: "成品仓 / 成品库位" });
    expect(screen.getByText("SR-001")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "确认冲销并回库" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("冲销原因"), "客户拒收");
    await user.click(screen.getByLabelText("确认冲销影响"));
    await user.click(submit);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/inventory/posting/sale-order/order-1/reverse",
        {
          destLocationId: "location-1",
          note: "客户拒收",
        },
      );
    });
    expect(mockedToast.success).toHaveBeenCalledWith(
      "销售订单冲销完成，订单状态已回退为 IN_PRODUCTION",
    );
    expect(onReversed).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/反向流水 1 条/)).toBeInTheDocument();
  });
});
