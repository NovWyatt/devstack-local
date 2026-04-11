/**
 * Domain and Virtual Host type definitions for DevStack Local.
 */

/** Persisted domain entry used by the Domains manager. */
export interface DomainRecord {
  id: string;
  hostname: string;
  projectPath: string;
  phpVersion: string | null;
  phpPort: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Input payload for create/update domain operations. */
export interface DomainInput {
  hostname: string;
  projectPath: string;
  phpVersion?: string | null;
}

/** Generic domain operation result for IPC calls. */
export interface DomainOperationResult {
  success: boolean;
  message: string;
  error?: string;
  domain?: DomainRecord;
}
