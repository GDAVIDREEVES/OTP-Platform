import { createContext, useContext } from 'react';
import type { CockpitNodeTypes, CockpitGraphPreview } from '@/shared/api/types';

/** Canvas-wide context the custom node component reads (React Flow nodes can't
 *  take arbitrary props, so the catalogue + the painted preview values + the
 *  set of node ids flagged by validation reach each node through context). */
export interface CanvasCtx {
  catalogue: CockpitNodeTypes | null;
  preview: CockpitGraphPreview | null;
  scenarioPreview: CockpitGraphPreview | null;
  /** node_id -> true when validation flagged this node (paint it red). */
  errorNodeIds: Set<string>;
}

export const CanvasContext = createContext<CanvasCtx>({
  catalogue: null,
  preview: null,
  scenarioPreview: null,
  errorNodeIds: new Set(),
});

export const useCanvasCtx = () => useContext(CanvasContext);
