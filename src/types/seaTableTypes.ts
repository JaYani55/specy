/**
 * Type definitions for SeaTable-sourced profile data.
 *
 * SeaTable rows arrive as arbitrary key/value records (column names are
 * user-defined in SeaTable), so `SeaTableRow` is intentionally permissive.
 * `ColumnMetadata` optionally carries per-column type information keyed by
 * column name (see `SeaTableProfileData`).
 */

export type SeaTableRow = Record<string, unknown>;

export interface SeaTableColumnInfo {
  /** SeaTable column type, e.g. 'text', 'number', 'date', 'single-select'. */
  type?: string;
  /** Optional display name of the column. */
  name?: string;
}

export interface ColumnMetadata {
  /** Per-column metadata keyed by column name. */
  columns?: Record<string, SeaTableColumnInfo>;
}
