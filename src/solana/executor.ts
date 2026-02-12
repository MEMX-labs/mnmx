/**
 * MNMX Plan Executor
 *
 * Translates an ExecutionPlan produced by the minimax engine into
 * real Solana transactions, simulates them, and submits to the cluster
 * with retry logic, priority-fee injection, and compute-budget tuning.
 */

import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  PublicKey,
  ComputeBudgetProgram,
  type TransactionSignature,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type {
  ExecutionAction,
  ExecutionPlan,
  ExecutionResult,
  SimulationResult,
} from '../types/index.js';

// ── Constants ───────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const CONFIRMATION_TIMEOUT_MS = 30_000;
const DEFAULT_COMPUTE_UNITS = 400_000;
const DEFAULT_PRIORITY_MICRO_LAMPORTS = 5_000;

// ── Executor ────────────────────────────────────────────────────────

export class PlanExecutor {
  private readonly connection: Connection;
  private readonly wallet: Keypair;

  constructor(connection: Connection, wallet: Keypair) {
    this.connection = connection;
    this.wallet = wallet;
  }

  /**
   * Execute every action in the plan sequentially.  Returns an
   * aggregate result covering all submitted transactions.
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const signatures: string[] = [];
    const errors: string[] = [];
    let totalCompute = 0;
    let totalFees = 0n;

    for (const action of plan.actions) {
      try {
        const tx = await this.buildTransaction(action);
        const simResult = await this.simulateTransaction(tx);

        if (!simResult.success) {
          errors.push(
            `Simulation failed for ${action.kind}: ${simResult.error ?? 'unknown'}`,
          );
          continue;
        }

        // Adjust compute budget based on simulation
        const adjustedTx = this.adjustComputeBudget(
          tx,
          simResult.computeUnitsConsumed,
        );

        const sig = await this.signAndSend(adjustedTx);
        signatures.push(sig);
        totalCompute += simResult.computeUnitsConsumed;
        totalFees += BigInt(simResult.computeUnitsConsumed) * BigInt(DEFAULT_PRIORITY_MICRO_LAMPORTS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Execution failed for ${action.kind}: ${msg}`);
      }
    }

    return {
      success: errors.length === 0 && signatures.length > 0,
      signatures,
      errors,
      actualSlippageBps: 0, // would need post-tx analysis to compute
      computeUnitsUsed: totalCompute,
      totalFeeLamports: totalFees,
    };
  }

  /**
   * Build a transaction for a single execution action.
   *
   * In a production system each action kind would construct the
   * appropriate program instruction (e.g., Jupiter swap, Marinade
   * stake).  Here we build a skeleton transaction with compute-budget
   * and priority-fee instructions, plus a placeholder instruction
   * that encodes the action parameters.
   */
  async buildTransaction(action: ExecutionAction): Promise<Transaction> {
    const tx = new Transaction();

    // 1. Compute budget
    tx.add(this.createComputeBudgetInstruction(DEFAULT_COMPUTE_UNITS));

    // 2. Priority fee
    tx.add(this.createPriorityFeeInstruction(DEFAULT_PRIORITY_MICRO_LAMPORTS));

    // 3. Action-specific instruction
    const actionIx = this.buildActionInstruction(action);
    tx.add(actionIx);

    // Fetch recent blockhash
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.wallet.publicKey;

    return tx;
  }

  /**
   * Simulate a transaction without submitting it.
   */
  async simulateTransaction(tx: Transaction): Promise<SimulationResult> {
    try {
      const result = await this.connection.simulateTransaction(tx);
      const value = result.value;

      return {
        success: value.err === null,
        computeUnitsConsumed: value.unitsConsumed ?? DEFAULT_COMPUTE_UNITS,
        logs: value.logs ?? [],
        error: value.err ? JSON.stringify(value.err) : null,
        returnData: value.returnData
          ? new Uint8Array(Buffer.from(value.returnData.data[0], 'base64'))
          : null,
      };
    } catch (err) {
      return {
        success: false,
        computeUnitsConsumed: 0,
        logs: [],
        error: err instanceof Error ? err.message : String(err),
        returnData: null,
      };
    }
  }

