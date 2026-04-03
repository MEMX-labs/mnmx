export interface SearchStats {
  candidatesFound: number;
  candidatesEvaluated: number;
  prunedBranches: number;
  scenariosPerCandidate: number;
  searchTimeMs: number;
  strategy: string;
}

export function createSearchStats(partial: Partial<SearchStats>): SearchStats {
  return {
    candidatesFound: partial.candidatesFound ?? 0,
    candidatesEvaluated: partial.candidatesEvaluated ?? 0,
    prunedBranches: partial.prunedBranches ?? 0,
    scenariosPerCandidate: partial.scenariosPerCandidate ?? 5,
    searchTimeMs: partial.searchTimeMs ?? 0,
    strategy: partial.strategy ?? 'minimax',
  };
}
