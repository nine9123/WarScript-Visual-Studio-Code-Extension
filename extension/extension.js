const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let definitions = { functions: [], classes: [] };
let fileWatcher = null;

// Semantic token types: indices matter — must match the legend order
const TOKEN_TYPES = ['nativeFunction', 'eventCallback', 'function', 'class'];
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

    // Document symbols (Outline / breadcrumbs)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            'warscript',
            new WarScriptDocumentSymbolProvider()
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
    { label: 'class (inherit)', detail: 'class with inheritance', snippet: 'class ${1:Name} : ${2:Base}[${3:properties}]\n\t$0\nend' },
    { label: 'loop', detail: 'loop with range', snippet: 'loop ${1:i} in ${2:0}..${3:10}\n\t$0\nend' },
    { label: 'loop (by step)', detail: 'loop with step', snippet: 'loop ${1:i} in ${2:0}..${3:10} by ${4:2}\n\t$0\nend' },
    { label: 'loop (iterable)', detail: 'loop over array', snippet: 'loop ${1:item} in ${2:array}\n\t$0\nend' },
    { label: 'return', detail: 'return value', snippet: 'return ${1:value}' },
    { label: 'import', detail: 'import script', snippet: 'import "${1:path}"' },
    { label: 'begin', detail: 'exception handling', snippet: 'begin\n\t$0\nrescue ${1:error}\n\t\nend' },
    { label: 'begin (ensure)', detail: 'try/rescue/ensure', snippet: 'begin\n\t$0\nrescue ${1:error}\n\t\nensure\n\t\nend' },
    { label: 'print', detail: 'print value', snippet: 'print ${1:value}' },
    { label: 'assert', detail: 'assert condition', snippet: 'assert ${1:condition}' },
    { label: 'raise', detail: 'raise exception', snippet: 'raise ${1:value}' },
    { label: 'yield', detail: 'yield coroutine', snippet: 'yield' },
    { label: 'yield wait', detail: 'yield wait seconds', snippet: 'yield wait ${1:seconds}' },
    { label: 'yield until', detail: 'yield until condition', snippet: 'yield until ${1:condition}' },
    { label: 'new', detail: 'new class instance', snippet: 'new ${1:ClassName}[${2:args}]' },
];

// --- Built-in operator keyword completions ---

const OPERATOR_KEYWORDS = [
    { label: 'and', detail: 'logical AND', doc: 'Returns true if both operands are true' },
    { label: 'or', detail: 'logical OR', doc: 'Returns true if either operand is true' },
    { label: 'not', detail: 'logical NOT (prefix: !)', doc: 'Negates a boolean value. Also usable as ! prefix' },
    { label: 'as', detail: 'type cast', doc: 'Casts an object to another class type: `obj as ClassName`' },
    { label: 'is', detail: 'instance check', doc: 'Checks if an object is an instance of a class: `obj is ClassName`' },
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

        // Operator keywords
        for (const ok of OPERATOR_KEYWORDS) {
            const item = new vscode.CompletionItem(ok.label, vscode.CompletionItemKind.Operator);
            item.detail = ok.detail;
            if (ok.doc) {
                item.documentation = new vscode.MarkdownString(ok.doc);
            }
            items.push(item);
        }

        // Constant completions
        for (const c of ['true', 'false', 'null', 'this']) {
            const item = new vscode.CompletionItem(c, vscode.CompletionItemKind.Constant);
            item.detail = c === 'this' ? 'current instance reference' : `literal ${c}`;
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

        // Variables/functions/classes defined in the current file
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

        // Class member completions after ::
        const lineText = document.lineAt(position.line).text;
        const textBefore = lineText.substring(0, position.character);
        const memberMatch = textBefore.match(/(\w+)\s*::\s*$/);
        if (memberMatch) {
            const varName = memberMatch[1];
            // Try to find class from constructor: varName = new ClassName[...]
            const ctorRegex = new RegExp(`\\b${varName}\\s*=\\s*new\\s+(\\w+)\\s*\\[`);
            const ctorMatch = ctorRegex.exec(text);
            if (ctorMatch) {
                const className = ctorMatch[1];
                // Find class definition and extract properties and methods
                const classDefRegex = new RegExp(`\\bclass\\s+${className}\\s*(?::\\s*\\w+)?\\s*\\[([^\\]]*)\\]`);
                const classDefMatch = classDefRegex.exec(text);
                if (classDefMatch) {
                    const props = classDefMatch[1].split(',').map(p => p.trim()).filter(p => p);
                    for (const prop of props) {
                        const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
                        item.detail = `${className} property`;
                        items.push(item);
                    }
                }

                // Find methods in the class body
                const classBody = extractClassBody(text, className);
                if (classBody) {
                    const methodRegex = /\bfun\s+([a-zA-Z_]\w*)/g;
                    let mMatch;
                    while ((mMatch = methodRegex.exec(classBody)) !== null) {
                        const item = new vscode.CompletionItem(mMatch[1], vscode.CompletionItemKind.Method);
                        item.detail = `${className} method`;
                        items.push(item);
                    }
                }
            }
        }

        return items;
    }
}

