export async function* readCsvRows(
  stream: NodeJS.ReadableStream,
  opts: { delimiter?: string } = {},
): AsyncGenerator<Record<string, string>> {
  const delimiter = opts.delimiter ?? ",";
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let skipLf = false;
  let firstCharacter = true;
  let headers: string[] | null = null;

  const emitRow = () => {
    row.push(field);
    field = "";
    const values = row;
    row = [];
    if (!headers) {
      headers = values.map((header) => header.trim());
      return null;
    }
    if (values.length === 1 && values[0] === "" && headers.length > 1) return null;
    const result: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (header) result[header] = values[index] ?? "";
    }
    return result;
  };

  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const text = chunk.toString();
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!;
      if (skipLf) {
        skipLf = false;
        if (character === "\n") continue;
      }
      if (firstCharacter) {
        firstCharacter = false;
        if (character === "\uFEFF") continue;
      }
      if (afterQuote) {
        if (character === '"') {
          field += '"';
          afterQuote = false;
          continue;
        }
        inQuotes = false;
        afterQuote = false;
      }
      if (inQuotes) {
        if (character === '"') afterQuote = true;
        else field += character;
        continue;
      }
      if (character === '"') {
        inQuotes = true;
      } else if (character === delimiter) {
        row.push(field);
        field = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r") skipLf = true;
        const result = emitRow();
        if (result) yield result;
      } else {
        field += character;
      }
    }
  }
  if (inQuotes && afterQuote) {
    inQuotes = false;
    afterQuote = false;
  }
  if (field.length > 0 || row.length > 0) {
    const result = emitRow();
    if (result) yield result;
  }
}
