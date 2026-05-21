import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractKnowledgeText } from "./document-ingest.js";

describe("extractKnowledgeText", () => {
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-document-ingest-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("projects docx headings and tables as markdown-like text", async () => {
    const zip = new JSZip();
    zip.file(
      "word/styles.xml",
      [
        `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`,
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>`,
        `</w:styles>`,
      ].join(""),
    );
    zip.file(
      "word/document.xml",
      [
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`,
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Refund Policy</w:t></w:r></w:p>`,
        `<w:p><w:r><w:t>Customers can request refunds within 7 days.</w:t></w:r></w:p>`,
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Channel</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SLA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
        `</w:body></w:document>`,
      ].join(""),
    );
    const target = path.join(tmpDir, "manual.docx");
    await fs.writeFile(target, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await extractKnowledgeText(target);

    expect(result.text).toContain("# Refund Policy");
    expect(result.text).toContain("Customers can request refunds");
    expect(result.text).toContain("### Table 1");
    expect(result.text).toContain("| Channel | SLA |");
  });

  it("projects xlsx rows with sheet names, headers, and cell refs", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      [
        `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
        `<sheets><sheet name="FAQ" sheetId="1" r:id="rId1"/></sheets>`,
        `</workbook>`,
      ].join(""),
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/sharedStrings.xml",
      [
        `<sst>`,
        `<si><t>Question</t></si><si><t>Answer</t></si>`,
        `<si><t>Refund window</t></si><si><t>7 days</t></si>`,
        `</sst>`,
      ].join(""),
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      [
        `<worksheet><sheetData>`,
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`,
        `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>`,
        `</sheetData></worksheet>`,
      ].join(""),
    );
    const target = path.join(tmpDir, "faq.xlsx");
    await fs.writeFile(target, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await extractKnowledgeText(target);

    expect(result.text).toContain("## Sheet: FAQ");
    expect(result.text).toContain("Question(A2)=Refund window");
    expect(result.text).toContain("Answer(B2)=7 days");
  });
});