/**
 * Extracts the body text of a class definition (between class header and its matching end).
 */
function extractClassBody(text, className) {
    const regex = new RegExp(`\\bclass\\s+${className}\\b[^\\n]*`);
    const match = regex.exec(text);
    if (!match) return null;

    let depth = 1;
    let pos = match.index + match[0].length;
    const lines = text.substring(pos).split('\n');
    const bodyLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^(if|fun|class|loop|begin)\b/.test(trimmed)) depth++;
        if (/^end\b/.test(trimmed)) {
            depth--;
            if (depth === 0) break;
        }
        bodyLines.push(line);
    }

    return bodyLines.join('\n');
}

// --- Hover provider ---

class WarScriptHoverProvider {
    provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (!range) return null;

        const word = document.getText(range);

        // Built-in keyword documentation
        const keywordDocs = {
            'yield': '```warscript\nyield\nyield wait <seconds>\nyield until <condition>\n```\n\nPauses coroutine execution. `yield` suspends until next tick, `yield wait` suspends for a duration, `yield until` suspends until a condition is true.',
            'as': 'Cast operator. Casts an object to a specified class type.\n\n```warscript\nobj as ClassName\n```',
            'is': 'Instance-of check. Returns true if an object is an instance of a class.\n\n```warscript\nobj is ClassName\n```',
            'import': 'Imports and executes another WarScript file.\n\n```warscript\nimport "path/to/file.ws"\n```',
        };
        if (keywordDocs[word]) {
            return new vscode.Hover(new vscode.MarkdownString(keywordDocs[word]));
        }

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

        // Check local class definitions with properties
        const text = document.getText();
        const localClassRegex = new RegExp(`\\bclass\\s+${word}\\s*(?::\\s*(\\w+))?\\s*\\[([^\\]]*)\\]`);
        const localClassMatch = localClassRegex.exec(text);
        if (localClassMatch) {
            const baseClass = localClassMatch[1] || '';
            const props = localClassMatch[2].split(',').map(p => p.trim()).filter(p => p);
            const inherit = baseClass ? ` : ${baseClass}` : '';
            const signature = `class ${word}${inherit}[${props.join(', ')}]`;
            const parts = [`\`\`\`warscript\n${signature}\n\`\`\``];

            // List methods
            const body = extractClassBody(text, word);
            if (body) {
                const methodNames = [];
                const mRegex = /\bfun\s+([a-zA-Z_]\w*)\s*\[([^\]]*)\]/g;
                let mMatch;
                while ((mMatch = mRegex.exec(body)) !== null) {
                    methodNames.push(`- \`${mMatch[1]}[${mMatch[2]}]\``);
                }
                if (methodNames.length > 0) {
                    parts.push('**Methods:**\n' + methodNames.join('\n'));
                }
            }

