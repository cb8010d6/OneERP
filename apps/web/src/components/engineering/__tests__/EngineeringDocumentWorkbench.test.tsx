import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EngineeringDocumentWorkbench } from "../EngineeringDocumentWorkbench";
import { useAuthStore } from "@/store/authStore";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock("@/components/core/AsyncSelect", () => ({
  AsyncSelect: ({
    id,
    onChange,
  }: {
    id: string;
    onChange: (value: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange(id.includes("product") ? "product-1" : "order-1")}
    >
      {id.includes("product") ? "选择产品" : "选择订单"}
    </button>
  ),
}));

describe("EngineeringDocumentWorkbench", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      token: "token",
      user: { id: "designer-1" },
      companies: [
        {
          id: "company-1",
          name: "测试公司",
          role: "EngineeringDesign",
          permissions: [
            "engineeringDocument:read",
            "engineeringDocument:create",
            "fileRecord:create",
          ],
        },
      ],
      currentCompanyId: "company-1",
    });
    mockGet.mockResolvedValue({ data: [] });
    mockPost
      .mockResolvedValueOnce({ data: { id: "file-1", checksumSha256: "abc" } })
      .mockResolvedValueOnce({ data: { id: "document-1" } });
  });

  it("uploads a file and creates a linked engineering document", async () => {
    const user = userEvent.setup();
    render(<EngineeringDocumentWorkbench />);

    await user.click(screen.getByText("新建工程文档"));
    await user.type(screen.getByLabelText("文档标题"), "总装图");
    await user.click(screen.getByText("选择产品"));
    await user.upload(
      screen.getByLabelText("版本文件"),
      new File(["drawing"], "assembly.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByText("创建草稿版本"));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/engineering-documents",
        expect.objectContaining({
          title: "总装图",
          productId: "product-1",
          fileRecordId: "file-1",
        }),
      );
    });
  });

  it("reviews a pending revision from the workbench", async () => {
    useAuthStore.setState({
      companies: [
        {
          id: "company-1",
          name: "测试公司",
          role: "EngineeringReview",
          permissions: [
            "engineeringDocument:read",
            "engineeringDocument:review",
          ],
        },
      ],
    });
    mockGet.mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === "/engineering-change-orders"
            ? []
            : [
                {
                  id: "document-1",
                  documentNo: "ED-P1001-000001",
                  title: "总装图",
                  documentType: "DRAWING",
                  currentRevisionNo: 1,
                  currentReleasedRevisionId: null,
                  updatedAt: "2026-07-12T00:00:00.000Z",
                  product: { id: "product-1", sku: "P-1001", name: "设备" },
                  order: null,
                  revisions: [
                    {
                      id: "revision-1",
                      revisionNo: 1,
                      status: "PENDING_REVIEW",
                      checksumSha256: "a".repeat(64),
                      createdAt: "2026-07-12T00:00:00.000Z",
                      fileRecord: {
                        id: "file-1",
                        fileName: "assembly.pdf",
                        objectKey: "company-1/engineering/assembly.pdf",
                      },
                      creator: { id: "designer-1", name: "设计员" },
                      reviewer: null,
                      approver: null,
                    },
                  ],
                },
              ],
      }),
    );
    mockPost.mockResolvedValue({ data: { status: "PENDING_APPROVAL" } });
    const user = userEvent.setup();
    render(<EngineeringDocumentWorkbench />);

    expect(await screen.findByText("开始校审")).toBeInTheDocument();
    await user.click(screen.getByText("开始校审"));
    await user.type(screen.getByLabelText("校审意见"), "尺寸和材料符合要求");
    await user.click(screen.getByText("校审通过"));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/engineering-documents/revisions/revision-1/review",
        {
          decision: "APPROVE",
          comment: "尺寸和材料符合要求",
        },
      );
    });
  });

  it("creates and submits an ECO with an explicit work order disposition", async () => {
    useAuthStore.setState({
      companies: [
        {
          id: "company-1",
          name: "测试公司",
          role: "EngineeringDesign",
          permissions: [
            "engineeringDocument:read",
            "engineeringDocument:create",
            "engineeringDocument:approve",
          ],
        },
      ],
    });
    const document = {
      id: "document-1",
      documentNo: "ED-P1001-000001",
      title: "总装图",
      documentType: "DRAWING",
      currentRevisionNo: 2,
      currentReleasedRevisionId: "revision-old",
      updatedAt: "2026-07-12T00:00:00.000Z",
      product: { id: "product-1", sku: "P-1001", name: "设备" },
      order: null,
      revisions: [
        {
          id: "revision-new",
          revisionNo: 2,
          status: "PENDING_APPROVAL",
          checksumSha256: "b".repeat(64),
          createdAt: "2026-07-12T00:00:00.000Z",
          fileRecord: {
            id: "file-2",
            fileName: "r02.pdf",
            objectKey: "r02.pdf",
          },
          creator: { id: "designer-1", name: "设计员" },
          reviewer: { id: "reviewer-1", name: "校审员" },
          approver: null,
        },
      ],
    };
    mockGet.mockImplementation((url: string) => {
      if (url === "/engineering-documents")
        return Promise.resolve({ data: [document] });
      if (url === "/engineering-change-orders")
        return Promise.resolve({ data: [] });
      if (url.includes("/engineering-change-orders/preview/")) {
        return Promise.resolve({
          data: {
            sourceRevision: { id: "revision-old", revisionNo: 1 },
            targetRevision: { id: "revision-new", revisionNo: 2 },
            affectedWorkOrders: [
              {
                id: "wo-1",
                workOrderNo: "WO-001",
                status: "IN_PROGRESS",
                plannedQty: 10,
                actualQty: 2,
                product: { id: "product-1", sku: "P-1001", name: "设备" },
                order: { id: "order-1", orderNo: "SO-001" },
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    mockPost.mockReset();
    mockPost
      .mockResolvedValueOnce({ data: { id: "eco-1" } })
      .mockResolvedValueOnce({
        data: { id: "eco-1", status: "PENDING_APPROVAL" },
      });
    const user = userEvent.setup();
    render(<EngineeringDocumentWorkbench />);

    await user.click(await screen.findByText("影响评估 / ECO"));
    await screen.findByText(/影响在制工单 1 张/);
    await user.type(screen.getByLabelText("变更原因"), "客户要求更新尺寸");
    await user.type(screen.getByLabelText("影响评估"), "影响一张在制工单");
    await user.type(screen.getByLabelText("物料处置"), "旧料隔离");
    await user.click(screen.getByText("创建并提交工程变更单"));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/engineering-change-orders/document-1",
        expect.objectContaining({
          targetRevisionId: "revision-new",
          impacts: [{ workOrderId: "wo-1", decision: "SWITCH_NEW" }],
        }),
      );
      expect(mockPost).toHaveBeenCalledWith(
        "/engineering-change-orders/eco-1/submit",
        {},
      );
    });
  });
});
