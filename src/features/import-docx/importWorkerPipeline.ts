import type { OpenDocxResult } from "../../project/fileAccess";
import type { ImportResult, SourceFileInfo } from "./importDocx";
import type { ImportWorkerStage } from "./importWorkerTypes";

export async function convertOpenedDocxWithWorker({
  opened,
  requestId,
  isActive,
  onWorkerStage,
  onCancelReady,
}: {
  opened: OpenDocxResult;
  requestId: string;
  isActive: (requestId: string) => boolean;
  onWorkerStage: (stage: ImportWorkerStage) => void;
  onCancelReady: (cancel: () => void) => void;
}): Promise<ImportResult | null> {
  const [{ buildImportResultFromMammothHtml }, { startImportWorker }] = await Promise.all([
    import("./importDocx"),
    import("./importWorkerClient"),
  ]);
  const sourceInfo = buildSourceInfoFromOpened(opened);
  const arrayBuffer = base64ToArrayBuffer(opened.base64);
  const workerClient = startImportWorker(
    { arrayBuffer, sourceInfo },
    (stage) => {
      if (!isActive(requestId)) return;
      onWorkerStage(stage);
    },
    requestId,
  );
  onCancelReady(workerClient.cancel);
  const workerResult = await workerClient.result;
  if (!isActive(requestId)) return null;
  return buildImportResultFromMammothHtml({
    mammothResult: { value: workerResult.html, messages: workerResult.messages },
    sourceInfo,
    inspection: opened.inspection,
  });
}

function buildSourceInfoFromOpened(opened: OpenDocxResult): SourceFileInfo {
  return {
    name: opened.name,
    sizeBytes: opened.inspection.entries.reduce((sum, entry) => sum + entry.compressed_size, 0),
    path: opened.path,
    inspectedAt: new Date().toISOString(),
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
