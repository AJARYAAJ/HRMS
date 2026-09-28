/**
 * Dependency-free PDF writer for letters and policies: letterhead, word-wrapped paragraphs, multiple pages.
 * Uses the standard Helvetica fonts (WinAnsi), so text is transliterated to Latin-1 (₹ becomes "Rs.").
 */

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 60;
const LINE = 15;

const latin1 = (t) => String(t ?? '')
  .replace(/₹/g, 'Rs. ')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
  .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');
const esc = (t) => latin1(t).replace(/[\\()]/g, (c) => `\\${c}`);

/** Wrap a paragraph to a character budget (Helvetica 11pt ≈ 95 chars across an A4 text column). */
function wrap(text, width = 92) {
  const out = [];
  for (const para of latin1(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) { out.push(line); line = word; } else line = `${line} ${word}`.trim();
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {object} doc
 * @param {string} doc.title         heading
 * @param {string} [doc.company]     letterhead name
 * @param {string} [doc.address]     letterhead address line
 * @param {string} doc.body          text; blank lines separate paragraphs
 * @param {string} [doc.footer]      small footer text on every page
 */
export function buildPdf({ title, company, address, body, footer }) {
  const lines = wrap(body);
  const usable = PAGE_H - MARGIN * 2 - 110;
  const perPage = Math.floor(usable / LINE);
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) pages.push(lines.slice(i, i + perPage));

  const contents = pages.map((pageLines, p) => {
    const ops = [];
    if (company) {
      ops.push('0.31 0.27 0.9 rg', `0 ${PAGE_H - 70} ${PAGE_W} 70 re f`, '1 1 1 rg');
      ops.push(`BT /F2 16 Tf ${MARGIN} ${PAGE_H - 38} Td (${esc(company)}) Tj ET`);
      if (address) ops.push(`BT /F1 9 Tf ${MARGIN} ${PAGE_H - 54} Td (${esc(address)}) Tj ET`);
      ops.push('0 0 0 rg');
    }
    let y = PAGE_H - 110;
    if (p === 0 && title) {
      ops.push(`BT /F2 14 Tf ${MARGIN} ${y} Td (${esc(title)}) Tj ET`);
      y -= 28;
    }
    for (const l of pageLines) {
      if (l) ops.push(`BT /F1 11 Tf ${MARGIN} ${y} Td (${esc(l)}) Tj ET`);
      y -= LINE;
    }
    ops.push('0.45 0.45 0.5 rg', `BT /F1 8 Tf ${MARGIN} 30 Td (${esc(footer || '')}${pages.length > 1 ? `   Page ${p + 1} of ${pages.length}` : ''}) Tj ET`);
    return ops.join('\n');
  });

  // Object layout: 1 catalog, 2 pages, 3 font regular, 4 font bold, then (page, content) pairs.
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  contents.forEach((c) => {
    const pageNo = objs.length + 1;
    kids.push(`${pageNo} 0 R`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
