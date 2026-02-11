/**
 * MNMX Solana State Reader
 *
 * Reads relevant on-chain state from a Solana cluster and packages it
 * into the engine's OnChainState format.  Handles token accounts,
 * liquidity-pool reserves, recent transactions, and slot tracking.
 */

import {
  Connection,
  PublicKey,
  type AccountInfo,
  type ParsedAccountData,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { OnChainState, PendingTx, PoolState } from '../types/index.js';

// ── Constants ───────────────────────────────────────────────────────

/** Layout byte-offsets for a generic Raydium-style AMM pool account. */
const POOL_RESERVE_OFFSET_A = 64;
const POOL_RESERVE_OFFSET_B = 72;
const POOL_FEE_OFFSET = 80;
const POOL_MINT_A_OFFSET = 8;
const POOL_MINT_B_OFFSET = 40;

// ── State Reader ────────────────────────────────────────────────────

export class StateReader {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Fetch a complete snapshot of on-chain state relevant to the given
   * wallet and set of liquidity pools.
   */
  async getOnChainState(
    walletAddress: PublicKey,
    pools: PublicKey[],
  ): Promise<OnChainState> {
    const [tokenBalances, poolStates, pendingTxs, slot] = await Promise.all([
      this.getTokenBalances(walletAddress),
      this.getAllPoolStates(pools),
      this.getRecentTransactions(25),
      this.getCurrentSlot(),
    ]);

    return {
      tokenBalances,
      poolStates,
      pendingTransactions: pendingTxs,
      slot,
      timestamp: Date.now(),
    };
  }

  /**
   * Fetch all SPL token balances for a wallet, keyed by mint address.
   */
  async getTokenBalances(wallet: PublicKey): Promise<Map<string, bigint>> {
    const balances = new Map<string, bigint>();

    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        wallet,
        { programId: TOKEN_PROGRAM_ID },
      );

      for (const { account } of tokenAccounts.value) {
        const parsed = account.data as ParsedAccountData;
        const info = parsed.parsed?.info;
        if (!info) continue;

        const mint: string = info.mint;
        const amountStr: string = info.tokenAmount?.amount ?? '0';
        const amount = BigInt(amountStr);

        // Accumulate in case of multiple ATAs for the same mint
        const existing = balances.get(mint) ?? 0n;
        balances.set(mint, existing + amount);
      }

      // Also include native SOL balance
      const lamports = await this.connection.getBalance(wallet);
      balances.set('SOL', BigInt(lamports));
    } catch (err) {
      // Return whatever we managed to collect
      console.error('[StateReader] getTokenBalances error:', err);
    }

    return balances;
  }
