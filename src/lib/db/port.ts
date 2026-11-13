/** Minimal SQL surface the store needs; real (plugin) or fake (tests). */

/** Minimal SQL surface the store needs; real (plugin) or fake (tests). */
export interface DbPort {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId?: number; rowsAffected?: number }>;
}
