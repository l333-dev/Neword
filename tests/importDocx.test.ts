import { describe, expect, it } from "vitest";

import { blocksFromHtml } from "../src/features/import-docx/importDocx";

describe("DOCX import preview blocks", () => {
  it("handles Japanese paragraphs and headings", () => {
    const blocks = blocksFromHtml("<h1>実験目的</h1><p>日本語の段落です。</p>");
    expect(blocks[0]?.classification.blockType).toBe("heading");
    expect(blocks[1]?.text).toBe("日本語の段落です。");
  });

  it("handles lists, tables, images, and captions", () => {
    const blocks = blocksFromHtml("<ul><li>a</li></ul><ol><li>b</li></ol><table><tr><td>c</td></tr></table><p>図1 装置</p><p>表 1 結果</p><p><img src=\"x\" alt=\"y\"></p>");
    expect(blocks.map((block) => block.classification.blockType)).toContain("bullet_list");
    expect(blocks.map((block) => block.classification.blockType)).toContain("ordered_list");
    expect(blocks.map((block) => block.classification.blockType)).toContain("table");
    expect(blocks.map((block) => block.classification.blockType)).toContain("figure_caption");
    expect(blocks.map((block) => block.classification.blockType)).toContain("table_caption");
    expect(blocks.map((block) => block.classification.blockType)).toContain("image");
  });

  it("is deterministic", () => {
    const html = "<p>考察</p><p>本文</p>";
    expect(blocksFromHtml(html)).toEqual(blocksFromHtml(html));
  });
});
