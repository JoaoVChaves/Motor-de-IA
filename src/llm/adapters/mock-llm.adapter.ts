
import { Injectable } from '@nestjs/common';
import type {
  LlmCompletionResponse,
  LlmProvider,
} from '../interfaces/llm-provider.interface.js';

@Injectable()
export class MockLlmAdapter implements LlmProvider {
  async generateTurn(
    params?: Parameters<LlmProvider['generateTurn']>[0],
  ): Promise<LlmCompletionResponse> {
    const messages = params?.messages ?? [];
    const tools = params?.tools ?? [];

    const respostaFinal = (
      content: string,
    ): LlmCompletionResponse => ({
      content,
      toolCalls: [],
      provider: 'mock',
      model: 'mock-model',
      usage: {
        promptTokens: null,
        completionTokens: null,
        estimatedCostUsd: null,
      },
    });

    const chamada = (
      name: string,
      args: Record<string, unknown>,
      index: number,
    ) => ({
      id: `mock-${messages.length}-${index}`,
      name,
      arguments: args,
    });

    const ferramentasDisponiveis = new Set(
      tools.map((tool) => tool.name),
    );

    const ultimaMensagemUsuario = [...messages]
      .reverse()
      .find((message) => message.role === 'user')?.content ?? '';

    const solicitacaoDeAcaoPendente =
      ultimaMensagemUsuario.includes('ações obrigatórias') ||
      ultimaMensagemUsuario.includes('ações obrigatorias');

    // Se o processador pediu uma ação pendente, tenta concluir
    // o estágio de qualificação.
    if (solicitacaoDeAcaoPendente) {
      if (ferramentasDisponiveis.has('mover_estagio')) {
        return {
          ...respostaFinal(''),
          toolCalls: [
            chamada('mover_estagio', { estagio: 'Qualificacao' }, 0),
          ],
        };
      }

      return respostaFinal(
        'Recebi suas informações. Nossa equipe poderá continuar o atendimento.',
      );
    }

    // Se ferramentas já foram executadas neste turno,
    // encerra com uma resposta final.
    const jaExecutouFerramenta = messages.some(
      (message) => message.role === 'tool',
    );

    if (jaExecutouFerramenta) {
      const solicitouAgenda =
        /\b(agenda|agendar|hor[aá]rios?|disponibilidade|dispon[ií]veis)\b/i
          .test(
            messages
              .filter((message) => message.role === 'user')
              .map((message) => message.content)
              .join('\n'),
          );

      const agendaJaConsultada = messages.some(
        (message) =>
          message.role === 'tool' &&
          message.tool_name === 'consultar_agenda',
      );

      if (
        solicitouAgenda &&
        !agendaJaConsultada &&
        ferramentasDisponiveis.has('consultar_agenda')
      ) {
        return {
          ...respostaFinal(''),
          toolCalls: [
            chamada('consultar_agenda', {}, 0),
          ],
        };
      }

      return respostaFinal(
        solicitouAgenda && agendaJaConsultada
          ? 'Consultei a agenda. Vou considerar os horários retornados para continuar seu atendimento.'
          : 'Obrigado pelas informações! Recebemos seus dados e podemos continuar sua qualificação.',
      );
    }

    const mensagensDoLead = messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n');

    const toolCalls: ReturnType<typeof chamada>[] = [];
    let indice = 0;

    const adicionarAtualizacao = (
      campo: string,
      valor: string,
    ) => {
      if (ferramentasDisponiveis.has('atualizar_ficha')) {
        toolCalls.push(
          chamada('atualizar_ficha', { campo, valor }, indice++),
        );
      }
    };

    // Extrai o nome informado pelo lead.
    const nomeMatch = mensagensDoLead.match(
      /meu nome é\s+(.+?)(?=\s+e\s+moro|\s+moro|\s+e\s+resido|[,.\n]|$)/i,
    );

    if (nomeMatch?.[1]) {
      adicionarAtualizacao('nome', nomeMatch[1].trim());
    }

    // Extrai a cidade informada pelo lead.
    const cidadeMatch = mensagensDoLead.match(
      /(?:moro|resido)\s+em\s+([^,.\n]+)/i,
    );

    if (cidadeMatch?.[1]) {
      adicionarAtualizacao('cidade', cidadeMatch[1].trim());
    }

    
    // Extrai o valor da conta de energia.
    const valorMatch = mensagensDoLead.match(
      /R\$\s*([\d.]+(?:,\d{1,2})?)/i,
    );

    let valorConta: number | null = null;

    if (valorMatch?.[1]) {
      const valor = valorMatch[1]
        .replace(/\./g, '')
        .replace(',', '.');

      valorConta = Number(valor);
      adicionarAtualizacao('valor_conta', valor);
    }

    // Extrai o tipo do imóvel.
    const tipoImovelMatch = mensagensDoLead.match(
      /(?:im[oó]vel|resid[eê]ncia)\s+(?:é|eh)\s+(?:uma?\s+)?(casa|apartamento)/i,
    );

    const tipoImovel = tipoImovelMatch?.[1]?.toUpperCase();

    if (tipoImovel) {
      adicionarAtualizacao('tipo_imovel', tipoImovel);
    }

    // Extrai a posse do imóvel.
    const posseMatch = mensagensDoLead.match(
      /(?:im[oó]vel|resid[eê]ncia)\s+(?:é|eh)\s+(pr[oó]prio|alugado)/i,
    );

    const posseImovel = posseMatch?.[1]
      ?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    if (posseImovel) {
      adicionarAtualizacao('posse_imovel', posseImovel);
    }

    // Define as ações de CRM conforme os dados recebidos.
    const fichaCompleta = Boolean(
      cidadeMatch?.[1] &&
      valorConta !== null &&
      tipoImovel &&
      posseImovel,
    );

    if (fichaCompleta) {
      const desqualificado =
        tipoImovel === 'APARTAMENTO' ||
        posseImovel === 'ALUGADO' ||
        valorConta! < 250;

      if (desqualificado) {
        if (ferramentasDisponiveis.has('adicionar_tag')) {
          toolCalls.push(
            chamada('adicionar_tag', { tag: 'desqualificado' }, indice++),
          );
        }

        if (ferramentasDisponiveis.has('mover_estagio')) {
          toolCalls.push(
            chamada('mover_estagio', { estagio: 'Desqualificado' }, indice++),
          );
        }
      } else {
        if (ferramentasDisponiveis.has('adicionar_tag')) {
          toolCalls.push(
            chamada('adicionar_tag', { tag: 'qualificado' }, indice++),
          );
        }

        if (ferramentasDisponiveis.has('mover_estagio')) {
          toolCalls.push(
            chamada('mover_estagio', { estagio: 'Qualificado' }, indice++),
          );
        }
      }
    } else {
      if (ferramentasDisponiveis.has('mover_estagio')) {
        toolCalls.push(
          chamada('mover_estagio', { estagio: 'Qualificacao' }, indice++),
        );
      }
    }

    // Detecta intenção de consultar a agenda.
    const solicitouAgenda =
      /\b(agenda|agendar|hor[aá]rios?|disponibilidade|dispon[ií]veis)\b/i
        .test(mensagensDoLead);

    if (
      solicitouAgenda &&
      ferramentasDisponiveis.has('consultar_agenda')
    ) {
      toolCalls.push(
        chamada('consultar_agenda', {}, indice++),
      );
    }


    if (toolCalls.length > 0) {
      return {
        content: null,
        toolCalls,
        provider: 'mock',
        model: 'mock-model',
        usage: {
          promptTokens: null,
          completionTokens: null,
          estimatedCostUsd: null,
        },
      };
    }

    return respostaFinal(
      'Obrigado pelo contato! Como posso ajudar?',
    );
  }
}
