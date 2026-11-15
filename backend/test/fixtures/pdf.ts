/** Small real PDFs with correct object offsets and xref; no downloads or fixture generators. */
export function pdfFixture({ pageCount = 1, text = 'Alex Trojan - TypeScript and campus projects', encrypted = false, paddingBytes = 0 } = {}): Uint8Array {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const escaped = text.replace(/([\\()])/gu, '\\$1');
  for (let index = 0; index < pageCount; index++) {
    const contentId = 5 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let encryptionId: number | undefined;
  if (encrypted) {
    encryptionId = objects.length + 1;
    objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'01'.repeat(32)}> /U <${'02'.repeat(32)}> /P -4 >>`);
  }
  let source = '%PDF-1.7\n' + (paddingBytes ? `%${'x'.repeat(paddingBytes)}\n` : '');
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptionId ? ` /Encrypt ${encryptionId} 0 R /ID [<${'03'.repeat(16)}> <${'03'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source));
}
