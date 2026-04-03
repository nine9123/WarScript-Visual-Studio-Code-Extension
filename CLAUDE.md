# CLAUDE.md — WarScript VS Code Extension

## What This Is

A VS Code extension providing language support for WarScript `.ws` files. Offers syntax highlighting, autocomplete, hover docs, signature help, semantic tokens, go-to-definition, and document symbols. Consumes a `warscript-defs.json` file exported from Unity for native API awareness.

## Project Structure

```
extension/
├── extension.js                      # All extension logic — single file, no build step
├── package.json                      # Extension manifest, contributes, semantic token config
├── language-configuration.json       # Brackets, folding, indentation, comment toggling
├── syntaxes/
│   └── warscript.tmLanguage.json     # TextMate grammar for syntax highlighting
└── readme.md                         # User-facing feature documentation
```

No dependencies, no TypeScript, no bundler. The extension is a single `extension.js` that VS Code loads directly.

## Definitions JSON Schema

The extension reads `warscript-defs.json` (path configured via `warscript.definitionsPath` setting). This file is exported from Unity by `WarScriptDefsExporter.cs`.

```json
{
  "functions": [
    {
      "name": "deal_damage",
      "module": "combat",
      "args": [{ "name": "amount", "type": "Numeric" }, { "name": "type", "type": "Numeric" }],
      "returns": "Numeric",
      "doc": "Apply damage to a unit"
    }
  ],
  "enums": [
    {
      "name": "DamageType",
      "module": "combat",
      "members": [{ "name": "Physical", "value": 0 }, { "name": "Magical", "value": 1 }]
    }
  ],
  "constants": [
    {
      "name": "MAX_HP",
      "module": "combat",
      "type": "Numeric",
      "value": "100"
    }
  ],
  "keywords": ["if", "elif", "else", "end", "fun", "class", "const", "enum", ...]
}
```

All arrays are optional. The extension handles missing fields gracefully.

## Architecture — What Each Provider Does

### CompletionProvider (triggers: `.`, `:`)

Three modes based on context:

1. **After `::`** — context-aware member completion:
   - If name matches a native enum → member names + `name`/`values`/`names`/`count` utilities
   - If name matches a local `enum` block → parse members from source
   - Otherwise → class property + method completion (infers type from `var = new ClassName [...]`)

2. **General position** — everything else:
   - Keyword snippets (if, fun, class, loop, const, enum, lambda, yield, etc.)
   - Operator keywords (and, or, as, is)
   - Native functions (with tab-stop snippets for args)
   - Native enums (with member count in detail)
   - Native constants (with value in detail)
   - Local functions, classes, enums, constants from current file

3. **Deduplication** — a `seen` set prevents double-offering native + local definitions.

### HoverProvider

Lookup chain (first match wins):
1. Built-in keyword docs (`yield`, `as`, `is`, `import`, `const`, `enum`)
2. Native function → signature + module + doc + returns
3. Native enum → member table (name | value) + access/iterate hints
4. Native constant → `const NAME = value` + type
5. Local enum → parsed member table from source
6. Local const → `const NAME = value` from source
7. Local class → signature + method listing
8. Local function → signature

### SignatureHelpProvider (triggers: `[`, `,`)

Finds the innermost unclosed `[`, extracts function name, looks up args from:
1. Native definitions
2. Local `fun name [params]` pattern

Counts commas to determine active parameter index. Respects nested brackets.

### SemanticTokensProvider

Token types (indices matter — must match `TOKEN_TYPES` array and `package.json` order):

| Index | Type | What it matches | Default color |
|-------|------|----------------|---------------|
| 0 | `nativeFunction` | Names in `definitions.functions` | `#7aafcf` (blue) |
| 1 | `function` | Local `fun` names not in native set | VS Code default |
| 2 | `class` | (reserved for future use) | VS Code default |
| 3 | `enumType` | Names in native/local enums | `#4ec9b0` (teal) |
| 4 | `constName` | Names in native/local constants | `#d4a843` (gold) |

Scans all identifiers in the document and pushes tokens for matches. Rebuilds on every document change and when definitions reload.

