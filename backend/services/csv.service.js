// Minimal CSV reader (RFC 4180 style): quoted fields, doubled quotes, commas or
// line breaks inside quotes. The delimiter is detected from the first line, so a
// file saved by Excel with ";" (some regional settings) or a tab also works.
// Returns { rows } (arrays of strings) or { error } for a malformed file.
function parseCsv(input) {
    const text = String(input || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
        ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let sawContent = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"' && field === '') {
            inQuotes = true;
            sawContent = true;
        } else if (c === delimiter) {
            row.push(field);
            field = '';
            sawContent = true;
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            sawContent = false;
        } else if (c !== '\r') {
            field += c;
            sawContent = true;
        }
    }
    if (inQuotes) return { error: 'The file has a quotation mark that is never closed.' };
    if (sawContent || field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return { rows };
}

// Quotes a value for CSV output when needed.
function csvCell(value) {
    const s = String(value ?? '');
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { parseCsv, csvCell };
