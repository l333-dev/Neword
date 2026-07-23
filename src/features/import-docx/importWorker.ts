import mammoth from "mammoth/mammoth.browser";

import {
  ImportWorkerInputSchema,
  sanitizeWorkerError,
  type ImportWorkerRequest,
  type ImportWorkerResponse,
} from "./importWorkerTypes";

const cancelledRequests = new Set<string>();

function post(response: ImportWorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<ImportWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelledRequests.add(request.requestId);
    post({ type: "cancelled", requestId: request.requestId });
    return;
  }
  void handleStart(request);
};

async function handleStart(
  request: Extract<ImportWorkerRequest, { type: "start" }>,
): Promise<void> {
  const parsed = ImportWorkerInputSchema.safeParse(request.payload);
  if (!parsed.success) {
    post({
      type: "error",
      requestId: request.requestId,
      error: { stage: "input-validation", message: "Worker入力が不正です。" },
    });
    return;
  }
  const timings: Array<{ stage: "mammoth-convert"; durationMs: number }> = [];
  try {
    if (cancelledRequests.has(request.requestId)) {
      post({ type: "cancelled", requestId: request.requestId });
      return;
    }
    post({ type: "progress", requestId: request.requestId, stage: "mammoth-convert" });
    const startedAt = performance.now();
    const result = await mammoth.convertToHtml({ arrayBuffer: parsed.data.arrayBuffer });
    timings.push({ stage: "mammoth-convert", durationMs: performance.now() - startedAt });
    if (cancelledRequests.has(request.requestId)) {
      post({ type: "cancelled", requestId: request.requestId });
      return;
    }
    post({ type: "progress", requestId: request.requestId, stage: "worker-complete" });
    post({
      type: "success",
      requestId: request.requestId,
      result: {
        html: result.value,
        messages: result.messages.map((message) => ({
          type: message.type,
          message: message.message,
        })),
        timings,
      },
    });
  } catch (error) {
    post({
      type: "error",
      requestId: request.requestId,
      error: sanitizeWorkerError(error, "mammoth-convert"),
    });
  } finally {
    cancelledRequests.delete(request.requestId);
  }
}
