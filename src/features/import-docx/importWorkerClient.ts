import type {
  ImportWorkerInput,
  ImportWorkerResponse,
  ImportWorkerResult,
  ImportWorkerStage,
  SafeImportError,
} from "./importWorkerTypes";

export type ImportWorkerClient = {
  requestId: string;
  result: Promise<ImportWorkerResult>;
  cancel: () => void;
};

class ImportWorkerClientError extends Error implements SafeImportError {
  stage: SafeImportError["stage"];

  constructor(error: SafeImportError) {
    super(error.message);
    this.name = "ImportWorkerClientError";
    this.stage = error.stage;
  }
}

function workerClientError(error: SafeImportError): ImportWorkerClientError {
  return new ImportWorkerClientError(error);
}

export function startImportWorker(
  input: ImportWorkerInput,
  onProgress: (stage: ImportWorkerStage) => void,
  requestId: string = crypto.randomUUID(),
): ImportWorkerClient {
  const worker = new Worker(new URL("./importWorker.ts", import.meta.url), { type: "module" });
  let settled = false;
  let cancelled = false;
  let rejectResult: ((error: ImportWorkerClientError) => void) | null = null;

  const result = new Promise<ImportWorkerResult>((resolve, reject) => {
    rejectResult = reject;
    worker.onmessage = (event: MessageEvent<ImportWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestId || settled) return;
      if (response.type === "progress") {
        onProgress(response.stage);
        return;
      }
      if (response.type === "success") {
        if (cancelled) return;
        settled = true;
        worker.terminate();
        resolve(response.result);
        return;
      }
      if (response.type === "cancelled") {
        settled = true;
        worker.terminate();
        reject(
          workerClientError({
            stage: "worker-cancelled",
            message: "DOCX読み込みをキャンセルしました。",
          }),
        );
        return;
      }
      settled = true;
      worker.terminate();
      reject(workerClientError(response.error));
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(
        workerClientError({
          stage: "unknown",
          message: "DOCX変換Workerでエラーが発生しました。",
        }),
      );
    };
    worker.postMessage(
      {
        type: "start",
        requestId,
        payload: input,
      },
      [input.arrayBuffer],
    );
  });

  return {
    requestId,
    result,
    cancel() {
      if (settled) return;
      cancelled = true;
      worker.postMessage({ type: "cancel", requestId });
      worker.terminate();
      settled = true;
      rejectResult?.(
        workerClientError({
          stage: "worker-cancelled",
          message: "DOCX読み込みをキャンセルしました。",
        }),
      );
    },
  };
}
