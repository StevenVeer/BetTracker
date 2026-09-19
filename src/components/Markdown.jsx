// Kleine, bewust beperkte markdown-renderer - alleen wat de door Claude
// geschreven rapporten gebruiken (headings, **bold**, tabellen, lijstjes,
// paragrafen). Geen dependency voor de volledige markdown-spec nodig.
function renderInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

function parseBlocks(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ type: 'heading', level: line.match(/^#+/)[0].length, text: line.replace(/^#{1,6}\s/, '').trim() });
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'table', lines: tableLines });
      continue;
    }
    if (/^[-*]\s/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*]\s/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }
  return blocks;
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export default function Markdown({ content }) {
  const blocks = parseBlocks(content || '');
  return (
    <div className="markdown">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const Tag = `h${Math.min(block.level + 2, 6)}`;
          return <Tag key={idx}>{renderInline(block.text, idx)}</Tag>;
        }
        if (block.type === 'paragraph') {
          return <p key={idx}>{renderInline(block.text, idx)}</p>;
        }
        if (block.type === 'list') {
          return (
            <ul key={idx}>
              {block.items.map((item, i2) => (
                <li key={i2}>{renderInline(item, `${idx}-${i2}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'table') {
          const rows = block.lines
            .map(parseTableRow)
            .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
          const [header, ...body] = rows;
          if (!header) return null;
          return (
            <div className="table-wrap" key={idx}>
              <table className="ledger-table markdown-table">
                <thead>
                  <tr>
                    {header.map((cell, hi) => (
                      <th key={hi}>{renderInline(cell, `${idx}-h-${hi}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>{renderInline(cell, `${idx}-${ri}-${ci}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
