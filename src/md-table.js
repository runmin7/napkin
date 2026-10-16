// 마크다운 표 문법만 다루는 순수 함수 모음.
//
// 이 파일은 CodeMirror를 모른다. 줄 하나(문자열)를 받아 표의 어떤 줄인지 가려내고,
// 다음에 놓을 줄을 만들어 돌려주는 일만 한다. 편집기에 붙이는 일은 editor-engine이 한다.
//
// 표를 문법 트리가 아니라 글자로 판정하는 데는 이유가 있다. 마크다운 파서는 구분선
// (| --- |)이 나타나기 전까지 표를 표로 보지 않는다. 그런데 이 기능이 도와야 할 순간이
// 바로 "머리 행만 써 놓은" 그 순간이라, 파서에 기대면 정작 필요할 때 아무것도 모른다.

// 표의 줄인가. 앞 공백을 뺀 첫 글자가 |이면 표로 본다.
// 줄 가운데에 |가 있는 것만으로는 표로 보지 않는다. 'C:\a|b' 같은 평범한 글에서
// Enter가 엉뚱하게 동작하는 쪽이, 표를 한 번 못 알아보는 쪽보다 훨씬 성가시다.
const TABLE_ROW = /^\s*\|/;

// 이스케이프한 \| 는 칸 경계가 아니라 글자 그대로의 막대다.
const CELL_SPLIT = /(?<!\\)\|/;

// 구분선의 한 칸. --- 앞뒤로 정렬 기호 :가 붙을 수 있다.
const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

// 줄의 남은 꼬리가 테두리와 공백뿐인가.
const ROW_TAIL = /^[\s|]*$/;

const BACKSLASH = '\\';

// 빈 칸 '|  |'의 가운데. 새 행을 놓은 뒤 커서를 여기에 둔다.
export const BLANK_CELL_CURSOR = 2;

export function isTableRow(line) {
  return TABLE_ROW.test(line);
}

// 줄을 칸 단위로 쪼갠다. 바깥쪽 파이프는 테두리이지 칸이 아니므로 떼어낸다.
export function splitCells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith(BACKSLASH + '|')) text = text.slice(0, -1);
  // 테두리를 걷어내면 아무것도 남지 않는 줄이 있다. 파이프 한 글자가 그렇다.
  // 이런 줄은 칸이 없는 것으로 봐야 '빈 칸 하나를 가진 행'과 섞이지 않는다.
  if (text === '') return [];
  return text.split(CELL_SPLIT);
}

export function countColumns(line) {
  return splitCells(line).length;
}

export function isDelimiterRow(line) {
  if (!isTableRow(line)) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

// 테두리만 있고 내용은 없는 행. Enter로 표를 빠져나갈 때가 왔다는 신호다.
export function isBlankTableRow(line) {
  if (!isTableRow(line) || isDelimiterRow(line)) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => cell.trim() === '');
}

// 커서 뒤에 남은 글자가 줄의 꼬리일 뿐인가.
// 표의 줄은 늘 닫는 |로 끝나고 커서는 그 앞에 서므로, 테두리와 공백만 남았다면
// 줄 끝에 있는 것으로 본다. |까지 글자로 치면 마지막 칸에서 친 Enter가 전부
// 줄 가운데로 오해받아, 표를 이어 쓰는 길이 통째로 막힌다.
export function isRowTail(text) {
  return ROW_TAIL.test(text);
}

export function makeDelimiterRow(columns) {
  return '| ' + Array(columns).fill(':---').join(' | ') + ' |';
}

export function makeBlankRow(columns) {
  return '|' + '  |'.repeat(columns);
}

// 줄 안에서 각 칸이 차지하는 구간. Tab으로 칸을 옮겨 다닐 때 쓴다.
// 오프셋은 줄 첫 글자를 0으로 센다.
export function cellRanges(line) {
  const pipes = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '|' && line[i - 1] !== BACKSLASH) pipes.push(i);
  }
  if (pipes.length === 0) return [];

  const ranges = [];
  for (let i = 0; i < pipes.length - 1; i += 1) {
    ranges.push({ from: pipes[i] + 1, to: pipes[i + 1] });
  }

  // 끝 파이프를 생략하고 쓴 표(| a | b)도 있다. 마지막 파이프 뒤에 글자가 남아 있으면
  // 그것도 한 칸으로 친다.
  const last = pipes[pipes.length - 1];
  if (line.slice(last + 1).trim() !== '') ranges.push({ from: last + 1, to: line.length });

  return ranges;
}
