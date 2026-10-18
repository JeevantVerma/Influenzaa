import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './client.js';
import { useToast } from '../components/Toast.jsx';

export function useApi(key, path, options = {}) {
  return useQuery({ queryKey: Array.isArray(key) ? key : [key], queryFn: ({ signal }) => get(path, { signal }), ...options });
}

/**
 * Wraps a mutation with cache invalidation and toast feedback. Success toasts
 * only appear after the server confirms the action — never optimistically.
 */
export function useAction(fn, { invalidate = [], success, onSuccess, onError } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      for (const k of invalidate) qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] });
      const msg = typeof success === 'function' ? success(data, vars) : success;
      if (msg) toast(msg, 'success');
      onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      toast(err.message || 'Something went wrong', 'error');
      onError?.(err, vars);
    },
  });
}

export function useTaxonomy() {
  return useApi('taxonomy', '/meta/taxonomy', { staleTime: Infinity });
}
