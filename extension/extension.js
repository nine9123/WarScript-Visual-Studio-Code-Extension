const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let definitions = { functions: [], classes: [] };
let fileWatcher = null;

// Semantic token types: indices matter — must match the legend order
const TOKEN_TYPES = ['nativeFunction', 'eventCallback', 'function'];
const tokenLegend = new vscode.SemanticTokensLegend(TOKEN_TYPES);

function activate(context) {
    loadDefinitions();
    watchDefinitions(context);

    // Reload when settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('warscript.definitionsPath')) {
                loadDefinitions();
                watchDefinitions(context);
            }
        })
    );

    // Autocomplete
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'warscript',
            new WarScriptCompletionProvider(),
            '.', ':'
        )
    );

    // Hover documentation
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            'warscript',
            new WarScriptHoverProvider()
        )
    );

    // Signature help (argument hints)
    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            'warscript',
            new WarScriptSignatureHelpProvider(),
            '[', ','
        )
    );

    // Semantic token highlighting
    const semanticProvider = new WarScriptSemanticTokensProvider();
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            'warscript',
            semanticProvider,
            tokenLegend
        )
    );

    // Go to definition (Ctrl+click / F12)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            'warscript',
            new WarScriptDefinitionProvider()
        )
    );
}

// --- Load and watch definitions file ---

function resolveDefsPath() {
    const configured = vscode.workspace.getConfiguration('warscript').get('definitionsPath');
    if (!configured) return null;

    if (path.isAbsolute(configured)) return configured;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return null;

    return path.join(workspaceRoot, configured);
}

function loadDefinitions() {
    const defsPath = resolveDefsPath();
    if (!defsPath) {
        definitions = { functions: [], classes: [] };
        return;
    }

    try {
        const content = fs.readFileSync(defsPath, 'utf-8');
        const parsed = JSON.parse(content);

        // Support both flat array (functions only) and object with categories
        if (Array.isArray(parsed)) {
            definitions = { functions: parsed, classes: [] };
        } else {
            definitions = {
                functions: parsed.functions || [],
                classes: parsed.classes || []
            };
        }

        console.log(`[WarScript] Loaded ${definitions.functions.length} functions, ${definitions.classes.length} classes`);
        semanticTokenEmitter.fire();
    } catch (e) {
        console.warn(`[WarScript] Failed to load definitions from ${defsPath}: ${e.message}`);
        definitions = { functions: [], classes: [] };
    }
}

function watchDefinitions(context) {
    if (fileWatcher) {
        fileWatcher.dispose();
        fileWatcher = null;
    }

    const defsPath = resolveDefsPath();
    if (!defsPath) return;

    const dir = path.dirname(defsPath);
    const filename = path.basename(defsPath);
    const pattern = new vscode.RelativePattern(dir, filename);
    fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    fileWatcher.onDidChange(() => loadDefinitions());
    fileWatcher.onDidCreate(() => loadDefinitions());
    fileWatcher.onDidDelete(() => {
        definitions = { functions: [], classes: [] };
    });

    context.subscriptions.push(fileWatcher);
}

// --- Built-in keyword completions ---

const KEYWORDS = [
    { label: 'if', detail: 'if condition', snippet: 'if ${1:condition}\n\t$0\nend' },
    { label: 'elif', detail: 'elif condition', snippet: 'elif ${1:condition}\n\t$0' },
    { label: 'else', detail: 'else branch', snippet: 'else\n\t$0' },
    { label: 'fun', detail: 'function definition', snippet: 'fun ${1:name}[${2:args}]\n\t$0\nend' },
    { label: 'class', detail: 'class definition', snippet: 'class ${1:Name}[${2:properties}]\n\t$0\nend' },
    { label: 'loop', detail: 'loop statement', snippet: 'loop ${1:i} in ${2:0}..${3:10}\n\t$0\nend' },
    { label: 'return', detail: 'return value', snippet: 'return ${1:value}' },
    { label: 'import', detail: 'import script', snippet: 'import "${1:path}"' },
    { label: 'begin', detail: 'exception handling', snippet: 'begin\n\t$0\nrescue ${1:error}\n\t\nend' },
    { label: 'print', detail: 'print value', snippet: 'print ${1:value}' },
    { label: 'assert', detail: 'assert condition', snippet: 'assert ${1:condition}' },
    { label: 'raise', detail: 'raise exception', snippet: 'raise ${1:value}' },
];

