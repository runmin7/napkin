// 편집기 엔진 어댑터.
//
// CodeMirror를 아는 파일은 여기 하나뿐이다. 나머지 화면 코드는 아래 createEditor가
// 돌려주는 몇 개의 함수만 쓴다. 그래야 나중에 라이브러리를 갈아타거나 textarea로
// 되돌릴 때 이 파일만 다시 쓰면 된다.
//
// 이 파일은 그대로 로드되지 않는다. esbuild가 renderer/vendor/editor-bundle.js로
// 묶어 주고, editor.html은 그 번들을 불러 쓴다. (npm run bundle)

import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab, deleteLine } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';
import {
  BLANK_CELL_CURSOR,
  cellRanges,
  countColumns,
  isBlankTableRow,
  isDelimiterRow,
  isRowTail,
  isTableRow,
  makeBlankRow,
  makeDelimiterRow,
} from './md-table.js';
import { DEFAULT_DELIMITER, bulletItem, indentWidth, isBlankLine, orderedItem } from './md-list.js';

// 마크다운 문법을 화면에서 어떻게 보이게 할지.
// 글자 자체는 건드리지 않는다. `**굵게**`는 파일에도 그대로 `**굵게**`로 남는다.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },

  { tag: tags.heading1, fontSize: '1.45em', fontWeight: '700', lineHeight: '1.5' },
  { tag: tags.heading2, fontSize: '1.25em', fontWeight: '700', lineHeight: '1.5' },
  { tag: tags.heading3, fontSize: '1.1em', fontWeight: '700' },
  { tag: tags.heading4, fontWeight: '700' },
  { tag: tags.heading5, fontWeight: '700' },
  { tag: tags.heading6, fontWeight: '700' },

  // 표의 머리 행. TableHeader가 붙이는 태그가 heading이라 여기에 걸린다.
  // heading1~6이 더 구체적인 규칙이므로 본문 제목은 위 규칙들이 그대로 이긴다.
  { tag: tags.heading, fontWeight: '700' },
  // 체크목록의 [ ]와 [x]. 글자는 그대로 두고 표시만 눈에 띄게 한다.
  { tag: tags.atom, color: 'var(--accent)', fontWeight: '600' },

  { tag: tags.monospace, fontFamily: "'D2Coding', Consolas, monospace", color: 'var(--accent)' },
  { tag: tags.quote, color: 'var(--ink-soft)', fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.list, color: 'var(--accent)' },
  { tag: tags.contentSeparator, color: 'var(--line-strong)' },

  // ** * # > ` | ~~ 같은 기호 자체. 지우려면 보여야 하므로 숨기지 않는다.
  // 굵기를 400으로 되돌리는 것은 **굵게** 안의 **까지 두꺼워지는 것을 막기 위해서다.
  // 기호는 바깥 strong의 700을 물려받으므로, 눌러 두지 않으면 본문과 같이 굵어진다.
  { tag: tags.processingInstruction, color: 'var(--syntax)', fontWeight: '400' },
]);

// Ctrl+B. 고른 글자 좌우에 **를 붙인다. 이미 붙어 있으면 떼어낸다.
// 화면에 굵게 보이는 것은 위 하이라이트가 그렇게 그려 줄 뿐이고, 파일에는 **가 그대로 남는다.
const BOLD = '**';

