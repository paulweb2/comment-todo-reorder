# Comment TODO Reorder

Drag-and-drop **or** <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> to re-order the
comment lines that follow any `TODO` anchor.

![demo gif](docs/demo.gif) <!-- optional -->

---

### Features &nbsp;🚀
| Action | How |
|--------|-----|
| **Re-order by mouse** | Drag a child line in the **TODO Blocks** side-panel. |
| **Re-order by keyboard** | Place the caret on the line and press <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>. |
| **Jump to block** | Click the block heading in the side-panel. |

### Supported comment styles
* `// TODO …` &nbsp; | &nbsp; `/* TODO … */` &nbsp; | &nbsp; `* TODO …`
* `# TODO …` (Python, Ruby)  
* more can be added via **package.json → COMMENT_SYNTAX**.

### Installation
```bash
git clone https://github.com/<you>/comment-todo-reorder
cd comment-todo-reorder
npm install
npx vsce package           # creates .vsix
code --install-extension comment-todo-reorder-0.1.0.vsix