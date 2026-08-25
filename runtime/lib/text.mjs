import { round } from "./core.mjs";

function characterUnits(char) {
  if (/\s/u.test(char)) return 0.35;
  if (/^[\x00-\x7F]$/u.test(char)) return /[A-Z0-9]/u.test(char) ? 0.62 : 0.54;
  return 1;
}

export function measureLine(text, fontSize = 20) {
  const units = Array.from(String(text)).reduce((sum, char) => sum + characterUnits(char), 0);
  return round(Math.max(fontSize, units * fontSize));
}

export function wrapText(text, maxWidth, fontSize = 20) {
  const sourceLines = String(text).split(/\r?\n/u);
  const lines = [];
  for (const source of sourceLines) {
    let current = "";
    for (const char of Array.from(source)) {
      if (current && measureLine(current + char, fontSize) > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    lines.push(current || " ");
  }
  return lines.join("\n");
}

export function measureText(text, fontSize = 20, maxWidth = Infinity) {
  const wrapped = Number.isFinite(maxWidth) ? wrapText(text, maxWidth, fontSize) : String(text);
  const lines = wrapped.split("\n");
  const width = Math.max(...lines.map((line) => measureLine(line, fontSize)));
  const lineHeight = 1.25;
  return {
    text: wrapped,
    width: round(width),
    height: round(lines.length * fontSize * lineHeight),
    lineHeight,
  };
}