function toggleBold(view) {
  const { state } = view;

  view.dispatch(
    state.changeByRange((range) => {
      const { from, to } = range;

      // 고른 글자가 없으면 빈 **를 놓고 그 사이에 커서를 둔다. 이어서 바로 칠 수 있다.
      if (from === to) {
        return {
          changes: { from, insert: BOLD + BOLD },
          range: EditorSelection.cursor(from + BOLD.length),
        };
      }

      // **까지 함께 골랐을 때(**굵게**)
      const picked = state.sliceDoc(from, to);
      if (picked.length >= BOLD.length * 2 && picked.startsWith(BOLD) && picked.endsWith(BOLD)) {
        return {
          changes: { from, to, insert: picked.slice(BOLD.length, -BOLD.length) },
          range: EditorSelection.range(from, to - BOLD.length * 2),
        };
      }

      // 글자만 골랐지만 바깥이 **로 감싸져 있을 때(**굵게** 중 '굵게')
      const left = state.sliceDoc(Math.max(0, from - BOLD.length), from);
      const right = state.sliceDoc(to, Math.min(state.doc.length, to + BOLD.length));
      if (left === BOLD && right === BOLD) {
        return {
          changes: [
            { from: from - BOLD.length, to: from },
            { from: to, to: to + BOLD.length },
          ],
          range: EditorSelection.range(from - BOLD.length, to - BOLD.length),
        };
      }

      return {
        changes: [
          { from, insert: BOLD },
          { from: to, insert: BOLD },
        ],
        range: EditorSelection.range(from + BOLD.length, to + BOLD.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' }
  );
  return true;
}

// 표 안에서의 Enter와 Tab.
//
// 마크다운 표는 파이프와 구분선을 손으로 맞춰야 해서, 한 줄 쓸 때마다 문법을 먼저
// 떠올려야 한다. 머리 행 하나만 써 두면 나머지 뼈대는 여기서 만들어 준다.
// 표인지 아닌지를 가리는 글자 판정은 md-table.js에 있다.

// 커서가 놓인 줄이 표의 줄이면 그 줄을 돌려준다. 아니면 null.
function tableLineAt(state) {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  // 여러 줄에 걸친 선택은 표가 거들 일이 아니다. 원래의 들여쓰기·줄바꿈에 넘긴다.
  // 한 줄 안의 선택은 그대로 받는다. Tab으로 칸을 옮겨 오면 글자가 골라진 채이므로,
  // 여기서 선택을 물리치면 이어지는 Tab과 Enter가 곧바로 표를 깨뜨린다.
  if (state.doc.lineAt(range.anchor).number !== line.number) return null;
  // 칸이 하나도 없는 줄(파이프 한 글자)은 아직 표라고 하기 어렵다. 표로 보면
  // 빈 행으로 오해해 Enter가 그 글자를 지워 버린다.
  return isTableRow(line.text) && countColumns(line.text) > 0 ? line : null;
}

function lineAt(state, number) {
  if (number < 1 || number > state.doc.lines) return null;
  return state.doc.line(number);
}

// 칸 안의 글자를 고른다. 빈 칸이면 그 가운데에 커서만 둔다.
// 이미 쓴 칸으로 옮겨 갔을 때 글자가 골라져 있어야 그대로 덮어쓸 수 있다.
function selectCell(view, line, cell) {
  const text = line.text.slice(cell.from, cell.to);
  const content = text.trim();
  const base = line.from + cell.from;
  const lead = text.length - text.trimStart().length;

  view.dispatch({
    selection:
      content === ''
        ? EditorSelection.cursor(base + Math.min(1, text.length))
        : EditorSelection.range(base + lead, base + lead + content.length),
    scrollIntoView: true,
  });
  return true;
}

// 줄 뒤에 새 행을 놓고 그 첫 칸으로 커서를 옮긴다.
// 머리 행 뒤라면 구분선까지 함께 놓는다. 그래야 머리 행만 쓰고 Enter 한 번으로
// 바로 내용을 칠 수 있다. 칸 수는 기준이 되는 줄에서 세므로 수가 어긋날 일이 없다.
function appendRowAfter(view, line) {
  const { state } = view;
  const columns = countColumns(line.text);
  const prev = lineAt(state, line.number - 1);
  const next = lineAt(state, line.number + 1);

  // 머리 행인지는 이웃으로 가린다. 위가 표가 아니어서 이 줄이 표의 첫 줄이고,
  // 아래에 아직 구분선이 없을 때만 머리 행이다.
  const isHeader =
    !isDelimiterRow(line.text) &&
    !isTableRow(prev ? prev.text : '') &&
    !isDelimiterRow(next ? next.text : '');

  const blank = makeBlankRow(columns);
  const added = isHeader ? [makeDelimiterRow(columns), blank] : [blank];
  const insert = '\n' + added.join('\n');

  view.dispatch({
    changes: { from: line.to, insert },
    // 커서는 마지막에 놓인 빈 행의 첫 칸 안으로.
    selection: { anchor: line.to + insert.length - blank.length + BLANK_CELL_CURSOR },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

// Enter와 Ctrl+Enter. 표의 줄 끝에서만 나선다.
function tableNewRow(view) {
  // 한글을 조합하는 중의 Enter는 글자를 확정하는 키다. 여기서 가로채면 '문서번호'를
  // 치다 말고 표가 생긴다.
  if (view.composing) return false;

  const { state } = view;
  const line = tableLineAt(state);
  if (!line) return false;
  // 줄 끝에서만 나선다. 고른 글자가 있을 수 있으므로 커서 자리가 아니라
  // 고른 구간의 끝에서 잰다. 무엇이 줄 끝인지는 md-table의 isRowTail이 안다.
  const rowEnd = Math.max(state.selection.main.anchor, state.selection.main.head);
  if (!isRowTail(state.doc.sliceString(rowEnd, line.to))) return false;

  // 테두리만 남은 행에서 또 쳤다면 표를 다 쓴 것이다. 그 행을 지우고 표 밖으로 나간다.
  // 목록에서 Enter를 한 번 더 쳐 빠져나오는 것과 같은 몸짓이다.
  if (isBlankTableRow(line.text)) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  }

  return appendRowAfter(view, line);
}

// 옮겨 갈 이웃 행. 구분선은 고칠 일이 없으니 건너뛰고, 표가 끝나면 null.
function contentRowNear(state, line, step) {
  for (let n = line.number + step; n >= 1 && n <= state.doc.lines; n += step) {
    const candidate = state.doc.line(n);
    if (!isTableRow(candidate.text)) return null;
    if (!isDelimiterRow(candidate.text)) return candidate;
  }
  return null;
}

// 이웃한 내용 행으로 건너간다. Tab이면 그 행의 첫 칸, Shift+Tab이면 마지막 칸으로.
// 갈 곳이 없을 때 Tab은 이어서 쓸 행을 만들고, Shift+Tab은 아무것도 하지 않되
// 들여쓰기가 끼어들어 표가 깨지지 않도록 여기서 멈춘다.
function moveToNeighborRow(view, line, step) {
  const neighbor = contentRowNear(view.state, line, step);
  if (!neighbor) return step > 0 ? appendRowAfter(view, line) : true;

  const cells = cellRanges(neighbor.text);
  if (cells.length === 0) return false;
  return selectCell(view, neighbor, step > 0 ? cells[0] : cells[cells.length - 1]);
}

// Tab과 Shift+Tab. 표 밖이라면 false를 돌려줘 원래의 들여쓰기로 넘긴다.
function moveCell(view, step) {
  const { state } = view;
  const range = state.selection.main;
  const line = tableLineAt(state);
  if (!line) return false;

  // 구분선 위에 커서가 있다면 그 줄에는 고칠 칸이 없다. :--- 를 골라 놓고
  // 덮어쓰게 두는 대신 곧장 이웃 내용 행으로 건넌다.
  if (isDelimiterRow(line.text)) return moveToNeighborRow(view, line, step);

  const cells = cellRanges(line.text);
  if (cells.length === 0) return false;

  const offset = range.head - line.from;
  let index = cells.findIndex((cell) => offset >= cell.from && offset <= cell.to);
  // 파이프 바깥에 커서가 있는 경우. 줄 앞쪽이면 첫 칸 직전에, 뒤쪽이면 마지막 칸
  // 직후에 서 있는 것으로 친다.
  if (index === -1) index = offset < cells[0].from ? -1 : cells.length;

  const target = index + step;
  if (target >= 0 && target < cells.length) return selectCell(view, line, cells[target]);

  return moveToNeighborRow(view, line, step);
}

const tableNextCell = (view) => moveCell(view, 1);
const tablePrevCell = (view) => moveCell(view, -1);

// 목록에서의 Tab과 Shift+Tab.
//
// '1.' 다음 Enter를 치면 다음 줄이 '2.'로 시작한다(마크다운 확장이 해 주는 일이다).
// 거기서 Tab을 누르면 번호를 떼고 하위 불릿으로 내리고, Shift+Tab이면 한 단계 올린다.
// 올라간 자리가 번호 목록이면 번호를 되살리고 불릿 목록이면 불릿인 채로 둔다.
// 계층을 바꾸자고 마커를 손으로 지웠다 다시 쓸 일이 없어진다.
// 목록 줄이 아니면 false를 돌려줘 원래의 들여쓰기(indentWithTab)로 넘긴다.

// 들여쓰기 한 단계. 아래 indentUnit도 같은 값을 쓴다. 폭이 어긋나면 Tab과 Shift+Tab이
// 서로의 결과를 제자리로 되돌리지 못한다.
const INDENT = '    ';
const BULLET = '- ';

// 커서가 놓인 줄. 여러 줄에 걸친 선택은 목록이 거들 일이 아니므로 null.
function listLineAt(state) {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  if (state.doc.lineAt(range.anchor).number !== line.number) return null;
  return line;
}

// 줄의 머리(들여쓰기 + 마커 + 뒤 공백)를 통째로 갈아끼운다. 뒤 항목의 번호 고침까지
// 한 번에 넣어야 Ctrl+Z 한 번으로 통째로 되돌아간다.
// 커서는 글자 기준 제자리에 둔다. 머리 안에 서 있었다면 내용 첫 글자로 옮긴다.
function replaceLineHead(view, line, contentFrom, head, following) {
  const offset = view.state.selection.main.head - line.from;
  const shift = head.length - contentFrom;

  view.dispatch({
    changes: [{ from: line.from, to: line.from + contentFrom, insert: head }, ...following],
    selection: { anchor: line.from + Math.max(offset, contentFrom) + shift },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

// 같은 깊이의 뒤 항목 번호를 다시 매긴다. firstNumber부터 하나씩 이어지는 동안만
// delta를 더하고, 어긋나면 그 자리에서 멈춘다.
//
// 멈추는 규칙은 마크다운 확장이 Enter에서 쓰는 것과 같다(renumberList). 번호를 전부
// '1.'로만 적어 두는 사람이 많은데, 그런 목록까지 앱이 고쳐 놓으면 쓴 사람의 뜻을
// 거스르는 꼴이 된다. 이미 번호가 제대로 이어진 목록만 따라간다.
function renumberChanges(state, line, indent, firstNumber, delta) {
  const changes = [];
  let expect = firstNumber;

  for (let n = line.number + 1; n <= state.doc.lines; n += 1) {
    const next = state.doc.line(n);
    // 빈 줄에서 멈춘다. 한 목록이 이어지는 것인지 다른 목록이 시작한 것인지 글자만으로는
    // 가릴 수 없어, 애매하면 건드리지 않는 쪽을 고른다.
    if (isBlankLine(next.text)) break;

    const lead = indentWidth(next.text);
    if (lead > indent) continue; // 하위 항목이나 이어 쓴 본문. 이 깊이의 번호가 아니다.
    if (lead < indent) break; // 상위로 빠져나왔다.

    const item = orderedItem(next.text);
    if (!item || item.number !== expect) break;

    changes.push({
      from: next.from + item.indent,
      to: next.from + item.numberTo,
      insert: String(expect + delta),
    });
    expect += 1;
  }

  return changes;
}

// 내어쓴 깊이에서 이 줄과 나란히 설 형제를 한쪽 방향으로 찾는다. step이 -1이면 위, 1이면 아래.
// 거기에 맞춰 마커를 고르므로 번호인지 불릿인지까지 가려서 돌려준다.
// 맞출 상대가 없으면(빈 줄, 상위 깊이, 이어 쓴 본문) null.
function siblingToward(state, line, indent, step) {
  for (let n = line.number + step; n >= 1 && n <= state.doc.lines; n += step) {
    const near = state.doc.line(n);
    if (isBlankLine(near.text)) return null;

    const lead = indentWidth(near.text);
    if (lead > indent) continue;
    if (lead < indent) return null;

    // 같은 깊이의 줄을 만났다. 목록 항목이 아니라면 이어받을 것이 없다.
    const ordered = orderedItem(near.text);
    if (ordered) return { kind: 'ordered', number: ordered.number, delimiter: ordered.delimiter };

    const bullet = bulletItem(near.text);
    return bullet ? { kind: 'bullet', marker: bullet.marker } : null;
  }
  return null;
}

// Tab. '2. 내용'을 '    - 내용'으로 내린다. 번호가 하나 빠졌으니 뒤 항목을 당긴다.
function indentAsBullet(view) {
  const { state } = view;
  const line = listLineAt(state);
  if (!line) return false;

  const item = orderedItem(line.text);
  if (!item) return false;

  const head = ' '.repeat(item.indent + INDENT.length) + BULLET;
  const following = renumberChanges(state, line, item.indent, item.number + 1, -1);
  return replaceLineHead(view, line, item.contentFrom, head, following);
}

// Shift+Tab. 불릿을 한 단계 올린다. 올라간 자리에서 무엇이 되는지는 그 자리의 형제가 정한다.
// 형제가 번호면 그 번호열에 끼어들고, 불릿이면 불릿인 채로 깊이만 줄인다. 한 목록 안에
// 불릿과 번호가 섞이지 않게 하려는 것이다.
//
// 위만 보지 않고 아래까지 보는 이유가 있다. 중첩된 번호 목록의 첫 항목을 Tab으로 내렸다가
// 되돌리는 길에는 위에 형제가 없고 아래에만 있다. 위만 보면 그 왕복이 제자리로 오지 않는다.
//
// 위아래 어디에도 형제가 없으면 줄 모양만으로는 가릴 수 없다. 그때는 0칸으로 올라갈 때만
// 번호로 되돌린다. 들여쓴 자리에 혼자 남는 항목까지 번호로 바꾸면, 거기까지 Tab으로
// 내려왔을 뿐인 불릿이 번호가 되어 버린다.
//
// 들여쓰기가 없는 불릿은 올라갈 자리가 없다. 평범한 '- 목록'이 Shift+Tab 한 번에
// 번호 목록으로 바뀌어 버리지 않도록 여기서 넘긴다.
function outdentListItem(view) {
  const { state } = view;
  const line = listLineAt(state);
  if (!line) return false;

  const item = bulletItem(line.text);
  if (!item || item.indent === 0) return false;

  const indent = Math.max(0, item.indent - INDENT.length);
  const above = siblingToward(state, line, indent, -1);
  const below = above ? null : siblingToward(state, line, indent, 1);
  const sibling = above || below;

  // 형제가 있으면 그 생김새를 따르고, 없으면 아직 하위 깊이인지로 가른다.
  const keepBullet = sibling ? sibling.kind === 'bullet' : indent > 0;
  if (keepBullet) {
    // 합류하는 목록의 마커를 따른다. 같은 깊이에서 마커가 갈리면 마크다운이 별개 목록으로 읽는다.
    // 형제가 없으면 이 줄이 쓰던 글자를 그대로 둔다(손으로 쓴 * 나 +).
    // 번호가 끼어들지 않으니 뒤 항목을 다시 매길 일도 없다.
    const marker = sibling ? sibling.marker : item.marker;
    return replaceLineHead(view, line, item.contentFrom, ' '.repeat(indent) + marker + ' ', []);
  }

  // 위 형제 다음에 끼어들면 그 번호 뒤를 잇고, 아래 형제 앞에 끼어들면 그 번호를 가져온다.
  // 어느 쪽이든 번호가 하나 끼어들었으니 뒤 항목을 민다.
  const number = above ? above.number + 1 : below ? below.number : 1;
  const delimiter = sibling ? sibling.delimiter : DEFAULT_DELIMITER;

  const head = ' '.repeat(indent) + number + delimiter + ' ';
  const following = renumberChanges(state, line, indent, number, 1);
  return replaceLineHead(view, line, item.contentFrom, head, following);
}

// 앱 색과 글꼴을 따르게 한다. CSS 변수를 그대로 쓰므로 다크 모드도 함께 따라온다.
const appTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
    color: 'var(--ink)',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: "'Malgun Gothic', 'Segoe UI', system-ui, sans-serif",
    lineHeight: '1.75',
    padding: '16px 18px',
    caretColor: 'var(--ink)',
  },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--select)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-placeholder': { color: 'var(--ink-faint)' },

  // 찾기 패널(Ctrl+F). CodeMirror 기본 모습은 이 앱과 겉돌기 때문에 상태바와 같은 결로 맞춘다.
  '.cm-panels': { backgroundColor: 'var(--paper)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-search': {
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: "'Malgun Gothic', 'Segoe UI', system-ui, sans-serif",
  },
  '.cm-search label': { color: 'var(--ink-soft)' },
  '.cm-search input': {
    fontFamily: 'inherit',
    fontSize: '12px',
    padding: '2px 6px',
    border: '1px solid var(--line)',
    borderRadius: '3px',
    backgroundColor: 'var(--paper)',
    color: 'var(--ink)',
  },
  '.cm-search input:focus': { outline: '1px solid var(--accent)' },
  // 기본 버튼은 그라데이션 배경을 깔고 온다. 종이 같은 화면에 어울리지 않아 걷어낸다.
  '.cm-search button, .cm-button': {
    fontFamily: 'inherit',
    fontSize: '11.5px',
    padding: '2px 8px',
    border: '1px solid var(--line)',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    color: 'var(--ink-soft)',
    cursor: 'pointer',
  },
  '.cm-search button:hover, .cm-button:hover': { backgroundColor: 'var(--hover)', color: 'var(--accent)' },
  // 찾은 낱말은 한눈에 들어와야 한다. 글자색까지 고정하는 이유는 어두운 화면에서
  // 밝은 글자가 주황 바탕에 묻히기 때문이다.
  '.cm-searchMatch': { backgroundColor: 'var(--match)', color: 'var(--match-ink)' },
  // 지금 보고 있는 한 곳은 테두리로 한 번 더 구분한다.
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--match)',
    color: 'var(--match-ink)',
    outline: '1px solid var(--match-ink)',
  },
});

export function createEditor(parent, options = {}) {
  const { onChange, placeholder: placeholderText = '' } = options;

  // 메모를 열 때마다 state를 새로 만들어 끼우므로(setText 참고) 확장 목록은 따로 둔다.
  // 확장은 값일 뿐이라 state가 바뀌어도 그대로 다시 쓸 수 있고, 한 번만 만들어 두면
  // 메모를 넘길 때마다 마크다운 파서와 테마를 다시 지을 일이 없다.
  const extensions = [
    history(),
    drawSelection(),
    // Ctrl+D로 같은 낱말을 여러 개 고르려면 이것이 있어야 한다. CodeMirror는 기본적으로
    // 선택을 하나로 접기 때문에, 켜 두지 않으면 두 번째 Ctrl+D부터 아무 일도 일어나지 않는다.
    EditorState.allowMultipleSelections.of(true),
    highlightActiveLine(),
    // Tab을 편집기가 가져간다. 묶어 두지 않으면 CodeMirror 기본대로 포커스가 밖으로 빠져나간다.
    indentUnit.of(INDENT),
    // 표와 목록에서는 Tab과 Enter를 여기서 먼저 잡는다. 둘 다 아니면 false를 돌려주므로
    // 뒤따르는 기본 동작(indentWithTab의 들여쓰기, defaultKeymap의 줄바꿈)이 그대로 산다.
    // 표를 목록보다 앞에 두는 이유는 표 안의 Tab이 칸 이동이어야 하기 때문이다.
    // Ctrl+D는 커서가 있는 줄을 통째로 지운다. 여러 줄을 골라 두었다면 그 줄들이 함께 지워진다.
    // searchKeymap에도 Mod-d(같은 낱말 고르기)가 있지만, 이 keymap이 앞에 놓여 있어 여기가 먼저 잡는다.
    keymap.of([
      { key: 'Tab', run: tableNextCell },
      { key: 'Shift-Tab', run: tablePrevCell },
      { key: 'Tab', run: indentAsBullet },
      { key: 'Shift-Tab', run: outdentListItem },
      { key: 'Enter', run: tableNewRow },
      { key: 'Mod-Enter', run: tableNewRow },
      indentWithTab,
      { key: 'Mod-b', run: toggleBold },
      { key: 'Mod-d', run: deleteLine },
    ]),
    // 메모 안에서 찾기(Ctrl+F). 목록 패널의 검색은 "메모 찾기"이고 이쪽은 "메모 안에서 찾기"다.
    // 긴 메모에서는 이것이 없으면 눈으로 훑는 수밖에 없다.
    search({ top: true }),
    // Escape는 여기서 먼저 잡아야 찾기 패널이 닫힌다. defaultKeymap보다 앞에 둔 이유다.
    keymap.of(searchKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // SetextHeading을 뺀다. 이 문법은 앞 줄에 텍스트가 있고 다음 줄이 --- 이면
    // 앞 줄을 제목으로 만든다. 구분선으로 ---를 긋는 일이 훨씬 잦은데
    // 그때마다 윗줄이 제목으로 튀어 버려서 메모에는 방해만 된다.
    // base를 markdownLanguage로 두면 GFM(표·취소선·체크목록·자동링크)까지 해석한다.
    // 기본값인 commonmark에는 이것들이 없어서, 표를 써도 파이프가 섞인 문단으로만 읽혔다.
    markdown({ base: markdownLanguage, extensions: [{ remove: ['SetextHeading'] }] }),
    syntaxHighlighting(markdownHighlight),
    EditorView.lineWrapping,
    // 맞춤법 검사를 끈다. Electron은 기본으로 켜 두는데(webPreferences.spellcheck 기본 true),
    // 메모에 빨간 물결선이 깔리기만 하고 한글에는 도움이 되지 않는다.
    EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    appTheme,
    cmPlaceholder(placeholderText),
    // setText는 state를 통째로 갈아 끼우는데, 그 길에서는 이 listener가 불리지 않는다.
    // 메모를 여는 것만으로 "고쳤다"고 판단해 저장이 도는 일이 없는 이유다.
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (onChange) onChange(view.state.doc.toString());
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });

  return {
    getText: () => view.state.doc.toString(),

    // 메모를 열 때 쓴다. 커서와 스크롤을 맨 위로 되돌린다.
    //
    // 내용만 갈아 끼우지 않고 state를 통째로 새로 만드는 이유는 되돌리기 기록에 있다.
    // 바꿔 끼우는 것을 dispatch로 보내면 그 교체가 되돌리기에 쌓인다. 그러면 메모를 연 직후
    // Ctrl+Z가 방금 연 메모를 직전 메모 내용으로 되돌려 놓고, 뒤이어 자동저장이 돌아
    // 이 메모 파일에 저 메모 내용이 쓰인다. 교체를 기록하지 않게만 해도(addToHistory) 모자란다.
    // 이전 메모에서 지운 글자가 새 문서 좌표로 옮겨 붙은 채 남아, Ctrl+Z 때 끼어들기 때문이다.
    // 되돌리기는 메모 하나 안에서만 뜻이 있으므로 기록째로 버린다. state가 바뀌면 그 안에 있던
    // 되돌리기 기록도 함께 사라진다.
    setText(text) {
      view.setState(EditorState.create({ doc: text, extensions }));
      view.scrollDOM.scrollTop = 0;
    },

    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    contains: (node) => view.dom.contains(node),
  };
}
