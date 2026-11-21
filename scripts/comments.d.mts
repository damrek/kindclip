export interface ExtractedComment {
  kind: string;
  startLine: number;
  endLine: number;
  column: number;
  text: string;
  directive: boolean;
}

export interface CountComparison {
  count: number;
  cap: number;
  excess: number;
  lower: number;
}

export function normalizeComment(body: string): string;
export function isDirective(text: string): boolean;
export function extractComments(text: string, extension: string): ExtractedComment[];
export function countComments(comments: ExtractedComment[]): number;
export function compareCount(comments: ExtractedComment[], cap?: number): CountComparison;
export function lowerBaseline(cap: number, comments: ExtractedComment[]): number;
export function initBaseline(comments: ExtractedComment[]): number;
export const BASELINE_FILE: string;
