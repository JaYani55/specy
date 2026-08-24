# TipTap Markdown Editor Integration

## Overview
The page builder now uses TipTap, a modern WYSIWYG editor, for all text content blocks. This provides a rich editing experience with markdown support and inline link editing.

## Features
- **Bold text**: Use `**text**` or click the bold button
- **Italic text**: Use `*text*` or click the italic button
- **Headings**: Use `#`, `##`, `###` or click the heading buttons
- **Lists**: Bullet lists and numbered lists
- **Links**: Mark text, click the link button, paste a URL, and save it as markdown link syntax
- **Real-time preview**: See your formatting as you type

## Components Updated

### 1. ContentBlockEditor
- Text blocks now use `MarkdownEditor` instead of plain `Textarea`
- Removed the format dropdown (replaced by toolbar)

### 2. HeroForm
- Hero description blocks use markdown editor
- Supports rich formatting in the hero section

### 3. FeaturesForm
- Feature descriptions use markdown editor
- Each feature can have rich formatted text

### 4. CardsForm
- Card content text blocks use markdown editor
- Mix bullet points and formatted text

### 5. FaqForm
- FAQ answers use markdown editor
- Rich formatting for detailed answers

## How It Works

### Markdown to Storage
The editor converts formatted text to markdown strings for storage:
```
**Bold text** → stored as: "**Bold text**"
*Italic text* → stored as: "*Italic text*"
# Heading 1 → stored as: "# Heading 1"
[OpenAI](https://openai.com) → stored as: "[OpenAI](https://openai.com)"
```

### Storage to Display
When loading data, markdown is converted back to TipTap document nodes for the editor:
```
"**Bold text**" → displayed as: <strong>Bold text</strong>
"*Italic text*" → displayed as: <em>Italic text</em>
"# Heading 1" → displayed as: <h1>Heading 1</h1>
"[OpenAI](https://openai.com)" → displayed as: <a href="https://openai.com">OpenAI</a>
```

### Link Workflow
1. Select the text you want to link.
2. Click the link button in the toolbar.
3. Paste an absolute URL, `mailto:`, `tel:`, `/relative-path`, or `#anchor`.
4. Click `Link uebernehmen`.

If the user pastes a bare hostname such as `example.com`, the editor normalizes it to `https://example.com` before saving.

## Editor Toolbar
Each MarkdownEditor instance includes a toolbar with:
- Bold (Ctrl/Cmd + B)
- Italic (Ctrl/Cmd + I)
- Heading 1, 2, 3
- Bullet list
- Numbered list
- Link / unlink

## Styling
Editor styles are defined in `src/index.css` under the `.ProseMirror` class.

## Dependencies
- `@tiptap/react`: React bindings
- `@tiptap/pm`: ProseMirror core
- `@tiptap/starter-kit`: Basic extensions
- `@tiptap/extension-typography`: Enhanced typography
- `@tiptap/extension-bold`: Bold formatting
- `@tiptap/extension-italic`: Italic formatting
- `@tiptap/extension-link`: Inline links with toolbar support

## Migration Notes
- Old TextBlock `format` property is no longer used
- All formatting is now inline within the content string
- HeadingBlock type remains for standalone headings (not inline)
- Backward compatible with existing plain text content and previously saved markdown blocks

## Supported Markdown Subset
The custom parser/serializer currently supports:
- Paragraphs
- Headings `#` to `###`
- Bold `**text**`
- Italic `*text*`
- Combined bold + italic `***text***`
- Bullet and ordered lists
- Links `[label](url)`

This is intentionally a constrained subset so stored ContentBlock text stays predictable for schema-driven pages and downstream renderers.
