// ── Transcript JSONL raw types ──

export interface TranscriptMessage {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  message?: {
    role: string;
    model?: string;
    content?: ContentBlock[];
    usage?: TokenUsage;
  };
  toolUseResult?: ToolUseResult;
  sourceToolAssistantUUID?: string;
  data?: ProgressData;
  isSidechain?: boolean;
}

export interface ContentBlock {
  type: string;
  name?: string;        // "Agent" for agent tool_use
  id?: string;          // tool_use id
  text?: string;
  input?: AgentInput;
  tool_use_id?: string; // for tool_result
  content?: ToolResultContent[];
}

export interface AgentInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  model?: string;
  run_in_background?: boolean;
}

export interface ToolResultContent {
  type: string;
  text?: string;
}

export interface ToolUseResult {
  status: string;
  prompt?: string;
  agentId: string;
  content?: ToolResultContent[];
  totalDurationMs: number;
  totalTokens: number;
  totalToolUseCount: number;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
}

export interface ProgressData {
  type: string;       // "agent_progress"
  agentId?: string;
  prompt?: string;
  message?: unknown;
}

// ── Parsed / aggregated types ──

export interface AgentNode {
  agentId: string;
  parentAgentId: string | null;
  parentAssistantUUID: string | null;
  subagentType: string | null;
  model: string | null;
  description: string | null;
  prompt: string | null;
  status: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalDurationMs: number;
  toolUseCount: number;
  children: AgentNode[];
  depth: number;
}

export interface SessionReport {
  sessionId: string;
  sessionDir: string;
  timestamp: string;
  mainModel: string | null;
  totalTokens: number;
  totalDurationMs: number;
  agents: AgentNode[];
  agentCount: number;
  maxDepth: number;
}
