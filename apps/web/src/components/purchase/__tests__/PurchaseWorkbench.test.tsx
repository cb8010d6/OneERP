import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseWorkbench } from "../PurchaseWorkbench";
import { useAuthStore } from "@/store/authStore";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockFetchResourceList = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock("@/lib/dynamic-resource", () => ({
  __esModule: true,
  fetchResourceList: (...args: unknown[]) => mockFetchResourceList(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function purchaseOrder(
  id: string,
  purchaseNo: string,
  quantity: string | number = 2,
  receivedQty: string | number = 0,
) {
  return {
    id,
    purchaseNo,
    status: "DRAFT",
    supplier: { id: "supplier-1", name: "示例供应商" },
    items: [
      {
        id: `${id}-line`,
        materialId: "material-1",
        quantity,
        receivedQty,
        unitPrice: 12.5,
        material: { name: "示例物料", sku: "MAT-01" },
      },
    ],
    invoices: [],
    purchaseMatch: {
      status: "NO_INVOICE",
      isPostable: false,
      orderedAmount: 25,
      receivedAmount: 0,
      invoicedAmount: 0,
      amountVariance: 0,
      reasons: [],
    },
  };
}

function configureResourceLists() {
  mockFetchResourceList.mockImplementation((modelName: string) => {
    if (modelName === "partner") {
      return Promise.resolve({
        data: [{ id: "supplier-1", name: "示例供应商", type: "SUPPLIER" }],
      });
    }
    if (modelName === "material") {
      return Promise.resolve({
        data: [
          {
            id: "material-1",
            name: "示例物料",
            sku: "MAT-01",
            unitPrice: 12.5,
          },
        ],
      });
    }
    if (modelName === "stockLocation") {
      return Promise.resolve({
        data: [{ id: "location-1", name: "原料库", code: "WH-01" }],
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function configureOrders(orders: ReturnType<typeof purchaseOrder>[]) {
  mockGet.mockImplementation((path: string) =>
    Promise.resolve({ data: path === "/purchase/orders" ? orders : [] }),
  );
}

const companies = [
  { id: "company-a", name: "公司 A", role: "SuperAdmin", permissions: ["ALL"] },
  { id: "company-b", name: "公司 B", role: "SuperAdmin", permissions: ["ALL"] },
];

describe("PurchaseWorkbench context safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      contextVersion: 0,
      token: "token-a",
      user: { id: "user-a", email: "buyer@example.com" },
      companies,
      currentCompanyId: "company-a",
    });
    configureResourceLists();
    configureOrders([purchaseOrder("order-a", "PO-A-OLD")]);
    mockPost.mockResolvedValue({ data: { id: "created-record" } });
  });

  it("ignores an old response across an A→B→A switch and hides A while B loads", async () => {
    const staleARefresh = deferred<{ data: ReturnType<typeof purchaseOrder>[] }>();
    const pendingBLoad = deferred<{ data: ReturnType<typeof purchaseOrder>[] }>();
    let orderRequestCount = 0;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      orderRequestCount += 1;
      if (orderRequestCount === 2) return staleARefresh.promise;
      if (orderRequestCount === 3) return pendingBLoad.promise;
      if (orderRequestCount === 4) {
        return Promise.resolve({
          data: [purchaseOrder("order-a-new", "PO-A-NEW")],
        });
      }
      return Promise.resolve({
        data: [purchaseOrder("order-a", "PO-A-OLD")],
      });
    });
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);

    expect(
      await screen.findAllByRole("option", { name: /PO-A-OLD/ }),
    ).not.toHaveLength(0);
    await user.click(screen.getByTitle("刷新"));
    await waitFor(() => expect(orderRequestCount).toBe(2));

    act(() => useAuthStore.getState().setCurrentCompany("company-b"));
    await waitFor(() => expect(orderRequestCount).toBe(3));
    expect(screen.queryAllByRole("option", { name: /PO-A-OLD/ })).toHaveLength(
      0,
    );
    expect(
      screen.queryByRole("button", { name: "创建采购单" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      pendingBLoad.resolve({
        data: [purchaseOrder("order-b", "PO-B")],
      });
      await pendingBLoad.promise;
    });
    expect(
      await screen.findAllByRole("option", { name: /PO-B/ }),
    ).not.toHaveLength(0);

    act(() => useAuthStore.getState().setCurrentCompany("company-a"));
    expect(
      await screen.findAllByRole("option", { name: /PO-A-NEW/ }),
    ).not.toHaveLength(0);
    await act(async () => {
      staleARefresh.resolve({
        data: [purchaseOrder("order-a-stale", "PO-A-STALE")],
      });
      await staleARefresh.promise;
    });
    expect(screen.queryAllByRole("option", { name: /PO-A-STALE/ })).toHaveLength(
      0,
    );
    expect(
      screen.queryAllByRole("option", { name: /PO-A-NEW/ }),
    ).not.toHaveLength(0);
  });

  it("hides already-loaded company data immediately on a company switch", async () => {
    const pendingCompanyB = deferred<{
      data: ReturnType<typeof purchaseOrder>[];
    }>();
    let orderRequestCount = 0;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      orderRequestCount += 1;
      return orderRequestCount === 1
        ? Promise.resolve({ data: [purchaseOrder("order-a", "PO-A-PRIVATE")] })
        : pendingCompanyB.promise;
    });
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A-PRIVATE/ });

    act(() => useAuthStore.getState().setCurrentCompany("company-b"));
    await waitFor(() => expect(orderRequestCount).toBe(2));
    expect(
      screen.queryAllByRole("option", { name: /PO-A-PRIVATE/ }),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "创建采购单" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      pendingCompanyB.resolve({ data: [purchaseOrder("order-b", "PO-B")] });
      await pendingCompanyB.promise;
    });
    expect(
      await screen.findAllByRole("option", { name: /PO-B/ }),
    ).not.toHaveLength(0);
  });

  it("does not let a stale mutation unlock a new company action", async () => {
    const oldPost = deferred<{ data: { id: string } }>();
    const newPost = deferred<{ data: { id: string } }>();
    mockPost
      .mockImplementationOnce(() => oldPost.promise)
      .mockImplementationOnce(() => newPost.promise);
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      return Promise.resolve({
        data:
          useAuthStore.getState().currentCompanyId === "company-a"
            ? [purchaseOrder("order-a", "PO-A")]
            : [purchaseOrder("order-b", "PO-B")],
      });
    });
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A/ });

    const createOrder = screen.getByRole("button", { name: "创建采购单" });
    await user.click(createOrder);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));

    act(() => useAuthStore.getState().setCurrentCompany("company-b"));
    await screen.findAllByRole("option", { name: /PO-B/ });
    expect(screen.queryAllByRole("option", { name: /PO-A/ })).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建采购单" })).toBeEnabled(),
    );

    const createOrderInCompanyB = screen.getByRole("button", {
      name: "创建采购单",
    });
    await user.click(createOrderInCompanyB);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(createOrderInCompanyB).toBeDisabled();

    await act(async () => {
      oldPost.resolve({ data: { id: "old-company-order" } });
      await oldPost.promise;
    });
    expect(
      screen.getByRole("button", { name: "创建采购单" }),
    ).toBeDisabled();

    await act(async () => {
      newPost.resolve({ data: { id: "new-company-order" } });
      await newPost.promise;
    });
    expect(await screen.findByText("采购单已创建")).toBeInTheDocument();
  });

  it("invalidates a pending load when the signed-in user changes", async () => {
    const staleUserLoad = deferred<{ data: ReturnType<typeof purchaseOrder>[] }>();
    let orderRequestCount = 0;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      orderRequestCount += 1;
      if (orderRequestCount === 2) return staleUserLoad.promise;
      const purchaseNo =
        useAuthStore.getState().user?.id === "user-a"
          ? "PO-USER-A"
          : "PO-USER-B";
      return Promise.resolve({
        data: [purchaseOrder(`order-${purchaseNo}`, purchaseNo)],
      });
    });
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-USER-A/ });
    await user.click(screen.getByTitle("刷新"));
    await waitFor(() => expect(orderRequestCount).toBe(2));

    act(() => {
      useAuthStore
        .getState()
        .setAuth("user-b-token", { id: "user-b" }, companies);
    });
    expect(
      await screen.findAllByRole("option", { name: /PO-USER-B/ }),
    ).not.toHaveLength(0);
    await act(async () => {
      staleUserLoad.resolve({
        data: [purchaseOrder("stale-user-order", "PO-USER-A-STALE")],
      });
      await staleUserLoad.promise;
    });

    expect(
      screen.queryAllByRole("option", { name: /PO-USER-A-STALE/ }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole("option", { name: /PO-USER-B/ }),
    ).not.toHaveLength(0);
  });

  it("keeps the selected order's new invoice draft after an older order completes", async () => {
    const invoicePost = deferred<{ data: { id: string } }>();
    mockGet.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/purchase/orders"
            ? [
                purchaseOrder("order-a", "PO-A"),
                purchaseOrder("order-b", "PO-B"),
              ]
            : [],
      }),
    );
    mockPost.mockReturnValue(invoicePost.promise);
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A/ });

    const invoiceSelectors = screen
      .getAllByRole("combobox")
      .filter((element) =>
        Array.from((element as HTMLSelectElement).options).some((option) =>
          option.textContent?.includes("PO-A"),
        ),
      );
    const invoiceSelector = invoiceSelectors[1];
    const invoiceNo = screen.getByPlaceholderText("发票号（可选）");
    await user.type(invoiceNo, "INV-A-SUBMITTED");
    await user.click(screen.getByRole("button", { name: "生成应付发票" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(
      "/purchase/orders/order-a/invoice",
      { invoiceNo: "INV-A-SUBMITTED", dueDate: undefined },
    );

    await user.selectOptions(invoiceSelector, "order-b");
    await user.clear(invoiceNo);
    await user.type(invoiceNo, "INV-B-DRAFT");
    await act(async () => {
      invoicePost.resolve({ data: { id: "invoice-a" } });
      await invoicePost.promise;
    });

    expect(await screen.findByDisplayValue("INV-B-DRAFT")).toBeInTheDocument();
    expect(screen.queryByText("应付发票已生成")).not.toBeInTheDocument();
  });

  it("preserves another order's receipt edits when an earlier receipt finishes", async () => {
    const receiptPost = deferred<{ data: { id: string } }>();
    mockGet.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/purchase/orders"
            ? [
                purchaseOrder("order-a", "PO-A", 3, 0),
                purchaseOrder("order-b", "PO-B", 4, 0),
              ]
            : [],
      }),
    );
    mockPost.mockReturnValue(receiptPost.promise);
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A/ });

    const orderSelectors = screen
      .getAllByRole("combobox")
      .filter((element) =>
        Array.from((element as HTMLSelectElement).options).some((option) =>
          option.textContent?.includes("PO-A"),
        ),
      );
    const receiptSelector = orderSelectors[0];
    await user.click(screen.getByRole("button", { name: "过账收货" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(
      "/purchase/orders/order-a/receive",
      expect.any(Object),
    );

    const initialReceiveSection = screen
      .getByText("采购收货")
      .closest("section");
    if (!initialReceiveSection) {
      throw new Error("Purchase receipt section was not rendered");
    }
    expect(
      within(initialReceiveSection).getByRole("spinbutton"),
    ).toBeDisabled();
    expect(
      within(initialReceiveSection).getByPlaceholderText("批次号"),
    ).toBeDisabled();
    expect(
      within(initialReceiveSection).getByPlaceholderText("收货备注"),
    ).toBeDisabled();

    await user.selectOptions(receiptSelector, "order-b");
    const receiveSection = screen.getByText("采购收货").closest("section");
    if (!receiveSection) throw new Error("Purchase receipt section was not rendered");
    const receiveQuantity = within(receiveSection).getByRole("spinbutton");
    const batchNo = within(receiveSection).getByPlaceholderText("批次号");
    const receiveNote = within(receiveSection).getByPlaceholderText("收货备注");
    await user.clear(receiveQuantity);
    await user.type(receiveQuantity, "1.25");
    await user.type(batchNo, "B-BATCH-DRAFT");
    await user.type(receiveNote, "B receipt draft");

    await act(async () => {
      receiptPost.resolve({ data: { id: "receipt-a" } });
      await receiptPost.promise;
    });

    const refreshedReceiptSection = screen
      .getByText("采购收货")
      .closest("section");
    if (!refreshedReceiptSection) {
      throw new Error("Purchase receipt section was not rendered after refresh");
    }
    expect(
      within(refreshedReceiptSection).getByRole("spinbutton"),
    ).toHaveValue(1.25);
    expect(
      within(refreshedReceiptSection).getByPlaceholderText("批次号"),
    ).toHaveValue("B-BATCH-DRAFT");
    expect(
      within(refreshedReceiptSection).getByPlaceholderText("收货备注"),
    ).toHaveValue("B receipt draft");
    expect(
      screen.queryByText("采购收货已过账"),
    ).not.toBeInTheDocument();
  });

  it("rounds the remaining receipt quantity to the API's four decimal places", async () => {
    configureOrders([purchaseOrder("order-a", "PO-A", 0.3, 0.1)]);
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);

    await screen.findAllByRole("option", { name: /PO-A/ });
    await user.click(screen.getByRole("button", { name: "过账收货" }));

    await waitFor(() => {
      const receiveCall = mockPost.mock.calls.find(
        ([path]) => path === "/purchase/orders/order-a/receive",
      );
      expect(receiveCall?.[1].lines[0]).toMatchObject({
        purchaseOrderLineId: "order-a-line",
        quantity: 0.2,
        destLocationId: "location-1",
      });
    });
  });

  it("allows a same-scope token rotation while a load is pending", async () => {
    const pendingOrders = deferred<{ data: ReturnType<typeof purchaseOrder>[] }>();
    mockGet.mockImplementation((path: string) =>
      path === "/purchase/orders"
        ? pendingOrders.promise
        : Promise.resolve({ data: [] }),
    );
    const contextVersion = useAuthStore.getState().contextVersion;
    render(<PurchaseWorkbench />);
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith("/purchase/orders"),
    );

    act(() => {
      useAuthStore
        .getState()
        .setAuth("token-rotated", { id: "user-a" }, companies);
    });
    expect(useAuthStore.getState().contextVersion).toBe(contextVersion);
    await act(async () => {
      pendingOrders.resolve({
        data: [purchaseOrder("order-a", "PO-A")],
      });
      await pendingOrders.promise;
    });

    expect(
      await screen.findAllByRole("option", { name: /PO-A/ }),
    ).not.toHaveLength(0);
  });

  it("ignores a pending load after the workbench unmounts", async () => {
    const pendingOrders = deferred<{ data: ReturnType<typeof purchaseOrder>[] }>();
    mockGet.mockImplementation((path: string) =>
      path === "/purchase/orders"
        ? pendingOrders.promise
        : Promise.resolve({ data: [] }),
    );
    const { unmount } = render(<PurchaseWorkbench />);
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith("/purchase/orders"),
    );
    unmount();

    await act(async () => {
      pendingOrders.resolve({
        data: [purchaseOrder("order-a", "PO-A")],
      });
      await pendingOrders.promise;
    });
  });

  it("does not update state or refresh after a mutation resolves after unmount", async () => {
    const pendingPost = deferred<{ data: { id: string } }>();
    mockPost.mockReturnValue(pendingPost.promise);
    const user = userEvent.setup();
    const { unmount } = render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A-OLD/ });
    await user.click(screen.getByRole("button", { name: "创建采购单" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      pendingPost.resolve({ data: { id: "created-after-unmount" } });
      await pendingPost.promise;
    });
    expect(
      mockGet.mock.calls.filter(([path]) => path === "/purchase/orders"),
    ).toHaveLength(1);
  });

  it("reports a successful save if its follow-up refresh fails", async () => {
    let orderRequestCount = 0;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      orderRequestCount += 1;
      if (orderRequestCount === 2) {
        return Promise.reject(new Error("refresh unavailable"));
      }
      return Promise.resolve({ data: [purchaseOrder("order-a", "PO-A")] });
    });
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A/ });

    await user.click(screen.getByRole("button", { name: "创建采购单" }));

    expect(await screen.findByText("采购单已创建")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "采购数据加载失败",
    );
    expect(
      screen.queryByRole("button", { name: "创建采购单" }),
    ).not.toBeInTheDocument();
  });

  it("blocks two synchronous clicks from submitting the same action twice", async () => {
    const post = deferred<{ data: { id: string } }>();
    mockPost.mockReturnValue(post.promise);
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A-OLD/ });

    const createOrder = screen.getByRole("button", { name: "创建采购单" });
    act(() => {
      fireEvent.click(createOrder);
      fireEvent.click(createOrder);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      post.resolve({ data: { id: "created-order" } });
      await post.promise;
    });
  });

  it("keeps stale collections unavailable after refresh failure and retries", async () => {
    let orderRequestCount = 0;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/purchase/orders") return Promise.resolve({ data: [] });
      orderRequestCount += 1;
      if (orderRequestCount === 2) {
        return Promise.reject(new Error("network unavailable"));
      }
      return Promise.resolve({
        data: [
          purchaseOrder(
            "order-a",
            orderRequestCount === 1 ? "PO-A-OLD" : "PO-A-REFRESHED",
          ),
        ],
      });
    });
    const user = userEvent.setup();
    render(<PurchaseWorkbench />);
    await screen.findAllByRole("option", { name: /PO-A-OLD/ });

    await user.click(screen.getByTitle("刷新"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "采购数据加载失败",
    );
    expect(
      screen.queryAllByRole("option", { name: /PO-A-OLD/ }),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "创建采购单" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(
      await screen.findAllByRole("option", { name: /PO-A-REFRESHED/ }),
    ).not.toHaveLength(0);
  });
});
