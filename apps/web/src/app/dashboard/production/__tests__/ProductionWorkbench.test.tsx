import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductionWorkbench } from "../ProductionWorkbench";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe("ProductionWorkbench engineering revisions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path === "/production/orders") {
        return Promise.resolve({ data: { data: [] } });
      }
      if (path === "/inventory/locations") {
        return Promise.resolve({ data: [] });
      }
      if (path === "/production/material-availability") {
        return Promise.resolve({
          data: {
            rows: [],
            shortageCount: 0,
            totalOpenWorkOrders: 0,
            missingBomWorkOrders: [],
          },
        });
      }
      if (path === "/orders") {
        return Promise.resolve({
          data: {
            data: [
              {
                id: "order-1",
                orderNo: "ORD-001",
                status: "SUBMITTED",
                partner: { name: "示例客户" },
              },
            ],
          },
        });
      }
      if (path === "/purchase/supplier-options") {
        return Promise.resolve({ data: [] });
      }
      if (path === "/engineering-documents/released-for-order/order-1") {
        return Promise.resolve({
          data: [
            {
              id: "document-1",
              documentNo: "ED-P1001-000001",
              title: "总装图",
              product: { id: "product-1", sku: "P1001", name: "设备" },
              currentReleasedRevision: {
                id: "revision-1",
                revisionNo: 1,
                status: "RELEASED",
                fileRecord: { fileName: "assembly.pdf" },
              },
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mockPost.mockResolvedValue({
      data: { created: [{ id: "work-order-1" }], skipped: [] },
    });
  });

  it("pins selected released engineering revisions when generating work orders", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);

    expect(await screen.findByText(/ED-P1001-000001/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "生成工单" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/production/orders/from-sales-order/order-1",
        {
          skipExisting: true,
          engineeringRevisionIds: ["revision-1"],
        },
      );
    });
  });

  it("reuses the same report idempotency key after a network retry", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === "/production/orders") {
        return Promise.resolve({
          data: {
            data: [
              {
                id: "work-order-1",
                workOrderNo: "WO-001",
                plannedQty: 5,
                actualQty: 2,
                status: "IN_PROGRESS",
                order: { orderNo: "ORD-001", partner: { name: "示例客户" } },
              },
            ],
          },
        });
      }
      if (path === "/inventory/locations") {
        return Promise.resolve({
          data: [
            { id: "raw-loc", name: "原料库" },
            { id: "fg-loc", name: "成品库" },
          ],
        });
      }
      if (path === "/production/material-availability") {
        return Promise.resolve({
          data: {
            rows: [],
            shortageCount: 0,
            totalOpenWorkOrders: 1,
            missingBomWorkOrders: [],
          },
        });
      }
      if (path === "/orders") {
        return Promise.resolve({ data: { data: [] } });
      }
      if (path === "/purchase/supplier-options") {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mockPost
      .mockRejectedValueOnce({ response: { data: { message: "网络中断" } } })
      .mockResolvedValueOnce({
        data: {
          id: "report-1",
          idempotentReplay: true,
          inventoryTransactionIds: ["t1", "t2"],
        },
      });
    const user = userEvent.setup();
    render(<ProductionWorkbench />);

    expect(
      await screen.findByText("剩余可报良品 3", { exact: false }),
    ).toBeInTheDocument();
    await user.selectOptions(
      await screen.findByLabelText("原料领用库位"),
      "raw-loc",
    );
    await user.selectOptions(
      await screen.findByLabelText("成品入库库位"),
      "fg-loc",
    );
    await user.click(await screen.findByRole("button", { name: "提交报工" }));
    expect(await screen.findByText("网络中断")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "提交报工" }));

    await waitFor(() => {
      const reportCalls = mockPost.mock.calls.filter(
        ([path]) => path === "/production/orders/work-order-1/report",
      );
      expect(reportCalls).toHaveLength(2);
      expect(reportCalls[0]?.[1].idempotencyKey).toBeTruthy();
      expect(reportCalls[1]?.[1].idempotencyKey).toBe(
        reportCalls[0]?.[1].idempotencyKey,
      );
    });
  });
});
