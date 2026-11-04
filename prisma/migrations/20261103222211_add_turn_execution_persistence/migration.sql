-- CreateTable
CREATE TABLE "turn_steps" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "content" TEXT,
    "tool_calls" JSONB,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "estimated_cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(100) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "call_index" INTEGER NOT NULL,
    "tool_name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "simulacao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turn_steps_conversation_id_turn_id_idx" ON "turn_steps"("conversation_id", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "turn_steps_tenant_id_turn_id_step_index_key" ON "turn_steps"("tenant_id", "turn_id", "step_index");

-- CreateIndex
CREATE INDEX "tool_executions_conversation_id_turn_id_idx" ON "tool_executions"("conversation_id", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_executions_tenant_id_turn_id_step_index_call_index_key" ON "tool_executions"("tenant_id", "turn_id", "step_index", "call_index");

-- AddForeignKey
ALTER TABLE "turn_steps" ADD CONSTRAINT "turn_steps_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversations"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
