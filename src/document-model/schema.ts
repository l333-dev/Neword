import { z } from "zod";

export const DOCUMENT_FORMAT_VERSION = 1;

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
});

export const ClassificationResultSchema = z.object({
  blockId: z.string(),
  blockType: BlockTypeSchema,
  headingLevel: z.number().int().min(1).max(4).optional(),
  ruleId: z.string(),
  reason: z.string(),
  certainty: CertaintySchema,
});

export const PageSettingsSchema = z.object({
  size: z.enum(["A4"]),
  orientation: z.enum(["portrait", "landscape"]),
  marginsMm: z.object({
    top: z.number().positive(),
    right: z.number().positive(),
    bottom: z.number().positive(),
    left: z.number().positive(),
  }),
  bodyFontFamily: z.string().min(1),
  bodyFontSizePt: z.number().positive(),
  lineHeight: z.number().positive(),
  paragraphSpacingBeforePt: z.number().min(0),
  paragraphSpacingAfterPt: z.number().min(0),
  header: z.string(),
  footer: z.string(),
  pageNumbers: z.boolean(),
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
      context.addIssue({ code: "custom", message: "image asset requires a file name", path: ["fileName"] });
    }
    if (!asset.dataBase64) {
      context.addIssue({ code: "custom", message: "image asset requires base64 data", path: ["dataBase64"] });
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
export type DocumentAsset = z.infer<typeof AssetSchema>;
export type DocumentProject = z.infer<typeof DocumentProjectSchema>;

export const defaultPageSettings: PageSettings = {
  size: "A4",
  orientation: "portrait",
  marginsMm: {
    top: 25,
    right: 25,
    bottom: 25,
    left: 25,
  },
  bodyFontFamily:
    "'Noto Sans CJK JP', 'Noto Sans JP', 'Yu Gothic', 'Hiragino Sans', sans-serif",
  bodyFontSizePt: 11,
  lineHeight: 1.6,
  paragraphSpacingBeforePt: 0,
  paragraphSpacingAfterPt: 6,
  header: "",
  footer: "",
  pageNumbers: true,
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
    if (typeof attrs.assetId === "string" && attrs.assetId.length > 0 && !assetIds.has(attrs.assetId)) {
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
