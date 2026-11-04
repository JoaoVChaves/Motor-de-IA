
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GoogleGenAI } from '@google/genai';
import { GeminiAdapter } from './gemini.adapter.js';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let generateContent: jest.Mock<
  (...args: any[]) => Promise<any>
  >;

  beforeEach(() => {
    generateContent = jest.fn();

    const client = {
      models: {
        generateContent,
      },
    } as unknown as Pick<GoogleGenAI, 'models'>;

    adapter = new GeminiAdapter(
      'fake-api-key',
      'gemini-test',
      30000,
      client,
    );
  });

  it('deve converter o histórico para o formato do Gemini', async () => {
    generateContent.mockResolvedValue({
      text: 'Resposta do Gemini',
      functionCalls: [],
    });

    await adapter.generateTurn({
      systemPrompt: 'Você é um assistente.',
      messages: [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Como posso ajudar?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              name: 'consultar_agenda',
              arguments: { cidade: 'Caruaru' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"horarios":["09:00"]}',
          tool_call_id: 'call-1',
          tool_name: 'consultar_agenda',
        },
      ],
      tools: [],
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Olá' }],
          },
          {
            role: 'model',
            parts: [{ text: 'Como posso ajudar?' }],
          },
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call-1',
                  name: 'consultar_agenda',
                  args: { cidade: 'Caruaru' },
                },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call-1',
                  name: 'consultar_agenda',
                  response: {
                    result: '{"horarios":["09:00"]}',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
  });

  it('deve converter as ferramentas para functionDeclarations', async () => {
    generateContent.mockResolvedValue({
      text: 'Vou consultar a agenda.',
      functionCalls: [],
    });

    await adapter.generateTurn({
      systemPrompt: 'Prompt de teste',
      messages: [{ role: 'user', content: 'Quais horários existem?' }],
      tools: [
        {
          name: 'consultar_agenda',
          description: 'Consulta horários disponíveis.',
          parameters: {
            type: 'object',
            properties: {
              cidade: { type: 'string' },
            },
            required: ['cidade'],
          },
        },
      ],
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'consultar_agenda',
                  description: 'Consulta horários disponíveis.',
                  parametersJsonSchema: {
                    type: 'object',
                    properties: {
                      cidade: { type: 'string' },
                    },
                    required: ['cidade'],
                  },
                },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('deve retornar conteúdo e chamadas de ferramentas', async () => {
    generateContent.mockResolvedValue({
      text: 'Vou consultar a agenda.',
      functionCalls: [
        {
          id: 'call-123',
          name: 'consultar_agenda',
          args: { cidade: 'Caruaru' },
        },
      ],
      modelVersion: 'gemini-test-version',
    });

    const response = await adapter.generateTurn({
      systemPrompt: 'Prompt',
      messages: [{ role: 'user', content: 'Consulte a agenda.' }],
      tools: [],
    });

    expect(response.content).toBe('Vou consultar a agenda.');
    expect(response.toolCalls).toEqual([
      {
        id: 'call-123',
        name: 'consultar_agenda',
        arguments: { cidade: 'Caruaru' },
      },
    ]);
    expect(response.provider).toBe('gemini');
    expect(response.model).toBe('gemini-test-version');
  });

  it('deve capturar os tokens de entrada e saída', async () => {
    generateContent.mockResolvedValue({
      text: 'Resposta',
      functionCalls: [],
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 50,
      },
    });

    const response = await adapter.generateTurn({
      systemPrompt: 'Prompt',
      messages: [{ role: 'user', content: 'Teste' }],
      tools: [],
    });

    expect(response.usage).toEqual({
      promptTokens: 150,
      completionTokens: 50,
      estimatedCostUsd: null,
    });
  });

  it('deve aceitar resposta sem conteúdo e sem metadados de uso', async () => {
    generateContent.mockResolvedValue({
      functionCalls: [],
    });

    const response = await adapter.generateTurn({
      systemPrompt: 'Prompt',
      messages: [{ role: 'user', content: 'Teste' }],
      tools: [],
    });

    expect(response.content).toBeNull();
    expect(response.toolCalls).toEqual([]);
    expect(response.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: null,
    });
  });

  it('deve propagar erros retornados pelo provedor', async () => {
    const erro = new Error('Falha na API Gemini');

    generateContent.mockRejectedValue(erro);

    await expect(
      adapter.generateTurn({
        systemPrompt: 'Prompt',
        messages: [{ role: 'user', content: 'Teste' }],
        tools: [],
      }),
    ).rejects.toBe(erro);
  });

  it('deve respeitar o timeout informado na chamada', async () => {
    generateContent.mockResolvedValue({
      text: 'Resposta',
      functionCalls: [],
    });

    await adapter.generateTurn({
      systemPrompt: 'Prompt',
      messages: [{ role: 'user', content: 'Teste' }],
      tools: [],
      timeoutMs: 15000,
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          httpOptions: {
            timeout: 15000,
          },
        }),
      }),
    );
  });
});
