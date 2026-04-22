export function buildLineIndex(content) {
  const index = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) index.push(i + 1);
  }
  return index;
}

export function offsetToLineCol(lineIndex, offset) {
  if (offset < 0) return { line: 1, col: 1 };
  let lo = 0;
  let hi = lineIndex.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineIndex[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - lineIndex[lo] + 1 };
}
