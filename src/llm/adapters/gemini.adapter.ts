
import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type {
  LlmChatMessage,
  LlmCompletionResponse,
  LlmProvider,
  LlmToolDefinition,
} from '../interfaces/llm-provider.interface.js';

export class GeminiAdapter implements LlmProvider {
  private readonly client: Pick<GoogleGenAI, 'models'>;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly defaultTimeoutMs: number,
    client?: Pick<GoogleGenAI, 'models'>,
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async generateTurn(params: {
    systemPrompt: string;
    messages: LlmChatMessage[];
    tools: LlmToolDefinition[];
    temperature?: number;
    timeoutMs?: number;
  }): Promise<LlmCompletionResponse> {
    const contents = this.mapMessages(params.messages);

    const tools = params.tools.length
      ? [
          {
            functionDeclarations: params.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ]
      : undefined;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        temperature: params.temperature,
        tools,
        httpOptions: {
          timeout: params.timeoutMs ?? this.defaultTimeoutMs,
        },
      },
    });

    const toolCalls = (response.functionCalls ?? [])
      .filter((call) => typeof call.name === 'string')
      .map((call, index) => ({
        id: call.id ?? `${call.name}-${index}`,
        name: call.name!,
        arguments: (call.args ?? {}) as Record<string, any>,
      }));

    return {
      content: response.text ?? null,
      toolCalls,
      provider: 'gemini',
      model: response.modelVersion ?? this.model,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? null,
        completionTokens:
          response.usageMetadata?.candidatesTokenCount ?? null,
        estimatedCostUsd: null,
      },
    };
  }

  private mapMessages(messages: LlmChatMessage[]): Content[] {
    const contents: Content[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }

      if (message.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: message.content }],
        });
        continue;
      }

      if (message.role === 'assistant') {
        const parts: Part[] = [];

        if (message.content) {
          parts.push({ text: message.content });
        }

        for (const call of message.tool_calls ?? []) {
          parts.push({
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.arguments,
            },
          });
        }

        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }

        continue;
      }

      if (message.role === 'tool') {
        if (!message.tool_name) {
          throw new Error(
            'Mensagem de ferramenta sem tool_name no histórico do Gemini.',
          );
        }

        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: message.tool_call_id,
                name: message.tool_name,
                response: {
                  result: message.content,
                },
              },
            },
          ],
        });
      }
    }

    return contents;
  }
}
