export type MemoryCategory = "user" | "feedback" | "project" | "reference";
export type MemoryScope = "workspace" | "global";

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  scope: MemoryScope;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  filePath: string;
}

export interface MemoryStoreInput {
  id?: string;
  category: MemoryCategory;
  scope?: MemoryScope;
  title?: string;
  content: string;
  tags?: string[];
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  snippet: string;
}

export interface MemoryManagerOptions {
  workspaceRoot: string;
  globalDir?: string;
}
