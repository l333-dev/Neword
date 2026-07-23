import { z } from "zod";

import type { SourceFileInfo } from "./importDocx";

export const IMPORT_WORKER_STAGES = [
  "mammoth-convert",
  "worker-cancelled",
  "worker-complete",
] as const;

export type ImportWorkerStage = (typeof IMPORT_WORKER_STAGES)[number];

export const ImportWorkerInputSchema = z.object({
  arrayBuffer: z.instanceof(ArrayBuffer),
  sourceInfo: z.object({
    name: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    path: z.string().optional(),
    inspectedAt: z.string(),
  }),
});

export type ImportWorkerInput = {
  arrayBuffer: ArrayBuffer;
  sourceInfo: SourceFileInfo;
};

export type ImportWorkerMammothMessage = {
  type: string;
  message: string;
};

export type ImportWorkerResult = {
  html: string;
  messages: ImportWorkerMammothMessage[];
  timings: Array<{ stage: ImportWorkerStage; durationMs: number }>;
};

export type SafeImportError = {
  stage: ImportWorkerStage | "input-validation" | "unknown";
  message: string;
};

export type ImportWorkerRequest =
  | {
      type: "start";
      requestId: string;
      payload: ImportWorkerInput;
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type ImportWorkerResponse =
  | {
      type: "progress";
      requestId: string;
      stage: ImportWorkerStage;
      detail?: string;
    }
  | {
      type: "success";
      requestId: string;
      result: ImportWorkerResult;
    }
  | {
      type: "cancelled";
      requestId: string;
    }
  | {
      type: "error";
      requestId: string;
      error: SafeImportError;
    };

export function sanitizeWorkerError(
  error: unknown,
  stage: SafeImportError["stage"],
): SafeImportError {
  const message = error instanceof Error ? error.message : "DOCX変換に失敗しました。";
  return {
    stage,
    message: message.replace(/data:[^,\s]+,[A-Za-z0-9+/=]+/g, "[data omitted]").slice(0, 400),
  };
}
