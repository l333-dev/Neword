import type { BlockType, ClassificationResult } from "../document-model/schema";

export type ClassificationInput = {
  blockId: string;
  text: string;
  styleName?: string;
  headingLevel?: number;
  isBulletList?: boolean;
  isOrderedList?: boolean;
  isTable?: boolean;
  isImage?: boolean;
  isPageBreak?: boolean;
  marks?: string[];
};

type Rule = {
  id: string;
  classify: (input: ClassificationInput) => ClassificationResult | null;
};

const schoolHeadingPattern =
  /^(実験目的|使用機器|実験方法|実験結果|考察|結論|参考文献|報告事項|検討課題)$/;

function result(
  input: ClassificationInput,
  blockType: BlockType,
  ruleId: string,
  reason: string,
  headingLevel?: number,
): ClassificationResult {
  return {
    blockId: input.blockId,
    blockType,
    headingLevel,
    ruleId,
    reason,
    certainty: ruleId.startsWith("style") ? "certain" : "probable",
  };
}

export const classificationRules: Rule[] = [
  {
    id: "style.heading",
    classify: (input) => {
      const style = input.styleName?.toLowerCase();
      if (style?.includes("heading") || style?.includes("見出し")) {
        const match = style.match(/[1-4]/);
        const level = input.headingLevel ?? (match ? Number(match[0]) : 1);
        return result(input, "heading", "style.heading", `Word style indicates heading ${level}`, level);
      }
      return null;
    },
  },
  {
    id: "list.kind",
    classify: (input) => {
      if (input.isBulletList) {
        return result(input, "bullet_list", "list.bullet", "Block has bullet list metadata");
      }
      if (input.isOrderedList) {
        return result(input, "ordered_list", "list.ordered", "Block has ordered list metadata");
      }
      return null;
    },
  },
  {
    id: "structure.kind",
    classify: (input) => {
      if (input.isTable) return result(input, "table", "structure.table", "Block is a table");
      if (input.isImage) return result(input, "image", "structure.image", "Block is an image");
      if (input.isPageBreak) {
        return result(input, "page_break", "structure.page_break", "Block is a page break");
      }
      return null;
    },
  },
  {
    id: "text.school_heading",
    classify: (input) =>
      schoolHeadingPattern.test(input.text.trim())
        ? result(input, "heading", "text.school_heading", "Japanese school report heading pattern", 2)
        : null,
  },
  {
    id: "text.figure_caption",
    classify: (input) =>
      /^図\s*\d+/.test(input.text.trim())
        ? result(input, "figure_caption", "text.figure_caption", "Figure caption pattern")
        : null,
  },
  {
    id: "text.table_caption",
    classify: (input) =>
      /^表\s*\d+/.test(input.text.trim())
        ? result(input, "table_caption", "text.table_caption", "Table caption pattern")
        : null,
  },
  {
    id: "text.reference",
    classify: (input) =>
      /^(参考文献|References?)$/i.test(input.text.trim())
        ? result(input, "reference", "text.reference", "Reference section pattern", 2)
        : null,
  },
];

export function classifyBlock(input: ClassificationInput): ClassificationResult {
  for (const rule of classificationRules) {
    const classification = rule.classify(input);
    if (classification) return classification;
  }

  return {
    blockId: input.blockId,
    blockType: input.text.trim() ? "paragraph" : "unknown",
    ruleId: "fallback.paragraph_or_unknown",
    reason: input.text.trim() ? "Default paragraph fallback" : "Empty or unsupported block",
    certainty: input.text.trim() ? "probable" : "uncertain",
  };
}
