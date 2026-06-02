import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Role = 'operator' | 'reviewer' | 'director';

export interface SessionUser {
  id: string;
  name: string;
  title: string;
  role: Role;
  initials: string;
}

// The three personas the platform serves through one record (Section 2 of the
// spec). Phase 2's hardcoded u_maria/u_sam are now driven from here; switching
// role is how the demo moves a record operator -> reviewer -> director.
export const USERS: Record<Role, SessionUser> = {
  operator: { id: 'u_maria', name: 'Maria Chen', title: 'CoE Operator · TP Manager', role: 'operator', initials: 'MC' },
  reviewer: { id: 'u_sam', name: 'Sam Rodriguez', title: 'Reviewer · TP Director', role: 'reviewer', initials: 'SR' },
  director: { id: 'u_priya', name: 'Priya Anand', title: 'Director · VP Tax', role: 'director', initials: 'PA' },
};

interface SessionState {
  user: SessionUser;
  role: Role;
  setRole: (r: Role) => void;
  users: SessionUser[];
}

const Ctx = createContext<SessionState | null>(null);
const STORAGE_KEY = 'otp.role';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Role | null;
      return saved && USERS[saved] ? saved : 'operator';
    } catch {
      return 'operator';
    }
  });
  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<SessionState>(
    () => ({ user: USERS[role], role, setRole, users: Object.values(USERS) }),
    [role, setRole],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within <SessionProvider>');
  return v;
}

export function useSessionUser(): SessionUser {
  return useSession().user;
}
