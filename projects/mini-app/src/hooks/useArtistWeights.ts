import { useState, useMemo, useCallback } from 'react';

interface UseArtistWeightsOptions {
  artistIds: string[];
  onWeightsChange?: (weights: Map<string, number>) => void;
}

interface UseArtistWeightsReturn {
  weights: Map<string, number>;
  hasCustomWeights: boolean;
  totalWeight: number;
  isWeightValid: boolean;
  displayPercentages: Map<string, number>;
  setWeight: (artistId: string, weight: number) => void;
  setWeights: (weights: Map<string, number>) => void;
  enableCustomWeights: () => void;
  resetToEqual: () => void;
  removeArtist: (artistId: string) => void;
}

export function useArtistWeights({ artistIds, onWeightsChange }: UseArtistWeightsOptions): UseArtistWeightsReturn {
  const [weights, setWeightsState] = useState<Map<string, number>>(new Map());

  const hasCustomWeights = weights.size > 0;

  const totalWeight = useMemo(() => {
    if (!hasCustomWeights || artistIds.length === 0) return 100;
    return artistIds.reduce(
      (sum, id) => sum + (weights.get(id) || 0),
      0
    );
  }, [weights, artistIds, hasCustomWeights]);

  const isWeightValid = !hasCustomWeights || totalWeight === 100;

  const displayPercentages = useMemo(() => {
    const count = artistIds.length;
    if (count === 0) return new Map<string, number>();

    if (!hasCustomWeights) {
      const equal = Math.round(100 / count);
      const result = new Map<string, number>();
      artistIds.forEach((id) => result.set(id, equal));
      return result;
    }

    const result = new Map<string, number>();
    artistIds.forEach((id) => {
      result.set(id, weights.get(id) || 0);
    });
    return result;
  }, [weights, artistIds, hasCustomWeights]);

  const setWeights = useCallback((newWeights: Map<string, number>) => {
    setWeightsState(newWeights);
    onWeightsChange?.(newWeights);
  }, [onWeightsChange]);

  const setWeight = useCallback((artistId: string, weight: number) => {
    setWeightsState((prev) => {
      const next = new Map(prev);
      next.set(artistId, Math.max(0, Math.min(100, weight)));
      return next;
    });
  }, []);

  const enableCustomWeights = useCallback(() => {
    const w = new Map<string, number>();
    const equal = Math.round(100 / artistIds.length);
    artistIds.forEach((id) => w.set(id, equal));
    setWeightsState(w);
  }, [artistIds]);

  const resetToEqual = useCallback(() => {
    setWeightsState(new Map());
  }, []);

  const removeArtist = useCallback((artistId: string) => {
    setWeightsState((prev) => {
      const next = new Map(prev);
      next.delete(artistId);
      return next;
    });
  }, []);

  return {
    weights,
    hasCustomWeights,
    totalWeight,
    isWeightValid,
    displayPercentages,
    setWeight,
    setWeights,
    enableCustomWeights,
    resetToEqual,
    removeArtist,
  };
}
