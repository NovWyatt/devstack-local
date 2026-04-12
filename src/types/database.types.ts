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

/** Result payload for listing tables in a database. */
export interface DatabaseTableListResult {
  success: boolean;
  message: string;
  database: string;
  tables: string[];
  error?: string;
}

/** Single table column schema metadata from DESCRIBE output. */
export interface DatabaseTableSchemaColumn {
  field: string;
  type: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
}

/** Result payload for loading table schema. */
export interface DatabaseTableSchemaResult {
  success: boolean;
  message: string;
  database: string;
  table: string;
  columns: DatabaseTableSchemaColumn[];
  error?: string;
}

export type DatabaseTableRowValue = string | null;
export type DatabaseTableRow = Record<string, DatabaseTableRowValue>;

/** Result payload for loading paged table rows. */
export interface DatabaseTableRowsResult {
  success: boolean;
  message: string;
  database: string;
  table: string;
  page: number;
  limit: number;
  hasMore: boolean;
  columns: string[];
  rows: DatabaseTableRow[];
  error?: string;
}
