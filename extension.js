const vscode = require('vscode');

/* ───────────────────────── language‑comment map ───────────────────────── */
const COMMENT_SYNTAX = {
  javascript: { line: '//', blockStart: '/*', blockEnd: '*/' },
  typescript: { line: '//', blockStart: '/*', blockEnd: '*/' },
  java:       { line: '//', blockStart: '/*', blockEnd: '*/' },
  csharp:     { line: '//', blockStart: '/*', blockEnd: '*/' },
  python:     { line: '#',  blockStart: null, blockEnd: null },
  ruby:       { line: '#',  blockStart: '=begin', blockEnd: '=end' }
};
function getSyntax(lang) {
  return COMMENT_SYNTAX[lang] || COMMENT_SYNTAX.javascript;
}
function esc(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const stripCmt = /^\s*(?:\/\/|#|\*|\/\*)\s*/; // for sidebar labels

/* ───────────────────────── parse current doc ─────────────────────
   Block rules
   ───────────
   • A block starts at any comment line whose text begins with TODO.
   • Children = every subsequent comment line UNTIL the first blank
     line, code line, or another TODO anchor.
   • For a /* TODO anchor:
       – Collect inner lines that start with * (typical JSDoc style).
       – Skip the terminating *\/.
       – Continue gathering later comment lines after the terminator
         under the same stop conditions.
------------------------------------------------------------------ */
function parseBlocks(doc) {
  const { line, blockStart, blockEnd } = getSyntax(doc.languageId);

  // build regexes dynamically for the current language
  const anchorParts = [];
  if (line)       anchorParts.push(esc(line));
  if (blockStart) anchorParts.push(esc(blockStart));
  anchorParts.push('\\*');
  const anchorRE = new RegExp(`^\\s*(?:${anchorParts.join('|')})\\s*TODO\\b`, 'i');

  const commentParts = [];
  if (line)       commentParts.push(esc(line));
  if (blockStart) commentParts.push(esc(blockStart));
  commentParts.push('\\*');
  const commentRE = new RegExp(`^\\s*(?:${commentParts.join('|')})`);

  const blankRE = /^\s*$/;
  const starRE  = /^\s*\*/;

  const blocks = [];

  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    if (!anchorRE.test(text)) continue;

    const isBlock = blockStart && text.trim().startsWith(blockStart);
    const blk = { anchor: i, items: [] };
    let j = i + 1;

    // gather lines inside the block comment before terminator
    if (isBlock && blockEnd) {
      while (j < doc.lineCount) {
        const t = doc.lineAt(j).text;
        if (t.includes(blockEnd)) { j++; break; }   // skip terminator
        if (starRE.test(t)) blk.items.push({ line: j, text: t });
        j++;
      }
    }

    // gather subsequent comment lines
    while (j < doc.lineCount) {
      const t = doc.lineAt(j).text;
      if (blankRE.test(t)) break;
      if (!commentRE.test(t)) break;
      if (anchorRE.test(t)) break;
      blk.items.push({ line: j, text: t });
      j++;
    }

    blocks.push(blk);
    i = j - 1; // continue outer loop after processed lines
  }

  return blocks;
}

/* ───────────────────────── Tree provider ───────────────────────── */
class TodoProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() { this._emitter.fire(); }

  getTreeItem(node) {
    const item = new vscode.TreeItem(node.label);
    item.contextValue = node.type;                      // "block" | "item"
    item.collapsibleState = node.type === 'block'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    item.command = node.command;
    return item;
  }

  getChildren(node) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return [];

    const model = parseBlocks(ed.document);
    if (!node) {                                        // top level blocks
      this.model = model;                               // cache for reorder
      return model.map((b, idx) => ({
        label: `TODO @ line ${b.anchor + 1}`,
        type: 'block',
        block: idx,
        command: {
          command: 'todo.gotoBlock',
          title: '',
          arguments: [idx]
        }
      }));
    }

    if (node.type === 'block') {                        // children = items
      return this.model[node.block].items.map((it, idx) => ({
        label: it.text
          .replace(stripCmt, '')        // remove leading comment syntax
          .replace(/\*\/\s*$/, '')      // remove trailing */
          .trim(),
        type: 'item',
        block: node.block,
        item: idx,
        command: {
          command: 'revealLine',
          title: '',
          arguments: [{ lineNumber: it.line, at: 'center' }]
        }
      }));
    }
    return [];
  }
}

/* ────────────── drag‑and‑drop controller for Tree view ─────────── */
const dnd = {
  dragMimeTypes: ['application/x-todo-item'],
  dropMimeTypes: ['application/x-todo-item'],

  handleDrag(source, dataTransfer) {
    dataTransfer.set(this.dragMimeTypes[0], new vscode.DataTransferItem(source));
  },

  async handleDrop(target, dataTransfer) {
    const item = dataTransfer.get(this.dragMimeTypes[0]);
    if (!item) return;
    const dragged = item.value[0];
    if (target.type !== 'item' || dragged.block !== target.block) return;
    await reorder(dragged.block, dragged.item, target.item);
  }
};

/* ────────────────────── apply a reorder edit ───────────────────── */
async function reorder(blockIdx, fromIdx, toIdx) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;

  const doc   = ed.document;
  const model = parseBlocks(doc);
  const blk   = model[blockIdx];
  const items = blk.items.map(obj => obj.text);

  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);

  const start = doc.lineAt(blk.items[0].line).range.start;
  const end   = doc.lineAt(blk.items.at(-1).line).range.end;
  const range = new vscode.Range(start, end);

  const we = new vscode.WorkspaceEdit();
  we.replace(doc.uri, range, items.join('\n'));
  await vscode.workspace.applyEdit(we);

  // reposition caret
  const delta = toIdx - fromIdx;
  const newLine = blk.items[fromIdx].line + delta;
  ed.selection = new vscode.Selection(newLine, 0, newLine, 0);
}

/* ────────────────────── keyboard helper ───────────────────────── */
async function moveSelection(dir) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const line = ed.selection.active.line;
  const blocks = parseBlocks(ed.document);
  const blkIdx = blocks.findIndex(b => b.items.some(i => i.line === line));
  if (blkIdx === -1) return;

  const itemIdx = blocks[blkIdx].items.findIndex(i => i.line === line);
  const target  = dir === 'up' ? itemIdx - 1 : itemIdx + 1;
  if (target < 0 || target >= blocks[blkIdx].items.length) return;

  await reorder(blkIdx, itemIdx, target);
}

/* ───────────────────────── activate entry ──────────────────────── */
function activate(context) {

  const provider = new TodoProvider();
  const view = vscode.window.createTreeView('todo.view',
    { treeDataProvider: provider, dragAndDropController: dnd });
  context.subscriptions.push(view);

  context.subscriptions.push(
    vscode.commands.registerCommand('todo.scan',      () => provider.refresh()),
    vscode.commands.registerCommand('todo.moveUp',    () => moveSelection('up')),
    vscode.commands.registerCommand('todo.moveDown',  () => moveSelection('down')),
    vscode.commands.registerCommand('todo.gotoBlock', (idx) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const blocks = parseBlocks(ed.document);
      if (!blocks[idx]) return;
      const anchor = blocks[idx].anchor;
      vscode.window.showTextDocument(ed.document).then(() => {
        vscode.commands.executeCommand('revealLine', { lineNumber: anchor, at: 'center' });
        ed.selection = new vscode.Selection(anchor, 0, anchor, 0);
      });
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => provider.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
  );
}
exports.activate = activate;
exports.deactivate = () => {};