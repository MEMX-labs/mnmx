// ─────────────────────────────────────────────────────────────
// Chain Registry
// ─────────────────────────────────────────────────────────────

import type { Chain, ChainConfig, Token } from '../types/index.js';
import { ALL_CHAINS } from '../types/index.js';
import { ETHEREUM_CONFIG, ETHEREUM_TOKENS } from './ethereum.js';
import { SOLANA_CONFIG, SOLANA_TOKENS } from './solana.js';
import { ARBITRUM_CONFIG, ARBITRUM_TOKENS } from './arbitrum.js';

/**
 * Complete chain configuration registry.
 */
export const CHAIN_CONFIGS: Record<Chain, ChainConfig> = {
  ethereum: ETHEREUM_CONFIG,
  solana: SOLANA_CONFIG,
  arbitrum: ARBITRUM_CONFIG,
  base: {
    rpc: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    nativeCurrency: 'ETH',
    chainId: 8453,
    avgBlockTime: 2,
    finalityTime: 900,
    isEvm: true,
    tokens: [
      { symbol: 'ETH', chain: 'base', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'Ether', isNative: true },
      { symbol: 'USDC', chain: 'base', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin' },
      { symbol: 'WETH', chain: 'base', decimals: 18, address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether' },
    ],
  },
  polygon: {
    rpc: 'https://polygon-rpc.com',
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: 'MATIC',
    chainId: 137,
    avgBlockTime: 2,
    finalityTime: 120,
    isEvm: true,
    tokens: [
      { symbol: 'MATIC', chain: 'polygon', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'Polygon', isNative: true },
      { symbol: 'USDC', chain: 'polygon', decimals: 6, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', name: 'USD Coin' },
      { symbol: 'USDT', chain: 'polygon', decimals: 6, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', name: 'Tether USD' },
      { symbol: 'WETH', chain: 'polygon', decimals: 18, address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', name: 'Wrapped Ether' },
    ],
  },
  bnb: {
    rpc: 'https://bsc-dataseed.binance.org',
    blockExplorer: 'https://bscscan.com',
    nativeCurrency: 'BNB',
    chainId: 56,
    avgBlockTime: 3,
    finalityTime: 45,
    isEvm: true,
    tokens: [
      { symbol: 'BNB', chain: 'bnb', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'BNB', isNative: true },
      { symbol: 'USDC', chain: 'bnb', decimals: 18, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', name: 'USD Coin' },
      { symbol: 'USDT', chain: 'bnb', decimals: 18, address: '0x55d398326f99059fF775485246999027B3197955', name: 'Tether USD' },
      { symbol: 'WETH', chain: 'bnb', decimals: 18, address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', name: 'Wrapped Ether' },
    ],
  },
  optimism: {
    rpc: 'https://mainnet.optimism.io',
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeCurrency: 'ETH',
    chainId: 10,
    avgBlockTime: 2,
    finalityTime: 900,
    isEvm: true,
    tokens: [
      { symbol: 'ETH', chain: 'optimism', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'Ether', isNative: true },
      { symbol: 'USDC', chain: 'optimism', decimals: 6, address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', name: 'USD Coin' },
      { symbol: 'WETH', chain: 'optimism', decimals: 18, address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether' },
      { symbol: 'OP', chain: 'optimism', decimals: 18, address: '0x4200000000000000000000000000000000000042', name: 'Optimism' },
    ],
  },
  avalanche: {
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    blockExplorer: 'https://snowtrace.io',
    nativeCurrency: 'AVAX',
    chainId: 43114,
    avgBlockTime: 2,
    finalityTime: 5,
    isEvm: true,
    tokens: [
      { symbol: 'AVAX', chain: 'avalanche', decimals: 18, address: '0x0000000000000000000000000000000000000000', name: 'Avalanche', isNative: true },
      { symbol: 'USDC', chain: 'avalanche', decimals: 6, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', name: 'USD Coin' },
      { symbol: 'USDT', chain: 'avalanche', decimals: 6, address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', name: 'Tether USD' },
      { symbol: 'WETH', chain: 'avalanche', decimals: 18, address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', name: 'Wrapped Ether' },
    ],
  },
};

/**
 * Get the configuration for a specific chain.
 */
export function getChainConfig(chain: Chain): ChainConfig {
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    throw new Error(`Unknown chain: ${chain}`);
  }
  return config;
}

/**
 * Check if a string is a supported chain name.
 */
export function isChainSupported(chain: string): chain is Chain {
  return ALL_CHAINS.includes(chain as Chain);
}

/**
 * Look up a chain by its numeric chain ID.
 */
export function getChainById(chainId: number): Chain | undefined {
  for (const [chain, config] of Object.entries(CHAIN_CONFIGS)) {
    if (config.chainId === chainId) return chain as Chain;
  }
  return undefined;
}

/**
 * Return all supported chains.
 */
export function getAllChains(): Chain[] {
  return [...ALL_CHAINS];
}

/**
 * Get the native currency symbol for a chain.
 */
export function getNativeCurrency(chain: Chain): string {
  return getChainConfig(chain).nativeCurrency;
}

/**
 * Find a token by symbol on a given chain.
 */
export function findToken(chain: Chain, symbol: string): Token | undefined {
  const config = getChainConfig(chain);
  const tokens = config.tokens || [];
  return tokens.find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase()
  );
}

/**
 * Get all known tokens for a chain.
 */
export function getChainTokens(chain: Chain): Token[] {
  const config = getChainConfig(chain);
  return config.tokens || [];
}

export { ETHEREUM_CONFIG, ETHEREUM_TOKENS } from './ethereum.js';
export { SOLANA_CONFIG, SOLANA_TOKENS } from './solana.js';
export { ARBITRUM_CONFIG, ARBITRUM_TOKENS } from './arbitrum.js';
