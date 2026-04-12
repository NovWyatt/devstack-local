/**
 * Database Manager type definitions for DevStack Local.
 */

/** Result payload for listing databases. */
export interface DatabaseListResult {
  success: boolean;
  message: string;
  databases: string[];
  error?: string;
}

/** Result payload for create/delete/import/export operations. */
export interface DatabaseOperationResult {
  success: boolean;
  message: string;
  error?: string;
  filePath?: string;
}