  // ── Private: Instruction Builders ───────────────────────────────

  private createComputeBudgetInstruction(
    units: number,
  ): TransactionInstruction {
    return ComputeBudgetProgram.setComputeUnitLimit({ units });
  }

  private createPriorityFeeInstruction(
    microLamports: number,
  ): TransactionInstruction {
    return ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
  }

  /**
   * Build a placeholder instruction that encodes the action's intent.
   * A production integration would invoke the actual on-chain program
   * (e.g., Raydium, Orca, Marinade) with properly serialised args.
   */
  private buildActionInstruction(
    action: ExecutionAction,
  ): TransactionInstruction {
    const data = Buffer.alloc(64);
    // Encode action kind as first byte
    const kindIndex = ACTION_KIND_INDICES[action.kind] ?? 0;
    data.writeUInt8(kindIndex, 0);
    // Encode amount as LE u64 at offset 8
    data.writeBigUInt64LE(action.amount, 8);
    // Encode slippage at offset 16
    data.writeUInt16LE(action.slippageBps, 16);

    const poolKey = safePublicKey(action.pool);
    const mintInKey = safePublicKey(action.tokenMintIn);
    const mintOutKey = safePublicKey(action.tokenMintOut);

    return new TransactionInstruction({
      keys: [
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: poolKey, isSigner: false, isWritable: true },
        { pubkey: mintInKey, isSigner: false, isWritable: false },
        { pubkey: mintOutKey, isSigner: false, isWritable: false },
      ],
      programId: SystemProgram.programId,
      data,
    });
  }

  // ── Private: Signing & Sending ──────────────────────────────────

  /**
   * Sign and send the transaction with exponential-backoff retry.
   */
  private async signAndSend(tx: Transaction): Promise<TransactionSignature> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const sig = await sendAndConfirmTransaction(
          this.connection,
          tx,
          [this.wallet],
          {
            commitment: 'confirmed',
            maxRetries: 2,
          },
        );
        return sig;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Exponential backoff: 500ms, 1000ms, 2000ms …
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);

        // Re-fetch blockhash for next attempt
        try {
          const { blockhash, lastValidBlockHeight } =
            await this.connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.lastValidBlockHeight = lastValidBlockHeight;
        } catch {
          // If blockhash fetch fails, try with old one
        }
      }
    }

    throw lastError ?? new Error('Transaction submission failed after retries');
  }

  /**
   * Re-create the compute-budget instruction with actual usage plus a
   * safety margin.
   */
  private adjustComputeBudget(
    tx: Transaction,
    simulatedUnits: number,
  ): Transaction {
    const adjusted = new Transaction();
    const targetUnits = Math.ceil(simulatedUnits * 1.2); // 20% margin

    // Replace the first instruction (compute budget) if present
    let replacedBudget = false;
    for (const ix of tx.instructions) {
      if (
        !replacedBudget &&
        ix.programId.equals(ComputeBudgetProgram.programId)
      ) {
        adjusted.add(this.createComputeBudgetInstruction(targetUnits));
        replacedBudget = true;
      } else {
        adjusted.add(ix);
      }
    }

    adjusted.recentBlockhash = tx.recentBlockhash;
    adjusted.lastValidBlockHeight = tx.lastValidBlockHeight;
    adjusted.feePayer = tx.feePayer;

    return adjusted;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safely create a PublicKey, falling back to system program. */
function safePublicKey(address: string): PublicKey {
  try {
    return new PublicKey(address);
  } catch {
    return SystemProgram.programId;
  }
}

const ACTION_KIND_INDICES: Record<string, number> = {
  swap: 1,
  transfer: 2,
  stake: 3,
  unstake: 4,
  liquidate: 5,
  provide_liquidity: 6,
  remove_liquidity: 7,
  borrow: 8,
  repay: 9,
};