// --- Completion provider ---

class WarScriptCompletionProvider {
    provideCompletionItems(document, position) {
        const items = [];

        // Keyword snippets
        for (const kw of KEYWORDS) {
            const item = new vscode.CompletionItem(kw.label, vscode.CompletionItemKind.Keyword);
            item.detail = kw.detail;
            item.insertText = new vscode.SnippetString(kw.snippet);
            items.push(item);
        }

        // Native functions and events
        for (const fn of definitions.functions) {
            const isEvent = fn.kind === 'event';
            const item = new vscode.CompletionItem(
                fn.name,
                isEvent ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Function
            );

            const argLabels = (fn.args || []).map(a =>
                typeof a === 'string' ? a : `${a.name}: ${a.type}`
            );
            item.detail = `${fn.name}[${argLabels.join(', ')}]`;

            if (fn.doc) {
                item.documentation = new vscode.MarkdownString(fn.doc);
            }
            if (fn.returns) {
                item.documentation = new vscode.MarkdownString(
                    `${fn.doc || ''}\n\n**Returns:** \`${fn.returns}\``
                );
            }

            // Snippet with tab stops for each argument
            const args = fn.args || [];
            if (args.length > 0) {
                const snippetArgs = args.map((a, i) => {
                    const name = typeof a === 'string' ? a : a.name;
                    return `\${${i + 1}:${name}}`;
                }).join(', ');
                item.insertText = new vscode.SnippetString(`${fn.name}[${snippetArgs}]`);
            } else {
                item.insertText = new vscode.SnippetString(`${fn.name}[]`);
            }

            items.push(item);
        }

        // Native classes
        for (const cls of definitions.classes) {
            const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);

            const argLabels = (cls.args || []).map(a =>
                typeof a === 'string' ? a : `${a.name}: ${a.type}`
            );
            item.detail = `class ${cls.name}[${argLabels.join(', ')}]`;

            if (cls.doc) {
                item.documentation = new vscode.MarkdownString(cls.doc);
            }

            items.push(item);
        }

        // Variables/functions defined in the current file
        const text = document.getText();
        const funcRegex = /\bfun\s+([a-zA-Z_]\w*)/g;
        let match;
        const seen = new Set(definitions.functions.map(f => f.name));

        while ((match = funcRegex.exec(text)) !== null) {
            const name = match[1];
            if (!seen.has(name)) {
                seen.add(name);
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                item.detail = 'local function';
                items.push(item);
            }
        }

        const classRegex = /\bclass\s+([a-zA-Z_]\w*)/g;
        const seenClasses = new Set(definitions.classes.map(c => c.name));

        while ((match = classRegex.exec(text)) !== null) {
            const name = match[1];
            if (!seenClasses.has(name)) {
                seenClasses.add(name);
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
                item.detail = 'local class';
                items.push(item);
            }
        }

        return items;
    }
}

// --- Hover provider ---

class WarScriptHoverProvider {
    provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (!range) return null;

        const word = document.getText(range);

        // Check native functions
        const fn = definitions.functions.find(f => f.name === word);
        if (fn) {
            const argLabels = (fn.args || []).map(a =>
                typeof a === 'string' ? a : `${a.name}: ${a.type}`
            );
            const prefix = fn.kind === 'event' ? 'event ' : '';
            const signature = `${prefix}fun ${fn.name}[${argLabels.join(', ')}]`;
            const parts = [`\`\`\`warscript\n${signature}\n\`\`\``];

            if (fn.doc) parts.push(fn.doc);
            if (fn.returns) parts.push(`**Returns:** \`${fn.returns}\``);

            return new vscode.Hover(new vscode.MarkdownString(parts.join('\n\n')));
        }

