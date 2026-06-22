import { createContext, useContext } from 'react';
import type { CockpitNodeTypes, CockpitGraphPreview, StageGraphPreview } from '@/shared/api/types';
import type { GraphFamily } from './useGraphModel';

/** Canvas-wide context the custom node component reads (React Flow nodes can't
 *  take arbitrary props, so the catalogue + the painted preview values + the
 *  set of node ids flagged by validation reach each node through context). */
export interface CanvasCtx {
  catalogue: CockpitNodeTypes | null;
  preview: CockpitGraphPreview | null;
  scenarioPreview: CockpitGraphPreview | null;
  /** The per-stage dry-run result for an allocation stage graph (MC3). */
  stagePreview: StageGraphPreview | null;
  /** The resolved family of the WHOLE graph — disambiguates the shared
   *  ``source`` kind (dataset vs alloc) when rendering a node (DS3). */
  family: GraphFamily;
  /** node_id -> true when validation flagged this node (paint it red). */
  errorNodeIds: Set<string>;
}

export const CanvasContext = createContext<CanvasCtx>({
  catalogue: null,
  preview: null,
  scenarioPreview: null,
  stagePreview: null,
  family: 'empty',
  errorNodeIds: new Set(),
});

export const useCanvasCtx = () => useContext(CanvasContext);
