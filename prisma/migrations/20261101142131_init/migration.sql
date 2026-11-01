-- CreateEnum
CREATE TYPE "EstadoConversa" AS ENUM ('IA_ATIVA', 'HUMANO_PENDENTE', 'HUMANO_ATIVO', 'PROCESSANDO');

-- CreateEnum
CREATE TYPE "AutorMensagem" AS ENUM ('lead', 'humano', 'ia');

-- CreateEnum
CREATE TYPE "StatusMensagem" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'IGNORED_HUMAN', 'FAILED');

-- CreateEnum
CREATE TYPE "TipoImovel" AS ENUM ('CASA', 'APARTAMENTO');

-- CreateEnum
CREATE TYPE "PosseImovel" AS ENUM ('PROPRIO', 'ALUGADO');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('FINANCIAMENTO', 'A_VISTA');

-- CreateTable
CREATE TABLE "tenants" (
    "id" VARCHAR(100) NOT NULL,
    "nome_empresa" TEXT NOT NULL,
    "tom" TEXT NOT NULL,
    "pode_dizer_que_e_ia" BOOLEAN NOT NULL,
    "nome_assistente" TEXT NOT NULL,
    "horario_atendimento_ia" TEXT NOT NULL,
    "telefone_notificacao" TEXT NOT NULL,
    "cidades_atendidas" JSONB NOT NULL,
    "estagios" JSONB NOT NULL,
    "regras_gerais" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "telefone" TEXT NOT NULL,
    "estado" "EstadoConversa" NOT NULL DEFAULT 'IA_ATIVA',
    "estagio_atual" TEXT NOT NULL DEFAULT 'Novo',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "motivo_transferencia" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sheets" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "nome" VARCHAR(255),
    "cidade" VARCHAR(150),
    "tipo_imovel" "TipoImovel",
    "posse_imovel" "PosseImovel",
    "valor_conta" DECIMAL(10,2),
    "forma_pagamento" "FormaPagamento",
    "is_cliente_antigo" BOOLEAN,
    "situacao_especial" TEXT,
    "dados_extras" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "texto" TEXT NOT NULL,
    "status" "StatusMensagem" NOT NULL DEFAULT 'PENDING',
    "simulacao" BOOLEAN NOT NULL DEFAULT false,
    "turn_id" UUID,
    "message_timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "codigo_horario" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "booked_conversation_id" UUID,
    "booked_at" TIMESTAMP(3),

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "acao" TEXT NOT NULL,
    "parametros" JSONB,
    "resultado" TEXT NOT NULL,
    "detalhes" TEXT,
    "simulacao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_metrics" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "estimated_cost_usd" DECIMAL(10,6),
    "latency_ms" INTEGER NOT NULL,
    "acoes_executadas" JSONB,
    "simulacao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_id_tenant_id_key" ON "conversations"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_telefone_key" ON "conversations"("tenant_id", "telefone");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sheets_conversation_id_key" ON "lead_sheets"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_status_created_at_idx" ON "messages"("conversation_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_turn_id_idx" ON "messages"("conversation_id", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_external_message_id_key" ON "messages"("tenant_id", "external_message_id");

-- CreateIndex
CREATE INDEX "schedule_slots_tenant_id_disponivel_idx" ON "schedule_slots"("tenant_id", "disponivel");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_slots_tenant_id_codigo_horario_key" ON "schedule_slots"("tenant_id", "codigo_horario");

-- CreateIndex
CREATE INDEX "audit_logs_conversation_id_created_at_idx" ON "audit_logs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_conversation_id_turn_id_idx" ON "audit_logs"("conversation_id", "turn_id");

-- CreateIndex
CREATE INDEX "turn_metrics_conversation_id_created_at_idx" ON "turn_metrics"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "turn_metrics_conversation_id_turn_id_idx" ON "turn_metrics"("conversation_id", "turn_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sheets" ADD CONSTRAINT "lead_sheets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_booked_conversation_id_tenant_id_fkey" FOREIGN KEY ("booked_conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_metrics" ADD CONSTRAINT "turn_metrics_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
