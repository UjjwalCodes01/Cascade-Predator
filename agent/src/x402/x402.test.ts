import { X402Service } from "./index.js";

// Mock Prisma client to keep tests offline-safe and database-independent
jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        x402Ledger: {
          create: jest.fn().mockResolvedValue({ id: "mock-ledger-id" }),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
    }),
  };
});

describe("X402Service", () => {
  it("should successfully trigger a simulated payment log", async () => {
    const result = await X402Service.pay("test-api-endpoint", "0.001");
    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(result.txHash).toContain("0x");
  });

  it("should handle HTTP 402 cycle, execute payment, and return resolved data on retry", async () => {
    let callCount = 0;
    
    // Simulate an endpoint function that requires payment on first call
    const mockRequestFn = jest.fn().mockImplementation(async (paymentHeader?: string) => {
      callCount++;
      if (!paymentHeader) {
        return { status: 402 };
      }
      return { status: 200, data: { success: true, payload: "premium-content" } };
    });

    const data = await X402Service.executeWithPayment(
      mockRequestFn,
      "test-premium-resource",
      "0.0005"
    );

    expect(data).toEqual({ success: true, payload: "premium-content" });
    expect(callCount).toBe(2); // Should have called once, got 402, paid, then called again
    expect(mockRequestFn).toHaveBeenNthCalledWith(1);
    expect(mockRequestFn).toHaveBeenNthCalledWith(2, expect.stringContaining("x402-sig 0x"));
  });
});
