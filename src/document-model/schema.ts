import { z } from "zod";

export const DOCUMENT_FORMAT_VERSION = 3;

export const CertaintySchema = z.enum(["certain", "probable", "uncertain"]);

export const BlockTypeSchema = z.enum([
  "document_title",
  "subtitle",
  "heading",
  "paragraph",
  "bullet_list",
  "ordered_list",
  "table",
  "image",
  "figure_caption",
  "table_caption",
  "reference",
  "note",
  "page_break",
  "unknown",
]);

export const ImportWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  location: z.string().optional(),
  id: z.string().optional(),
  source: z.string().optional(),
  part: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  originalValue: z.unknown().optional(),
  fallbackValue: z.unknown().optional(),
});

export const ClassificationResultSchema = z.object({
  blockId: z.string(),
  blockType: BlockTypeSchema,
  headingLevel: z.number().int().min(1).max(4).optional(),
  ruleId: z.string(),
  reason: z.string(),
  certainty: CertaintySchema,
});

const SafeMillimetersSchema = z.number().finite().min(0).max(1000);
const SafePageDimensionMmSchema = z.number().finite().min(25).max(2000);
const SafePointsSchema = z.number().finite().min(0).max(1000);

export const PageMarginsSchema = z.object({
  topMm: SafeMillimetersSchema,
  rightMm: SafeMillimetersSchema,
  bottomMm: SafeMillimetersSchema,
  leftMm: SafeMillimetersSchema,
  headerMm: SafeMillimetersSchema.optional(),
  footerMm: SafeMillimetersSchema.optional(),
  gutterMm: SafeMillimetersSchema.optional(),
});

export const LegacyMarginsMmSchema = z.object({
  top: SafeMillimetersSchema,
  right: SafeMillimetersSchema,
  bottom: SafeMillimetersSchema,
  left: SafeMillimetersSchema,
});

export const PageSettingsSchema = z
  .object({
    size: z.enum(["A4", "Letter", "Custom"]),
    widthMm: SafePageDimensionMmSchema,
    heightMm: SafePageDimensionMmSchema,
    orientation: z.enum(["portrait", "landscape"]),
    margins: PageMarginsSchema,
    marginsMm: LegacyMarginsMmSchema,
    bodyFontFamily: z.string().min(1),
    bodyFontSizePt: z.number().finite().positive(),
    lineHeight: z.number().finite().positive(),
    paragraphSpacingBeforePt: SafePointsSchema,
    paragraphSpacingAfterPt: SafePointsSchema,
    header: z.string(),
    footer: z.string(),
    pageNumbers: z.boolean(),
  })
  .superRefine((settings, context) => {
    const isLandscape = settings.orientation === "landscape";
    if (isLandscape && settings.widthMm < settings.heightMm) {
      context.addIssue({
        code: "custom",
        message: "landscape page settings require widthMm >= heightMm",
        path: ["widthMm"],
      });
    }
    if (!isLandscape && settings.widthMm > settings.heightMm) {
      context.addIssue({
        code: "custom",
        message: "portrait page settings require widthMm <= heightMm",
        path: ["widthMm"],
      });
    }
  });

export const ParagraphAlignmentSchema = z.enum(["left", "center", "right", "justify"]);

export const ParagraphFormattingSchema = z
  .object({
    alignment: ParagraphAlignmentSchema.optional(),
    indentLeftMm: z.number().finite().min(-250).max(250).optional(),
    indentRightMm: z.number().finite().min(-250).max(250).optional(),
    firstLineIndentMm: z.number().finite().min(0).max(250).optional(),
    hangingIndentMm: z.number().finite().min(0).max(250).optional(),
    spaceBeforePt: SafePointsSchema.optional(),
    spaceAfterPt: SafePointsSchema.optional(),
    lineSpacing: z
      .object({
        type: z.enum(["single", "multiple", "exact", "atLeast"]),
        value: z.number().finite().min(0).max(1000),
      })
      .optional(),
    pageBreakBefore: z.boolean().optional(),
    keepWithNext: z.boolean().optional(),
    keepLinesTogether: z.boolean().optional(),
  })
  .superRefine((formatting, context) => {
    if (formatting.firstLineIndentMm !== undefined && formatting.hangingIndentMm !== undefined) {
      context.addIssue({
        code: "custom",
        message: "firstLineIndentMm and hangingIndentMm are mutually exclusive",
        path: ["firstLineIndentMm"],
      });
    }
  });

const DocumentDefaultParagraphFormattingSchema = z.object({
  spacingBeforePt: SafePointsSchema,
  spacingAfterPt: SafePointsSchema,
  lineHeight: z.number().finite().min(1).max(3),
});

const DocumentDefaultHeadingFormattingSchema = z.object({
  spacingBeforePt: SafePointsSchema,
  spacingAfterPt: SafePointsSchema,
  lineHeight: z.number().finite().min(1).max(3).optional(),
});

export const DocumentDefaultsSchema = z.object({
  bodyParagraph: DocumentDefaultParagraphFormattingSchema,
  heading1: DocumentDefaultHeadingFormattingSchema,
  heading2: DocumentDefaultHeadingFormattingSchema,
  heading3: DocumentDefaultHeadingFormattingSchema,
  heading4: DocumentDefaultHeadingFormattingSchema,
});

export const SupportedImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/gif"]);

