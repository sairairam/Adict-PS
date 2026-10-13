// Magic-byte sniffing: the declared MIME type must match the real file content.
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => starts(b, [0x25, 0x50, 0x44, 0x46]), // %PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) =>
    starts(b, [0x50, 0x4b, 0x03, 0x04]), // zip container
  "application/msword": (b) => starts(b, [0xd0, 0xcf, 0x11, 0xe0]), // OLE2
  "image/png": (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]),
  "image/jpeg": (b) => starts(b, [0xff, 0xd8, 0xff]),
  "image/tiff": (b) => starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]),
  "image/webp": (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
};

function starts(b: Uint8Array, sig: number[]) {
  return sig.every((v, i) => b[i] === v);
}

export function matchesMagicBytes(mimeType: string, head: Uint8Array) {
  return SIGNATURES[mimeType]?.(head) ?? false;
}
