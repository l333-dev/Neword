import { parseDocumentProject, type DocumentProject } from "./schema";

export function migrateDocumentProject(value: unknown): DocumentProject {
  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      warnings?: unknown;
    };
    if (Array.isArray(candidate.warnings)) {
      const warnings: unknown[] = candidate.warnings;
      candidate.warnings = warnings.map((warning): unknown => {
        if (typeof warning !== "object" || warning === null || "code" in warning) {
          return warning;
        }
        const legacyWarning = warning as Record<string, unknown>;
        return {
          ...legacyWarning,
          code:
            typeof legacyWarning.id === "string"
              ? legacyWarning.id
              : typeof legacyWarning.source === "string"
                ? legacyWarning.source
                : "legacy.import_warning",
        };
      });
    }
    const assetsCandidate = value as { assets?: unknown };
    if (Array.isArray(assetsCandidate.assets)) {
      const assets: unknown[] = assetsCandidate.assets;
      assetsCandidate.assets = assets.map((asset): unknown => {
        if (typeof asset !== "object" || asset === null) return asset;
        const record = asset as Record<string, unknown>;
        if (record.kind !== "image") return asset;
        return {
          ...record,
          fileName: typeof record.fileName === "string" ? record.fileName : record.name,
          byteSize: typeof record.byteSize === "number" ? record.byteSize : record.sizeBytes,
        };
      });
    }
  }
  return parseDocumentProject(value);
}
