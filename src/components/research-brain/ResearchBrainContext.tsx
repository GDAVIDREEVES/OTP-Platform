import React, { useCallback, useState, createContext, useContext } from 'react';
export interface RBContext {
  entityId?: string;
  entityName?: string;
  jurisdiction?: string;
  function?: string;
  transactionType?: string;
  method?: string;
}
interface RBState {
  open: boolean;
  context: RBContext | null;
  openPanel: (ctx?: RBContext) => void;
  closePanel: () => void;
}
const Ctx = createContext<RBState | null>(null);
export function ResearchBrainProvider({
  children


}: {children: React.ReactNode;}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<RBContext | null>(null);
  const openPanel = useCallback((ctx?: RBContext) => {
    if (ctx) setContext(ctx);
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => setOpen(false), []);
  return (
    <Ctx.Provider
      value={{
        open,
        context,
        openPanel,
        closePanel
      }}>
      
      {children}
    </Ctx.Provider>);

}
export function useResearchBrain() {
  const v = useContext(Ctx);
  if (!v)
  throw new Error(
    'useResearchBrain must be used within ResearchBrainProvider'
  );
  return v;
}