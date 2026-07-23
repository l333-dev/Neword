import JSZip from "jszip";

export type MinimalDocxPackageOptions = {
  documentXml: string;
  relationshipsXml?: string;
  extraFiles?: Record<string, string | Uint8Array>;
};

export async function buildMinimalDocxPackage({
  documentXml,
  relationshipsXml,
  extraFiles = {},
}: MinimalDocxPackageOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  if (relationshipsXml) {
    zip.file("word/_rels/document.xml.rels", relationshipsXml);
  }
  for (const [path, content] of Object.entries(extraFiles)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
