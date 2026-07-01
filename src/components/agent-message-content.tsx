import { Fragment, type ReactNode } from "react";

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+?\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function renderTextWithBreaks(text: string) {
  return text.split("\n").map((line, index) => (
    <Fragment key={`${line}-${index}`}>
      {index > 0 && <br />}
      {renderInlineMarkdown(line)}
    </Fragment>
  ));
}

function bulletText(line: string) {
  return line.replace(/^[-*]\s+/, "").trim();
}

function numberedText(line: string) {
  return line.replace(/^\d+[.)]\s+/, "").trim();
}

export function AgentMessageContent({ content }: { content: string }) {
  const blocks = content
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return null;

  return (
    <div className="agent-message-content">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isBulletList = lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line));
        const isNumberedList = lines.length > 1 && lines.every((line) => /^\d+[.)]\s+/.test(line));

        if (isBulletList) {
          return (
            <ul key={`${block}-${index}`}>
              {lines.map((line) => (
                <li key={line}>{renderInlineMarkdown(bulletText(line))}</li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={`${block}-${index}`}>
              {lines.map((line) => (
                <li key={line}>{renderInlineMarkdown(numberedText(line))}</li>
              ))}
            </ol>
          );
        }

        return <p key={`${block}-${index}`}>{renderTextWithBreaks(block)}</p>;
      })}
    </div>
  );
}