            return new vscode.Hover(new vscode.MarkdownString(parts.join('\n\n')));
        }

        // Check local function definitions with parameters
        const localFuncRegex = new RegExp(`\\bfun\\s+${word}\\s*\\[([^\\]]*)\\]`);
        const localFuncMatch = localFuncRegex.exec(text);
        if (localFuncMatch) {
            const params = localFuncMatch[1].split(',').map(p => p.trim()).filter(p => p);
            const signature = `fun ${word}[${params.join(', ')}]`;
            return new vscode.Hover(new vscode.MarkdownString(`\`\`\`warscript\n${signature}\n\`\`\``));
        }

        return null;
    }
}

// --- Signature help provider ---

class WarScriptSignatureHelpProvider {
    provideSignatureHelp(document, position) {
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

        // Check native definitions
        const fn = definitions.functions.find(f => f.name === funcName);

        // If not native, try to find local function definition
        let args = null;
        if (fn) {
            args = fn.args;
        } else {
            const text = document.getText();
            const localMatch = new RegExp(`\\bfun\\s+${funcName}\\s*\\[([^\\]]*)\\]`).exec(text);
            if (localMatch) {
                args = localMatch[1].split(',').map(p => p.trim()).filter(p => p);
            }
        }

        if (!args || args.length === 0) return null;

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
        const argLabels = args.map(a =>
            typeof a === 'string' ? a : `${a.name}: ${a.type}`
        );

        const sigInfo = new vscode.SignatureInformation(
            `${funcName}[${argLabels.join(', ')}]`,
            fn?.doc || ''
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

// --- Document Symbol provider (Outline) ---

class WarScriptDocumentSymbolProvider {
    provideDocumentSymbols(document) {
        const symbols = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match class definitions
            const classMatch = line.match(/\bclass\s+([a-zA-Z_]\w*)/);
            if (classMatch) {
                const name = classMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const symbol = new vscode.DocumentSymbol(
                    name, 'class',
                    vscode.SymbolKind.Class,
                    range, range
                );
                symbols.push(symbol);
                continue;
            }

            // Match function definitions
            const funcMatch = line.match(/\bfun\s+([a-zA-Z_]\w*)/);
            if (funcMatch) {
                const name = funcMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const symbol = new vscode.DocumentSymbol(
                    name, 'function',
                    vscode.SymbolKind.Function,
                    range, range
                );
                symbols.push(symbol);
            }
        }

        return symbols;
    }
}

// --- Go to Definition ---

function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function parseImports(text) {
    const imports = [];
    const regex = /\bimport\s+"([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        imports.push(m[1]);
    }
    return imports;
}

function findDefinitionInFile(filePath, name) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        // Search for both fun and class definitions
        const funcPattern = new RegExp(`\\bfun\\s+${name}\\b`);
        const classPattern = new RegExp(`\\bclass\\s+${name}\\b`);
        for (let i = 0; i < lines.length; i++) {
            if (funcPattern.test(lines[i]) || classPattern.test(lines[i])) {
                return { line: i, col: lines[i].indexOf(name) };
            }
        }
    } catch (e) {
        // file not found or unreadable
    }
    return null;
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
            'true', 'false', 'null', 'this', 'yield', 'wait', 'until'
        ]);
        if (keywords.has(word)) return null;

        // If it's a native function/event or class, there's no source to navigate to
        if (definitions.functions.some(f => f.name === word)) return null;
        if (definitions.classes.some(c => c.name === word)) return null;

        const root = getWorkspaceRoot();
        if (!root) return null;

        // Search current file first (functions and classes)
        const currentText = document.getText();
        const currentLines = currentText.split('\n');
        const funcPattern = new RegExp(`\\bfun\\s+${word}\\b`);
        const classPattern = new RegExp(`\\bclass\\s+${word}\\b`);

        for (let i = 0; i < currentLines.length; i++) {
            if (funcPattern.test(currentLines[i]) || classPattern.test(currentLines[i])) {
                const col = currentLines[i].indexOf(word);
                return new vscode.Location(
                    document.uri,
                    new vscode.Position(i, col)
                );
            }
        }

        // Search imported files
        const importPaths = parseImports(currentText);
        for (const imp of importPaths) {
            const filePath = path.join(root, imp);
            const result = findDefinitionInFile(filePath, word);
            if (result) {
                return new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(result.line, Math.max(0, result.col))
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
