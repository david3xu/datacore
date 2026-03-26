// types.ts — What shapes exist in the system?

// ─── Gold Layer ─────────────────────────────────────────────

export interface GoldEntity {
  entity_type: string;
  entity_id: string;
  summary: string;
  project?: string;
  tags?: string[];
  source_events?: string[];
  data?: unknown;
  created_at: string;
  updated_at: string;
}

export interface AddEntityInput {
  entity_type: string;
  summary: string;
  project?: string;
  tags?: string[];
  source_events?: string[];
  data?: unknown;
}

export interface AddEntityResult {
  entity_id: string;
  file_path: string;
  action: 'created' | 'updated';
}

export interface GetFactsInput {
  entity_type?: string;
  project?: string;
  tag?: string;
  query?: string;
}

export interface GetFactsResult {
  entities: GoldEntity[];
  total: number;
}

export interface BronzeRecord {
  source: string;
  type: string;
  content: string;
  context?: Record<string, unknown>;
  _timestamp: string;
  _source: string;
  _event_id: string;
  _filePath?: string;
}

export interface AppendEventInput {
  source: string;
  type: string;
  content: string;
  context?: Record<string, unknown>;
}

export interface AppendEventResult {
  bronzeDir: string;
  filePath: string;
  record: BronzeRecord;
}

export interface SearchInput {
  query: string;
  maxResults?: number;
  source?: string;
  type?: string;
}

export interface SearchResult {
  eventId: string | null;
  timestamp: string | null;
  source: string | null;
  type: string | null;
  snippet: string;
  filePath: string;
}

export interface SearchOutput {
  bronzeDir: string;
  filesScanned: number;
  eventsScanned: number;
  parseErrors: number;
  totalMatches: number;
  results: SearchResult[];
  sourceCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

export interface TaskInput {
  status?: string;
  assigned_to?: string;
  task_type?: string;
  task_id?: string;
  limit?: number;
}

export interface TaskSummary {
  task_id: string;
  status: string;
  task_type: string | null;
  assigned_to: string | null;
  score: unknown;
  problem: unknown;
  impact: unknown;
  project: unknown;
  workflow_stage: unknown;
  phase: unknown;
  depends_on: unknown;
  pattern: unknown;
  acceptance: unknown;
  spec_file: unknown;
  summary: string | null;
  latest_update: string | null;
  latest_type: string | null;
  created_at: string | null;
  updated_at: string | null;
  event_count: number;
  tags: unknown;
  lessons: unknown;
}

export interface TaskEvent {
  eventId: string | null;
  timestamp: string | null;
  source: string | null;
  type: string | null;
  content: string | null;
  context: Record<string, unknown> | null;
}

export interface Filters {
  source?: string;
  type?: string;
}

export interface ReadAllResult {
  bronzeDir: string;
  files: string[];
  records: BronzeRecord[];
  parseErrors: number;
}

export interface TaskBoardResult {
  bronzeDir: string;
  mode: 'board';
  status_filter: string;
  total_tasks: number;
  tasks: TaskSummary[];
  parseErrors: number;
}

export interface TaskHistoryResult {
  bronzeDir: string;
  mode: 'history';
  task_id: string;
  events: TaskEvent[];
  totalEvents: number;
}

export type TaskResult = TaskBoardResult | TaskHistoryResult;
