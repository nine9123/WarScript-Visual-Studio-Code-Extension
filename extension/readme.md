# WarScript — VS Code Extension

Syntax highlighting, autocomplete, code intelligence, and language support for WarScript `.ws` files.

## Features

### Syntax Highlighting
- All keywords: `if`, `elif`, `else`, `end`, `fun`, `class`, `return`, `loop`, `in`, `by`, `break`, `next`, `assert`, `raise`, `begin`, `rescue`, `ensure`, `import`, `yield`
- Operator keywords: `and`, `or`, `not`, `new`, `as`, `is`
- String interpolation: expressions inside `"{...}"` are highlighted with full language support
- Compound assignment operators: `+=`, `-=`, `*=`, `/=`
- All arithmetic, comparison, and logical operators
- Class inheritance syntax: `class Derived : Base[...]`
- Constants: `true`, `false`, `null`, `this`
- Numeric literals (integer and decimal)
- Comments (`#`)

### Autocomplete
- Keyword snippets with tab stops (if/elif/else, fun, class, loop, begin/rescue/ensure, yield, etc.)
- Loop variants: range, step (`by`), and iterable
- Class inheritance snippet
- Yield variants: `yield`, `yield wait`, `yield until`
- Native API functions and classes (from `warscript-defs.json`)
- Local function and class name completion
- Class member completion after `::` (infers class type from `new` expressions)
- Operator keyword completions with documentation

### Hover Documentation
- Native API functions and classes with signatures, parameters, and return types
- Local function and class signatures (extracted from source)
- Class method listings on hover
- Built-in keyword documentation (`yield`, `as`, `is`, `import`)

### Signature Help
- Parameter hints when typing inside `[...]` for both native and local functions

### Semantic Highlighting
- Native functions, event callbacks, and local function calls each get distinct colors
- Configurable via `editor.semanticTokenColorCustomizations`

### Go to Definition
- `Ctrl+Click` / `F12` on function and class names navigates to their definition
- Works across imported files (`import "path/file.ws"`)
- Clicking an import path navigates to that file

### Code Navigation
- Document symbols in the Outline panel and breadcrumbs (functions and classes)
- Code folding between block keywords and `end`
- Bracket matching and auto-closing for `[]`, `{}`, `()`, `""`
- Smart indentation on block keywords
- Comment toggling with `Cmd+/` / `Ctrl+/`

## Configuration

| Setting | Description |
|---------|-------------|
| `warscript.definitionsPath` | Path to a `warscript-defs.json` file that defines native API functions and classes for autocomplete, hover, and highlighting. Can be absolute or relative to the workspace root. |

## Building from Source

This repository includes a GitHub Actions workflow to build the `.vsix` package:

1. Go to **Actions** → **Build VSIX**
2. Click **Run workflow**
3. Optionally override the version or toggle release creation
4. Download the artifact or find it under **Releases**

To install the `.vsix` manually:
- Open VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Run **Extensions: Install from VSIX...**
- Select the downloaded `.vsix` file
