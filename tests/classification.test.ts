import { describe, expect, it } from "vitest";

import { classifyBlock } from "../src/classification/rules";

describe("rule-based classification", () => {
  it("classifies Japanese school report headings", () => {
    const result = classifyBlock({ blockId: "b1", text: "実験目的" });
    expect(result.blockType).toBe("heading");
    expect(result.headingLevel).toBe(2);
  });

  it("classifies figure and table captions", () => {
    expect(classifyBlock({ blockId: "f1", text: "図 1 実験装置" }).blockType).toBe("figure_caption");
    expect(classifyBlock({ blockId: "t1", text: "表1 測定結果" }).blockType).toBe("table_caption");
  });

  it("prioritizes explicit Word heading style", () => {
    const result = classifyBlock({ blockId: "h1", text: "任意", styleName: "Heading 1" });
    expect(result.blockType).toBe("heading");
    expect(result.headingLevel).toBe(1);
    expect(result.certainty).toBe("certain");
  });
});
