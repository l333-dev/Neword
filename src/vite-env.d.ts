/// <reference types="vite/client" />

declare module "mammoth/mammoth.browser" {
  export type MammothMessage = {
    type: string;
    message: string;
  };

  export type MammothHtmlResult = {
    value: string;
    messages: MammothMessage[];
  };

  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothHtmlResult>;
  };

  export default mammoth;
}
