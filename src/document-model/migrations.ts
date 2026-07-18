import { defaultDocumentDefaults, parseDocumentProject, type DocumentProject } from "./schema";

export function migrateDocumentProject(value: unknown): DocumentProject {
  if (typeof value === "object" && value !== null) {
    const versioned = value as Record<string, unknown>;
    if (versioned.formatVersion === 1 || versioned.formatVersion === 2) {
      versioned.formatVersion = 3;
    }
    migratePageSettings(versioned);
    migrateDocumentDefaults(versioned);
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

function migrateDocumentDefaults(project: Record<string, unknown>): void {
  if (typeof project.documentDefaults === "object" && project.documentDefaults !== null) return;
  const pageSettings =
    typeof project.pageSettings === "object" && project.pageSettings !== null
      ? (project.pageSettings as Record<string, unknown>)
      : {};
  const lineHeight = numberOrDefault(
    pageSettings.lineHeight,
    defaultDocumentDefaults.bodyParagraph.lineHeight,
  );
  const spacingBeforePt = numberOrDefault(
    pageSettings.paragraphSpacingBeforePt,
    defaultDocumentDefaults.bodyParagraph.spacingBeforePt,
  );
  const spacingAfterPt = numberOrDefault(
    pageSettings.paragraphSpacingAfterPt,
    defaultDocumentDefaults.bodyParagraph.spacingAfterPt,
  );

  project.documentDefaults = {
    ...defaultDocumentDefaults,
    bodyParagraph: {
      spacingBeforePt,
      spacingAfterPt,
      lineHeight,
    },
  };
}

function migratePageSettings(project: Record<string, unknown>): void {
  if (typeof project.pageSettings !== "object" || project.pageSettings === null) return;
  const pageSettings = project.pageSettings as Record<string, unknown>;
  const marginsMm =
    typeof pageSettings.marginsMm === "object" && pageSettings.marginsMm !== null
      ? (pageSettings.marginsMm as Record<string, unknown>)
      : {};
  const top = numberOrDefault(marginsMm.top, 25);
  const right = numberOrDefault(marginsMm.right, 25);
  const bottom = numberOrDefault(marginsMm.bottom, 25);
  const left = numberOrDefault(marginsMm.left, 25);
  const orientation = pageSettings.orientation === "landscape" ? "landscape" : "portrait";

  pageSettings.size =
    pageSettings.size === "Letter" || pageSettings.size === "Custom" ? pageSettings.size : "A4";
  pageSettings.widthMm =
    typeof pageSettings.widthMm === "number"
      ? pageSettings.widthMm
      : orientation === "landscape"
        ? 297
        : 210;
  pageSettings.heightMm =
    typeof pageSettings.heightMm === "number"
      ? pageSettings.heightMm
      : orientation === "landscape"
        ? 210
        : 297;
  pageSettings.margins = {
    ...(typeof pageSettings.margins === "object" && pageSettings.margins !== null
      ? pageSettings.margins
      : {}),
    topMm: numberOrDefault(
      (pageSettings.margins as Record<string, unknown> | undefined)?.topMm,
      top,
    ),
    rightMm: numberOrDefault(
      (pageSettings.margins as Record<string, unknown> | undefined)?.rightMm,
      right,
    ),
    bottomMm: numberOrDefault(
      (pageSettings.margins as Record<string, unknown> | undefined)?.bottomMm,
      bottom,
    ),
    leftMm: numberOrDefault(
      (pageSettings.margins as Record<string, unknown> | undefined)?.leftMm,
      left,
    ),
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
