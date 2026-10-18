import { createContext, useContext, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { get, setUnauthorizedHandler } from '../api/client.js';
import { FullPageSpinner } from '../components/ui.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  // Where the public-only routes should send the user once a session exists.
  const redirectRef = useRef(null);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/auth/me').then((d) => (d?.user ? d : null)).catch((e) => (e.status === 401 ? null : Promise.reject(e))),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  const value = {
    user: me.data?.user ?? null,
    loading: me.isLoading,
    error: me.error,
    redirectTo: () => redirectRef.current,
    setSession: (data, redirectTo) => {
      redirectRef.current = redirectTo || null;
      qc.setQueryData(['me'], data);
    },
    clear: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
