// PDFKit 0.20.2 ships JavaScript without a document type. This names only the
// calls the grant PDF uses. It does not add attachments or JavaScript.

declare module "pdfkit" {
  class PDFDocument {
    constructor(options?: {
      size?: string;
      margin?: number;
      // PDFKit writes the XMP packet only when this is newer than 1.3.
      pdfVersion?: "1.4";
      lang?: string;
      info?: {
        Title?: string;
        Subject?: string;
        Creator?: string;
        Producer?: string;
      };
    });
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(text: string, options?: { align?: string; width?: number }): this;
    text(text: string, x: number, y: number, options?: { align?: string; width?: number }): this;
    moveDown(lines?: number): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    addPage(): this;
    end(): void;
    x: number;
    y: number;
    page: {
      width: number;
      height: number;
      margins: { left: number; right: number; top: number; bottom: number };
    };
  }

  export { PDFDocument };
}
