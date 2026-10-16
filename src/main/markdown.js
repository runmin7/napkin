// 메모를 읽기용 HTML로 옮긴다. 편집 창의 읽기 쪽(#reader)이 보여 주는 것이 이 결과다.
// 결과는 어디에도 저장하지 않는다. 보여 줄 때마다 여기서 다시 만들고 쓰고 버린다.
//
// 편집 화면은 마크다운 기호를 글자 그대로 둔다. 표가 격자로 보이거나 제목이 실제 크기로
// 보이려면 렌더링한 결과를 따로 만들어야 하고, 그 일을 이 파일이 한다.

const { marked } = require('marked');

marked.setOptions({
  gfm: true,
  // 메모는 줄을 바꾼 대로 보이는 편이 자연스럽다. 마크다운 표준은 빈 줄이 있어야 문단을 나누지만
  // 메모장에서 그 규칙을 그대로 적용하면 쓴 대로 보이지 않는다.
  breaks: true,
});

// 마크다운에는 문단 바로 아래 ---를 그으면 그 문단이 통째로 제목이 되는 문법(Setext)이 있다.
// 메모에서는 ---를 구분선으로 긋는 일이 훨씬 잦은데, 그때마다 위에 쓴 글이 전부 제목으로 튄다.
// 편집 화면도 같은 이유로 이 문법을 빼 두었다(editor-engine.js의 remove: SetextHeading).
// 두 화면이 같은 글을 다르게 읽으면 안 되므로 여기서도 막는다.
//
// 구분선 앞에 빈 줄을 하나 끼워 윗 문단과 떼어 놓으면, ---는 제목 표시가 아니라 구분선으로 남는다.
// 원본 메모는 그대로이고 보여 줄 때만 이렇게 읽는다.
function detachRuleLines(text) {
  const lines = text.split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    // 코드 블록 안의 ---는 글이 아니라 내용이다. 한 글자도 건드리지 않는다.
    if (/^ {0,3}(```|~~~)/.test(line)) inFence = !inFence;

    // 네 칸 이상 들여쓴 줄은 그 자체가 코드라서 제목 문법이 되지 않는다. 그래서 세 칸까지만 본다.
    const isRule = !inFence && /^ {0,3}(-{3,}|={3,})\s*$/.test(line);
    const stuckToParagraph = out.length > 0 && out[out.length - 1].trim() !== '';
    if (isRule && stuckToParagraph) out.push('');

    out.push(line);
  }
  return out.join('\n');
}

marked.use({ hooks: { preprocess: detachRuleLines } });

function renderMarkdown(content) {
  return marked.parse(content);
}

module.exports = { renderMarkdown };
