// 마크다운 목록 문법만 다루는 순수 함수 모음.
//
// md-table.js와 짝이 되는 파일이다. CodeMirror를 모르고, 줄 하나(문자열)를 받아
// 목록의 어떤 줄인지 가려내는 일만 한다. 편집기에 붙이는 일은 editor-engine이 한다.
//
// 줄을 문법 트리가 아니라 글자로 판정하는 것도 md-table과 같은 이유다. 도와야 할
// 순간은 목록을 쓰고 있는 도중이고, 그때의 문서는 아직 문법이 다 맞지 않는다.

// 번호 항목. '2. 내용'과 '2) 내용'을 모두 받는다. 마커 뒤 공백을 요구하지 않는 것은
// 이어쓰기가 막 만들어 놓은 '2. '(내용 없음)에서도 Tab이 들어야 하기 때문이다.
const ORDERED_ITEM = /^( *)(\d+)([.)])( +|$)/;

// 불릿 항목. Tab이 만드는 것은 -뿐이지만, 손으로 * 나 +를 쓴 줄도 되돌릴 수 있어야 한다.
const BULLET_ITEM = /^( *)([-*+])( +|$)/;

const LEADING_SPACE = /^ */;

// 번호를 되살릴 때 참고할 앞 항목이 없으면 이 기호를 쓴다.
export const DEFAULT_DELIMITER = '.';

// 줄 앞 공백의 칸 수. 같은 깊이의 항목인지 가리는 데 쓴다.
export function indentWidth(line) {
  return LEADING_SPACE.exec(line)[0].length;
}

export function isBlankLine(line) {
  return line.trim() === '';
}

// 번호 항목이면 그 생김새를 돌려준다. 아니면 null.
// 오프셋은 줄 첫 글자를 0으로 센다.
export function orderedItem(line) {
  const match = ORDERED_ITEM.exec(line);
  if (!match) return null;

  const [all, lead, digits, delimiter] = match;
  return {
    indent: lead.length,
    number: Number(digits),
    delimiter,
    // 숫자가 차지하는 구간의 끝. 번호만 다시 매길 때 [indent, numberTo)를 갈아끼운다.
    numberTo: lead.length + digits.length,
    // 마커와 뒤따르는 공백을 지난 자리. 내용이 시작하는 곳이다.
    contentFrom: all.length,
  };
}

// 불릿 항목이면 그 생김새를 돌려준다. 아니면 null.
export function bulletItem(line) {
  const match = BULLET_ITEM.exec(line);
  if (!match) return null;

  return {
    indent: match[1].length,
    // 깊이를 옮길 때 이 글자를 그대로 쓴다. 마커가 달라지면 마크다운에서 별개 목록이 된다.
    marker: match[2],
    contentFrom: match[0].length,
  };
}
