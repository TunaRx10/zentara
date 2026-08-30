import { useState, useEffect, useCallback } from 'react';
import { prospectRepository } from '@/data/repositories/prospect.repository';
import { Prospect } from '@/types';
import { syncService } from '@/services/sync/sync.service';
import { useNetworkStatus } from './useNetworkStatus';

type SyncStatus = 'local' | 'synced' | 'syncing' | 'failed';

export interface ProspectWithSync extends Prospect {
  _sync?: SyncStatus;
}

export function useProspects() {
  const [prospects, setProspects] = useState<ProspectWithSync[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isOnline } = useNetworkStatus();

  const fetchProspects = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await prospectRepository.getAll();
      setProspects(data.map(p => ({ ...p, _sync: isOnline ? 'synced' : 'local' })));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch prospects'));
    } finally {
      setIsLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    fetchProspects();
  }, [fetchProspects]);

  const addProspect = async (data: Omit<Prospect, 'id' | 'created_at' | 'updated_at'>) => {
    const newProspect = await prospectRepository.create(data);
    setProspects(prev => [{ ...newProspect, _sync: isOnline ? 'syncing' : 'local' }, ...prev]);
    // Sync fire-and-forget vers le backend si online.
    if (isOnline) {
      syncService.syncProspect(newProspect).then((res) => {
        setProspects(prev => prev.map(p =>
          p.id === newProspect.id ? { ...p, _sync: res.ok ? 'synced' : 'failed' } : p,
        ));
      }).catch(() => {
        setProspects(prev => prev.map(p =>
          p.id === newProspect.id ? { ...p, _sync: 'failed' } : p,
        ));
      });
    }
    return newProspect;
  };

  const removeProspect = async (id: string) => {
    // Round 93 — fix Row-Not-Really-Deleted bug :
    //   On supprime d'abord dans le React state (optimiste visible),
    //   puis on DELETE vraiment en SQLite via le repository. Si le
    //   repository lance (jeep-sqlite indispo, table absente, ID bogus),
    //   l'erreur remonte → le caller peut afficher un toast et réessayer.
    //   Surtout : on NE swallow PAS l'erreur — sinon la ligne réapparaît
    //   après un refetch + le merge merge backend > local.
    setProspects(prev => prev.filter(p => p.id !== id));
    try {
      await prospectRepository.delete(id);
    } catch (err) {
      // Rebascule : on remet la ligne dans le state pour rester cohérent
      // avec le repository, et on propage l'erreur au caller pour toast.
      const data = await prospectRepository.getAll();
      setProspects(data.map(p => ({ ...p, _sync: isOnline ? 'synced' : 'local' })));
      throw err;
    }
  };

  return {
    prospects,
    isLoading,
    error,
    refetch: fetchProspects,
    addProspect,
    removeProspect,
    isOnline,
  };
}
