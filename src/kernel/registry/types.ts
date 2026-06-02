/** The OTP-1…50 process registry types. The catalog is served by the backend
 *  (GET /api/processes) so the pharmaceutical overlay is loaded config, not code. */

export type Category = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Applicability = 'H' | 'M' | 'L';
export type StepActor = 'human' | 'assistant';

export const CATEGORY_ORDER: Category[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export interface StepDef {
  key: string;
  label: string;
  /** 'assistant' steps are run agentically by the Research Brain. */
  actor: StepActor;
  /** the final, human-only review/post step; AI can never be the actor here. */
  gate?: boolean;
  description?: string;
}

export interface ProcessDef {
  id: string; // "OTP-9"
  category: Category;
  name: string;
  oecdAnchor: string;
  ownerFunction: string;
  cadence: string;
  pharmaApplicability: Applicability;
  top15: boolean;
  pattern: string;
  steps: StepDef[];
}

export interface ProcessCatalog {
  categories: Record<string, string>;
  processes: ProcessDef[];
}
