// Shared status (RAG) indicator: a plain coloured circle. The status name is
// exposed as a tooltip and as an accessible label rather than printed.
const RAG_META = {
  GREEN: { cls: 'rag-green', label: 'Green - On Track' },
  YELLOW: { cls: 'rag-yellow', label: 'Yellow - At Risk' },
  RED: { cls: 'rag-red', label: 'Red - Intervention Required' },
};

function ragDot(status, size) {
  const meta = RAG_META[status];
  if (!meta) return '<span class="text-muted">&ndash;</span>';
  return `<span class="al-rag-dot ${meta.cls}${size ? ` ${size}` : ''}" role="img" aria-label="${meta.label}" title="${meta.label}"></span>`;
}

// Kept as the name the page scripts already call.
function ragBadge(status) {
  return ragDot(status);
}
