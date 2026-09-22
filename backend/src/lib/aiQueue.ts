import Anthropic from "@anthropic-ai/sdk";
import { Queue, QueueEvents, UnrecoverableError, Worker, type Job } from "bullmq";
import { getBullRedis } from "./redis";
import { getAiProvider, type AiGenerateResult } from "./aiProvider";

export const AI_QUEUE_NAME = "ai-generate";

/** What a caller enqueues. `tenantId` and `promptType` are carried for logging only; the
 *  quota check and the increment-on-success both happen in ai.orchestrator.ts, around the
 *  enqueue, not inside the job itself. */
export interface AiJobData {
  tenantId: string;
  promptType: string;
  system: string;
  prompt: string;
  maxTokens: number;
}

let queue: Queue<AiJobData, AiGenerateResult> | undefined;
let events: QueueEvents | undefined;
let worker: Worker<AiJobData, AiGenerateResult> | undefined;

/**
 * All AI calls go through this queue rather than being awaited synchronously in a request
 * handler (Implementation_Plan.md Phase 4: "protects the API from slow LLM latency and gives
 * a single choke point for rate limiting"). Lazily created so scripts that never touch AI
 * features don't open a BullMQ connection.
 */
export function getAiQueue(): Queue<AiJobData, AiGenerateResult> {
  queue ??= new Queue<AiJobData, AiGenerateResult>(AI_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

/** Lets ai.orchestrator.ts await a job's outcome without polling. */
export function getAiQueueEvents(): QueueEvents {
  events ??= new QueueEvents(AI_QUEUE_NAME, { connection: getBullRedis() });
  return events;
}

/**
 * Starts the worker that actually calls the provider adapter. Called once from src/index.ts;
 * this is a single-process app (Implementation_Plan.md's stack has no separate worker
 * deployment yet), so the queue and its worker share the API process.
 */
export function startAiWorker(): Worker<AiJobData, AiGenerateResult> {
  if (worker) return worker;
  worker = new Worker<AiJobData, AiGenerateResult>(
    AI_QUEUE_NAME,
    async (job: Job<AiJobData>) => {
      try {
        return await getAiProvider().generate({
          system: job.data.system,
          prompt: job.data.prompt,
          maxTokens: job.data.maxTokens,
        });
      } catch (err) {
        // A bad request, an invalid key, or a model ZYRO isn't allowed to use will never
        // succeed on retry, so stop after the first attempt instead of burning the other two.
        if (err instanceof Anthropic.APIError && err.status !== undefined && err.status < 500 && err.status !== 429) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    { connection: getBullRedis(), concurrency: 4 }
  );
  worker.on("error", (err) => console.error("AI worker error:", err.message));
  return worker;
}

export async function closeAiQueue(): Promise<void> {
  await worker?.close();
  await events?.close();
  await queue?.close();
  worker = undefined;
  events = undefined;
  queue = undefined;
}
