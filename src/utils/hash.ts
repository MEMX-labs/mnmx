/**
 * MNMX Zobrist-Style State Hashing
 *
 * Provides fast, incremental hashing for on-chain game states.  Inspired by
 * Zobrist hashing from computer chess, we pre-generate random 64-bit keys
 * for each state component and XOR them together.  This gives us O(1)
 * incremental updates when a single field changes.
 */

import type { OnChainState, StateChange } from '../types/index.js';

// ── Constants ───────────────────────────────────────────────────────

const ZOBRIST_TABLE_SLOTS = 1024;
const ZOBRIST_SALT_COUNT = 4;

// ── Pseudo-random BigInt Generator ──────────────────────────────────

/**
 * Simple splitmix64-style PRNG that produces deterministic 64-bit BigInts
 * from a seed.  Determinism is important so that identical state always
 * maps to the identical hash across engine runs.
 */
function splitmix64(seed: bigint): { value: bigint; next: bigint } {
  let z = seed + 0x9e3779b97f4a7c15n;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
  z = z ^ (z >> 31n);
  // Mask to 64-bit unsigned
  const value = z & 0xffffffffffffffffn;
  return { value, next: seed + 0x9e3779b97f4a7c15n };
}

// ── Zobrist Table ───────────────────────────────────────────────────

/** The pre-computed table of random keys, indexed by bucket. */
export interface ZobristTable {
  /** Random keys for token-balance buckets. */
  balanceKeys: bigint[];
  /** Random keys for pool-reserve buckets. */
  reserveKeys: bigint[];
  /** Random keys for slot values. */
  slotKeys: bigint[];
  /** Salts mixed in per component type to break symmetry. */
  salts: bigint[];
}

/**
 * Initialise the Zobrist table.  Call once at engine startup and pass
 * the table into hashing functions.
 */
export function initZobristTable(seed: bigint = 0xdeadbeef_cafebaben): ZobristTable {
  const balanceKeys: bigint[] = [];
  const reserveKeys: bigint[] = [];
  const slotKeys: bigint[] = [];
  const salts: bigint[] = [];

  let currentSeed = seed;

  const next = (): bigint => {
    const r = splitmix64(currentSeed);
    currentSeed = r.next;
    return r.value;
  };

  for (let i = 0; i < ZOBRIST_TABLE_SLOTS; i++) {
    balanceKeys.push(next());
  }
  for (let i = 0; i < ZOBRIST_TABLE_SLOTS; i++) {
    reserveKeys.push(next());
  }
  for (let i = 0; i < ZOBRIST_TABLE_SLOTS; i++) {
    slotKeys.push(next());
  }
  for (let i = 0; i < ZOBRIST_SALT_COUNT; i++) {
    salts.push(next());
  }

  return { balanceKeys, reserveKeys, slotKeys, salts };
}

// ── Internal Helpers ────────────────────────────────────────────────

/** Deterministic bucket index for a string key. */
function bucketIndex(key: string, tableSize: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % tableSize;
}

/** Mix a bigint value into a hash using XOR rotation. */
function mixValue(hash: bigint, key: bigint, value: bigint): bigint {
  // Rotate the value with the key before XOR-ing into accumulator
  const mixed = key ^ ((value * 0x517cc1b727220a95n) & 0xffffffffffffffffn);
  return hash ^ mixed;
}

// ── Full State Hash ─────────────────────────────────────────────────

/** Global (lazily initialised) Zobrist table. */
let _globalTable: ZobristTable | null = null;