        // Check native classes
        const cls = definitions.classes.find(c => c.name === word);
        if (cls) {
            const argLabels = (cls.args || []).map(a =>
                typeof a === 'string' ? a : `${a.name}: ${a.type}`
            );
            const signature = `class ${cls.name}[${argLabels.join(', ')}]`;
            const parts = [`\`\`\`warscript\n${signature}\n\`\`\``];

            if (cls.doc) parts.push(cls.doc);

            // Show methods if defined
            if (cls.methods && cls.methods.length > 0) {
                const methodList = cls.methods.map(m => {
                    const mArgs = (m.args || []).map(a =>
                        typeof a === 'string' ? a : `${a.name}: ${a.type}`
                    );
                    return `- \`${m.name}[${mArgs.join(', ')}]\`${m.doc ? ' — ' + m.doc : ''}`;
                }).join('\n');
                parts.push('**Methods:**\n' + methodList);
            }

            return new vscode.Hover(new vscode.MarkdownString(parts.join('\n\n')));
        }

        return null;
    }
}

// --- Signature help provider ---

class WarScriptSignatureHelpProvider {
    provideSignatureHelp(document, position) {
        // Walk backwards from cursor to find the function name and count commas
        const lineText = document.lineAt(position.line).text;
        const textUpToCursor = lineText.substring(0, position.character);

        // Find the innermost unclosed [ before the cursor
        let bracketDepth = 0;
        let openBracketPos = -1;
        for (let i = textUpToCursor.length - 1; i >= 0; i--) {
            if (textUpToCursor[i] === ']') bracketDepth++;
            else if (textUpToCursor[i] === '[') {
                if (bracketDepth === 0) {
                    openBracketPos = i;
                    break;
                }
                bracketDepth--;
            }
        }

        if (openBracketPos < 0) return null;

        // Extract function name before the [
        const beforeBracket = textUpToCursor.substring(0, openBracketPos).trimEnd();
        const nameMatch = beforeBracket.match(/([a-zA-Z_]\w*)$/);
        if (!nameMatch) return null;

        const funcName = nameMatch[1];
        const fn = definitions.functions.find(f => f.name === funcName);
        if (!fn || !fn.args || fn.args.length === 0) return null;

        // Count commas between the [ and cursor to determine active parameter
        const argsText = textUpToCursor.substring(openBracketPos + 1);
        let activeParam = 0;
        let depth = 0;
        for (const ch of argsText) {
            if (ch === '[' || ch === '{' || ch === '(') depth++;
            else if (ch === ']' || ch === '}' || ch === ')') depth--;
            else if (ch === ',' && depth === 0) activeParam++;
        }

        // Build signature
        const argLabels = (fn.args || []).map(a =>
            typeof a === 'string' ? a : `${a.name}: ${a.type}`
        );

        const sigInfo = new vscode.SignatureInformation(
            `${fn.name}[${argLabels.join(', ')}]`,
            fn.doc || ''
        );

        for (const argLabel of argLabels) {
            sigInfo.parameters.push(new vscode.ParameterInformation(argLabel));
        }

        const sigHelp = new vscode.SignatureHelp();
        sigHelp.signatures = [sigInfo];
        sigHelp.activeSignature = 0;
        sigHelp.activeParameter = Math.min(activeParam, argLabels.length - 1);

        return sigHelp;
    }
}

// --- Semantic token highlighting ---

const semanticTokenEmitter = new vscode.EventEmitter();

class WarScriptSemanticTokensProvider {
    constructor() {
        this.onDidChangeSemanticTokens = semanticTokenEmitter.event;
    }

    provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(tokenLegend);
        const text = document.getText();

        // Build lookup maps from definitions
        const nativeFuncs = new Set();
        const eventFuncs = new Set();
        for (const fn of definitions.functions) {
            if (fn.kind === 'event') {
                eventFuncs.add(fn.name);
            } else {
                nativeFuncs.add(fn.name);
            }
        }

        // Collect local function names defined in this file
        const localFuncs = new Set();
        const defRegex = /\bfun\s+([a-zA-Z_]\w*)/g;
        let defMatch;
        while ((defMatch = defRegex.exec(text)) !== null) {
            const name = defMatch[1];
            if (!nativeFuncs.has(name) && !eventFuncs.has(name)) {
                localFuncs.add(name);
            }
        }