const Base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export const AssetSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["image", "original_docx"]),
    name: z.string().optional(),
    fileName: z.string().optional(),
    mimeType: z.string(),
    dataBase64: Base64Schema.optional(),
    path: z.string().optional(),
    altText: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    byteSize: z.number().int().nonnegative().optional(),
    widthPx: z.number().int().positive().optional(),
    heightPx: z.number().int().positive().optional(),
    sourcePart: z.string().optional(),
    relationshipId: z.string().optional(),
    checksum: z.string().optional(),
  })
  .superRefine((asset, context) => {
    if (asset.kind !== "image") return;
    if (!SupportedImageMimeTypeSchema.safeParse(asset.mimeType).success) {
      context.addIssue({
        code: "custom",
        message: "unsupported image MIME type",
        path: ["mimeType"],
      });
    }
    if (!asset.fileName && !asset.name) {
      context.addIssue({
        code: "custom",
        message: "image asset requires a file name",
        path: ["fileName"],
      });
    }
    if (!asset.dataBase64) {
      context.addIssue({
        code: "custom",
        message: "image asset requires base64 data",
        path: ["dataBase64"],
      });
      return;
    }
    const declaredSize = asset.byteSize ?? asset.sizeBytes;
    if (declaredSize !== undefined && base64ByteLength(asset.dataBase64) !== declaredSize) {
      context.addIssue({
        code: "custom",
        message: "image asset byte size does not match base64 data",
        path: ["byteSize"],
      });
    }
  });

export const MetadataSchema = z.object({
  title: z.string(),
  author: z.string().optional(),
  sourceFileName: z.string().optional(),
  importedAt: z.iso.datetime().optional(),
});

export const TiptapJsonSchema = z.unknown();

export const DocumentProjectSchema = z.object({
  formatVersion: z.literal(DOCUMENT_FORMAT_VERSION),
  metadata: MetadataSchema,
  pageSettings: PageSettingsSchema,
  documentDefaults: DocumentDefaultsSchema,
  editorContent: TiptapJsonSchema,
  assets: z.array(AssetSchema),
  warnings: z.array(ImportWarningSchema),
  classifications: z.array(ClassificationResultSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastExportedAt: z.iso.datetime().nullable(),
});

export type ImportWarning = z.infer<typeof ImportWarningSchema>;
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
export type BlockType = z.infer<typeof BlockTypeSchema>;
export type PageSettings = z.infer<typeof PageSettingsSchema>;
export type ParagraphFormatting = z.infer<typeof ParagraphFormattingSchema>;
export type DocumentDefaults = z.infer<typeof DocumentDefaultsSchema>;
export type DocumentAsset = z.infer<typeof AssetSchema>;
export type DocumentProject = z.infer<typeof DocumentProjectSchema>;

export const defaultPageSettings: PageSettings = {
  size: "A4",
  widthMm: 210,
  heightMm: 297,
  orientation: "portrait",
  margins: {
    topMm: 25,
    rightMm: 25,
    bottomMm: 25,
    leftMm: 25,
  },
  marginsMm: {
    top: 25,
    right: 25,
    bottom: 25,
    left: 25,
  },
  bodyFontFamily: "'Noto Sans CJK JP', 'Noto Sans JP', 'Yu Gothic', 'Hiragino Sans', sans-serif",
  bodyFontSizePt: 11,
  lineHeight: 1.6,
  paragraphSpacingBeforePt: 0,
  paragraphSpacingAfterPt: 6,
  header: "",
  footer: "",
  pageNumbers: true,
};

export const defaultDocumentDefaults: DocumentDefaults = {
  bodyParagraph: {
    spacingBeforePt: 0,
    spacingAfterPt: 6,
    lineHeight: 1.5,
  },
  heading1: {
    spacingBeforePt: 12,
    spacingAfterPt: 6,
    lineHeight: 1.5,
  },
  heading2: {
    spacingBeforePt: 10,
    spacingAfterPt: 6,
    lineHeight: 1.5,
  },
  heading3: {
    spacingBeforePt: 8,
    spacingAfterPt: 4,
    lineHeight: 1.5,
  },
  heading4: {
    spacingBeforePt: 6,
    spacingAfterPt: 4,
    lineHeight: 1.5,
  },
};

export const emptyTiptapDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, textAlign: "left" },
      content: [{ type: "text", text: "無題の文書" }],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "left" },
    },
  ],
};

export function createNewProject(now = new Date()): DocumentProject {
  const iso = now.toISOString();
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    metadata: {
      title: "無題の文書",
    },
    pageSettings: defaultPageSettings,
    documentDefaults: defaultDocumentDefaults,
    editorContent: emptyTiptapDocument,
    assets: [],
    warnings: [],
    classifications: [],
    createdAt: iso,
    updatedAt: iso,
    lastExportedAt: null,
  };
}

export function parseDocumentProject(value: unknown): DocumentProject {
  const project = DocumentProjectSchema.parse(value);
  validateImageAssetReferences(project);
  return project;
}

function validateImageAssetReferences(project: DocumentProject): void {
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const missing = collectMissingImageAssetIds(project.editorContent, assetIds);
  if (missing.length > 0) {
    throw new Error(`DocumentProject references missing image assets: ${missing.join(", ")}`);
  }
}

function collectMissingImageAssetIds(value: unknown, assetIds: Set<string>): string[] {
  if (typeof value !== "object" || value === null) return [];
  const node = value as { type?: unknown; attrs?: unknown; content?: unknown };
  const missing: string[] = [];
  if (node.type === "image" && typeof node.attrs === "object" && node.attrs !== null) {
    const attrs = node.attrs as { assetId?: unknown };
    if (
      typeof attrs.assetId === "string" &&
      attrs.assetId.length > 0 &&
      !assetIds.has(attrs.assetId)
    ) {
      missing.push(attrs.assetId);
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      missing.push(...collectMissingImageAssetIds(child, assetIds));
    }
  }
  return [...new Set(missing)];
}
