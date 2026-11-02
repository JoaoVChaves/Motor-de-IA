export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_calls?: LlmToolCall[];
}

export interface LlmCompletionResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  provider: string;
  model: string;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    estimatedCostUsd: number | null;
  };
}

export interface LlmProvider {
  generateTurn(params: {
    systemPrompt: string;
    messages: LlmChatMessage[];
    tools: LlmToolDefinition[];
    temperature?: number;
    timeoutMs?: number;
  }): Promise<LlmCompletionResponse>;
}