        // Scan for function calls: name followed by [
        // Also match "fun name" definitions for event coloring
        const callRegex = /\b([a-zA-Z_]\w*)\s*(?=\[)/g;
        let match;
        while ((match = callRegex.exec(text)) !== null) {
            const name = match[1];
            const pos = document.positionAt(match.index);

            let tokenType = null;
            if (nativeFuncs.has(name)) {
                tokenType = 'nativeFunction';
            } else if (eventFuncs.has(name)) {
                tokenType = 'eventCallback';
            } else if (localFuncs.has(name)) {
                tokenType = 'function';
            }

            if (tokenType !== null) {
                builder.push(pos.line, pos.character, name.length, TOKEN_TYPES.indexOf(tokenType), 0);
            }
        }

        return builder.build();
    }
}

// --- Go to Definition ---

/**
 * Returns the workspace root (scripts folder).
 */
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

/**
 * Extracts all import paths from a document's text.
 * Matches: import "lib/common.ws"
 */
function parseImports(text) {
    const imports = [];
    const regex = /\bimport\s+"([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        imports.push(m[1]);
    }
    return imports;
}

/**
 * Searches a file on disk for `fun <name>` and returns the line number, or -1.
 */
function findFunctionInFile(filePath, funcName) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const pattern = new RegExp(`\\bfun\\s+${funcName}\\b`);
        for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
                return i;
            }
        }
    } catch (e) {
        // file not found or unreadable
    }
    return -1;
}

class WarScriptDefinitionProvider {
    provideDefinition(document, position) {
        const line = document.lineAt(position.line).text;

        // Case 1: cursor is on an import path string → navigate to file
        const importMatch = line.match(/\bimport\s+"([^"]+)"/);
        if (importMatch) {
            const pathStart = line.indexOf('"') + 1;
            const pathEnd = line.indexOf('"', pathStart);
            if (position.character >= pathStart && position.character <= pathEnd) {
                const root = getWorkspaceRoot();
                if (!root) return null;

                const targetPath = path.join(root, importMatch[1]);
                if (fs.existsSync(targetPath)) {
                    return new vscode.Location(
                        vscode.Uri.file(targetPath),
                        new vscode.Position(0, 0)
                    );
                }
            }
        }

        // Case 2: cursor is on a function/class name → find definition
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (!wordRange) return null;

        const word = document.getText(wordRange);

        // Skip keywords
        const keywords = new Set([
            'if', 'elif', 'else', 'end', 'fun', 'class', 'return', 'loop',
            'in', 'by', 'break', 'next', 'print', 'import', 'assert', 'raise',
            'begin', 'rescue', 'ensure', 'and', 'or', 'not', 'new', 'as', 'is',
            'true', 'false', 'null', 'this'
        ]);
        if (keywords.has(word)) return null;

        // If it's a native function/event, there's no source to navigate to
        if (definitions.functions.some(f => f.name === word)) return null;

        const root = getWorkspaceRoot();
        if (!root) return null;

        // Search current file first
        const currentText = document.getText();
        const defPattern = new RegExp(`\\bfun\\s+${word}\\b`);
        const currentLines = currentText.split('\n');
        for (let i = 0; i < currentLines.length; i++) {
            if (defPattern.test(currentLines[i])) {
                const col = currentLines[i].indexOf(word);
                return new vscode.Location(
                    document.uri,
                    new vscode.Position(i, col)
                );
            }
        }

        // Search imported files (resolved relative to workspace root)
        const importPaths = parseImports(currentText);
        for (const imp of importPaths) {
            const filePath = path.join(root, imp);
            const lineNum = findFunctionInFile(filePath, word);
            if (lineNum >= 0) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const col = content.split('\n')[lineNum].indexOf(word);
                return new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(lineNum, Math.max(0, col))
                );
            }
        }

        return null;
    }
}

function deactivate() {
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}

module.exports = { activate, deactivate };
