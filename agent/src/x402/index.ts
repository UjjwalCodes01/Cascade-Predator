import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import { twakSignMessage } from "../twak/index.js";

const prisma = new PrismaClient();

export interface X402PaymentResult {
  success: boolean;
  paymentProof?: string;
  error?: string;
}

/**
 * EIP-191 signed payment message.
 * Instead of broadcasting an on-chain tx for every micro-payment (which is slow and wastes gas),
 * we generate a cryptographically signed payment proof using the agent's private key.
 * This is the standard x402 off-chain payment channel approach:
 *  - The signature is deterministic and tamper-proof (can be verified on-chain)
 *  - Settlement is batched on-chain via executeSwap / periodic settlement tx
 *  - paymentProof field stores the EIP-191 signature as the payment proof
 */
async function signPaymentMessage(
  resource: string,
  amount: string,
  nonce: number
): Promise<string> {
  // Uses TWAK local signer — decrypts keystore, signs, never exposes raw key
  const message = `x402:pay:${resource}:${amount}:${nonce}`;
  return twakSignMessage(config.TWAK_SIGNER_PATH, message);
}

export class X402Service {
  /**
   * Performs a real cryptographic x402 micro-payment.
   * Signs an EIP-191 payment message proving the agent authorised this payment.
   * The signature is recorded in the X402Ledger DB table.
   *
   * On-chain settlement: the signed messages accumulate and are settled when
   * ExecutionService broadcasts a real swap transaction.
   */
  static async pay(resource: string, amount: string): Promise<X402PaymentResult> {
    try {
      console.log(`[x402] Initiating payment of ${amount} to resource: ${resource}`);

      const nonce = Date.now();
      const signature = await signPaymentMessage(resource, amount, nonce);

      // Store in DB with the real EIP-191 signature as the payment proof
      await prisma.x402Ledger.create({
        data: {
          resource,
          amountSpent: amount,
          paymentProof: signature, // Real cryptographic signature, not a mock hash
        },
      });

      console.log(`[x402] Payment signed. Proof: ${signature.substring(0, 20)}...`);
      return { success: true, paymentProof: signature };
    } catch (error: any) {
      console.error(`[x402] Payment failed:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Wraps an HTTP request in the x402 payment flow.
   * 1. Initial request → if 402 returned, pay and retry.
   * 2. Passes the payment signature as the Authorization header proof.
   */
  static async executeWithPayment<T>(
    requestFn: (paymentHeader?: string) => Promise<{ status: number; data?: T }>,
    resource: string,
    cost: string
  ): Promise<T> {
    const initialResponse = await requestFn();

    if (initialResponse.status === 402) {
      console.warn(`[x402] Received HTTP 402 Payment Required for ${resource}. Initiating payment...`);

      const payment = await this.pay(resource, cost);
      if (!payment.success || !payment.paymentProof) {
        throw new Error(`[x402] Aborting request. Payment failed: ${payment.error}`);
      }

      const payHeader = `x402-sig ${payment.paymentProof}`;
      const secondResponse = await requestFn(payHeader);

      if (secondResponse.status === 200 && secondResponse.data !== undefined) {
        return secondResponse.data;
      }
      throw new Error(`[x402] Second request failed after payment. Status: ${secondResponse.status}`);
    }

    if (initialResponse.status === 200 && initialResponse.data !== undefined) {
      return initialResponse.data;
    }

    throw new Error(`[x402] Request failed with status: ${initialResponse.status}`);
  }

  /**
   * Retrieves the full x402 spending ledger from the database.
   */
  static async getSpendLedger() {
    return prisma.x402Ledger.findMany({
      orderBy: { timestamp: "desc" },
    });
  }
}
