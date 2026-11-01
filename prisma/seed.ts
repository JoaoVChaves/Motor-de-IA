
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Iniciando seed...');
  
  
  const tenants = [
    {
      id: 'sol-nascente',
      nome_empresa: 'Sol Nascente Energia Solar',
      tom: 'informal',
      pode_dizer_que_e_ia: true,
      nome_assistente: 'Luz',
      horario_atendimento_ia: '24h',
      telefone_notificacao: '5581988887777',
      cidades_atendidas: [
        'Recife',
        'Olinda',
        'Jaboatão dos Guararapes',
        'Caruaru',
      ],
      estagios: [
        'Novo',
        'Qualificacao',
        'Qualificado',
        'Desqualificado',
        'Agendado',
        'Humano',
      ],
      regras_gerais: [
        'Nunca prometer valor exato de economia; dizer que depende da visita técnica.',
        'Nunca informar preço final; dizer que o consultor apresenta o orçamento.',
        'Não pedir nem repetir senhas ou dados bancários.',
        "Se o lead disser que já é cliente, marcar 'cliente-antigo' e transferir para humano.",
      ],
    },
    {
      id: 'ecovolt-sul',
      nome_empresa: 'EcoVolt Engenharia Solar',
      tom: 'formal',
      pode_dizer_que_e_ia: false,
      nome_assistente: 'Carlos',
      horario_atendimento_ia: '24h',
      telefone_notificacao: '5500000000000',
      cidades_atendidas: [
        'Curitiba',
        'São José dos Pinhais',
        'Londrina',
      ],
      estagios: [
        'Novo',
        'Qualificacao',
        'Qualificado',
        'Desqualificado',
        'Agendado',
        'Humano',
      ],
      regras_gerais: [
        'Não prometer valores exatos de economia; informar que dependem da visita técnica.',
        'Não informar preço final; o consultor apresentará o orçamento.',
        'Não solicitar nem repetir senhas ou dados bancários.',
        "Se o lead informar que já é cliente, marcar 'cliente-antigo' e transferir para atendimento humano.",
      ],
    },
  ];

  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: tenant,
      create: tenant,
    });

    console.log(`Tenant ${tenant.id} cadastrado/atualizado.`);
  }
  
  const horarios = [
    {
      codigo_horario: 'quinta-09',
      descricao: 'Quinta-feira - 09:00 (Manhã)',
    },
    {
      codigo_horario: 'quinta-10',
      descricao: 'Quinta-feira - 10:00 (Manhã)',
    },
    {
      codigo_horario: 'sexta-14',
      descricao: 'Sexta-feira - 14:00 (Tarde)',
    },
  ];

  for (const tenant of tenants) {
    for (const horario of horarios) {
      await prisma.scheduleSlot.upsert({
        where: {
          tenant_id_codigo_horario: {
            tenant_id: tenant.id,
            codigo_horario: horario.codigo_horario,
          },
        },
        update: {},
        create: {
          tenant_id: tenant.id,
          codigo_horario: horario.codigo_horario,
          descricao: horario.descricao,
          disponivel: true,
        },
      });
    }

    console.log(`Horários cadastrados para ${tenant.id}.`);
  }

}

main()
  .catch((error) => {
    console.error('Erro ao executar seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