### DocumentSymbolProvider

Line-by-line regex scan for:
- `class Name` → `SymbolKind.Class`
- `fun name` → `SymbolKind.Function`
- `enum Name` → `SymbolKind.Enum`
- `const NAME` → `SymbolKind.Constant`

Feeds the Outline panel and breadcrumbs.

### DefinitionProvider (Ctrl+click / F12)

1. **Import paths** — cursor on `"path"` in `import "path"` → navigate to file
2. **Identifiers** — skip keywords, skip native definitions (no source), then:
   - Search current file for `fun/class/enum/const name`
   - Search imported files (follows `import "..."` paths)

## TextMate Grammar

`syntaxes/warscript.tmLanguage.json` — order of patterns matters (first match wins):

1. `comment` — `#` to end of line
2. `string-interpolation` — `"..."` with nested `{expr}` that re-includes the full grammar
3. `numeric` — integers, decimals, with `_` separators
4. `const-definition` — `const NAME` → keyword + constant scope
5. `enum-definition` — `enum Name` → keyword + type scope
6. `function-definition` — `fun name` → keyword + function name scope
7. `class-definition` — `class Name : Base` → keyword + class + inheritance scopes
8. `function-call` — `name[` → function call scope
9. `class-method-call` — `:: name[` → method call scope
10. `keyword-control` — all keywords including `const`, `enum`
11. `keyword-operator` — `and`, `or`, `not`, `new`, `as`, `is`
12. Then: booleans, null, this, compound assignment, operators, range `..`, `::`, `:`, brackets, commas, catch-all variable

## Language Configuration

`language-configuration.json`:
- **Folding**: `if`, `fun`, `class`, `loop`, `begin`, `enum` → `end`
- **Indent increase**: `if`, `elif`, `else`, `fun`, `class`, `loop`, `begin`, `rescue`, `ensure`, `enum`
- **Indent decrease**: `end`, `elif`, `else`, `rescue`, `ensure`
- **Auto-close**: `[]`, `{}`, `()`, `""`
- **Comment toggle**: `#`

## Key Patterns for Modifying

### Adding a new keyword
1. `extension.js` → add to `KEYWORDS` array with snippet
2. `extension.js` → add to keyword set in `DefinitionProvider` (so Ctrl+click doesn't try to navigate)
3. `syntaxes/warscript.tmLanguage.json` → add to `keyword-control` regex
4. `language-configuration.json` → add to folding/indent rules if it's a block keyword

### Adding a new definition type (like enums/consts were added)
1. `extension.js` → extend `definitions` object shape in `loadDefinitions`
2. `extension.js` → add completion items in `WarScriptCompletionProvider`
3. `extension.js` → add hover in `WarScriptHoverProvider`
4. `extension.js` → add semantic token type to `TOKEN_TYPES` + scanner
5. `extension.js` → add to `DocumentSymbolProvider` regex
6. `extension.js` → add to `DefinitionProvider` skip list + search patterns
7. `package.json` → add `semanticTokenTypes` entry + scope mapping + default color
8. `syntaxes/warscript.tmLanguage.json` → add grammar pattern

### Adding :: member completion for a new type
Add a branch in the `memberMatch` block of `WarScriptCompletionProvider` (after the enum check, before the class fallthrough).

## Gotchas

- **`TOKEN_TYPES` array order must match `package.json` `semanticTokenTypes` order.** Mismatch causes wrong colors.
- **The `semanticTokenEmitter.fire()` call in `loadDefinitions`** is what triggers a re-highlight when the defs file changes.
- **`extractClassBody` tracks nesting depth** to handle `end` matching. It must include `enum` in the depth-increase keywords since enums also end with `end`.
- **Numeric regex** uses `[0-9][0-9_]*` to support underscore separators (e.g., `1_000_000`).
- **The extension has no build step.** Edit `extension.js` directly. For testing: `F5` in VS Code with the extension folder open launches an Extension Development Host.
- **`warscript-defs.json` is hot-reloaded** via a file watcher. Re-exporting from Unity auto-updates the extension without restart.
