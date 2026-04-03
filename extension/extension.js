const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let definitions = { functions: [], enums: [], constants: [], keywords: [] };
let fileWatcher = null;

const TOKEN_TYPES = ['nativeFunction', 'function', 'class', 'enumType', 'constName'];
const tokenLegend = new vscode.SemanticTokensLegend(TOKEN_TYPES);

function activate(context) {
    loadDefinitions();
    watchDefinitions(context);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('warscript.definitionsPath')) {
                loadDefinitions();
                watchDefinitions(context);
            }
        })
    );

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('warscript', new WarScriptCompletionProvider(), '.', ':'));
    context.subscriptions.push(vscode.languages.registerHoverProvider('warscript', new WarScriptHoverProvider()));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider('warscript', new WarScriptSignatureHelpProvider(), '[', ','));
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider('warscript', new WarScriptSemanticTokensProvider(), tokenLegend));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider('warscript', new WarScriptDefinitionProvider()));
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider('warscript', new WarScriptDocumentSymbolProvider()));
}

// --- Definitions loading ---

function resolveDefsPath() {
    const configured = vscode.workspace.getConfiguration('warscript').get('definitionsPath');
    if (!configured) return null;
    if (path.isAbsolute(configured)) return configured;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, configured) : null;
}

function loadDefinitions() {
    const p = resolveDefsPath();
    if (!p) { definitions = { functions: [], enums: [], constants: [], keywords: [] }; return; }
    try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        definitions = {
            functions: parsed.functions || [],
            enums: parsed.enums || [],
            constants: parsed.constants || [],
            keywords: parsed.keywords || []
        };
        console.log(`[WarScript] Loaded ${definitions.functions.length} functions, ${definitions.enums.length} enums, ${definitions.constants.length} constants`);
        semanticTokenEmitter.fire();
    } catch (e) {
        console.warn(`[WarScript] Failed to load defs: ${e.message}`);
        definitions = { functions: [], enums: [], constants: [], keywords: [] };
    }
}

function watchDefinitions(context) {
    if (fileWatcher) { fileWatcher.dispose(); fileWatcher = null; }
    const p = resolveDefsPath();
    if (!p) return;
    const pattern = new vscode.RelativePattern(path.dirname(p), path.basename(p));
    fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    fileWatcher.onDidChange(() => loadDefinitions());
    fileWatcher.onDidCreate(() => loadDefinitions());
    fileWatcher.onDidDelete(() => { definitions = { functions: [], enums: [], constants: [], keywords: [] }; });
    context.subscriptions.push(fileWatcher);
}

// --- Keywords ---

const KEYWORDS = [
    { label: 'if', detail: 'if condition', snippet: 'if ${1:condition}\n\t$0\nend' },
    { label: 'elif', detail: 'elif condition', snippet: 'elif ${1:condition}\n\t$0' },
    { label: 'else', detail: 'else branch', snippet: 'else\n\t$0' },
    { label: 'fun', detail: 'function definition', snippet: 'fun ${1:name} [${2:args}]\n\t$0\nend' },
    { label: 'class', detail: 'class definition', snippet: 'class ${1:Name} [${2:properties}]\n\t$0\nend' },
    { label: 'class (inherit)', detail: 'class with inheritance', snippet: 'class ${1:Name} : ${2:Base} [${3:properties}]\n\t$0\nend' },
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
    { label: 'new', detail: 'new class instance', snippet: 'new ${1:ClassName} [${2:args}]' },
    { label: 'const', detail: 'constant declaration', snippet: 'const ${1:NAME} = ${2:value}' },
    { label: 'enum', detail: 'enum definition', snippet: 'enum ${1:Name}\n\t${2:MEMBER}\nend' },
    { label: 'fun (lambda)', detail: 'anonymous function', snippet: 'fun [${1:params}] ${2:return value} end' },
];

const OPERATOR_KEYWORDS = [
    { label: 'and', detail: 'logical AND', doc: 'Returns true if both operands are true' },
    { label: 'or', detail: 'logical OR', doc: 'Returns true if either operand is true' },
    { label: 'not', detail: 'logical NOT (prefix: !)', doc: 'Negates a boolean value' },
    { label: 'as', detail: 'type cast', doc: 'Cast: `obj as ClassName`' },
    { label: 'is', detail: 'instance check', doc: 'Check: `obj is ClassName`' },
];

// --- Helpers ---

function extractClassBody(text, className) {
    const regex = new RegExp(`\\bclass\\s+${className}\\b[^\\n]*`);
    const match = regex.exec(text);
    if (!match) return null;
    let depth = 1, pos = match.index + match[0].length;
    const lines = text.substring(pos).split('\n'), bodyLines = [];
    for (const line of lines) {
        const t = line.trim();
        if (/^(if|fun|class|loop|begin|enum)\b/.test(t)) depth++;
        if (/^end\b/.test(t)) { depth--; if (depth === 0) break; }
        bodyLines.push(line);
    }
    return bodyLines.join('\n');
}

function argLabel(a) { return typeof a === 'string' ? a : (a.type ? `${a.name}: ${a.type}` : a.name); }

// --- Completion ---

class WarScriptCompletionProvider {
    provideCompletionItems(document, position) {
        const items = [];
        const lineText = document.lineAt(position.line).text;
        const textBefore = lineText.substring(0, position.character);

        // :: member completions
        const memberMatch = textBefore.match(/(\w+)\s*::\s*$/);
        if (memberMatch) {
            const varName = memberMatch[1];
            // Native enum
            const enumDef = definitions.enums.find(e => e.name === varName);
            if (enumDef) {
                for (const m of enumDef.members) {
                    const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.EnumMember);
                    item.detail = `${varName} :: ${m.name} = ${m.value}`;
                    items.push(item);
                }
                for (const u of ['name', 'values', 'names', 'count']) {
                    items.push(new vscode.CompletionItem(u, u === 'name' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property));
                }
                return items;
            }
            // Local enum
            const text = document.getText();
            const enumBody = new RegExp(`\\benum\\s+${varName}\\b([\\s\\S]*?)\\bend\\b`).exec(text);
            if (enumBody) {
                const mRegex = /^\s*([A-Z_]\w*)/gm;
                let m;
                while ((m = mRegex.exec(enumBody[1])) !== null)
                    items.push(new vscode.CompletionItem(m[1], vscode.CompletionItemKind.EnumMember));
                for (const u of ['name', 'values', 'names', 'count'])
                    items.push(new vscode.CompletionItem(u, u === 'name' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property));
                return items;
            }
            // Class members
            const ctorMatch = new RegExp(`\\b${varName}\\s*=\\s*new\\s+(\\w+)\\s*\\[`).exec(document.getText());
            if (ctorMatch) {
                const cn = ctorMatch[1], t2 = document.getText();
                const cdm = new RegExp(`\\bclass\\s+${cn}\\s*(?::\\s*\\w+)?\\s*\\[([^\\]]*)\\]`).exec(t2);
                if (cdm) for (const p of cdm[1].split(',').map(s=>s.trim()).filter(Boolean))
                    items.push(Object.assign(new vscode.CompletionItem(p, vscode.CompletionItemKind.Property), {detail:`${cn} property`}));
                const body = extractClassBody(t2, cn);
                if (body) { const mr = /\bfun\s+([a-zA-Z_]\w*)/g; let mm; while ((mm=mr.exec(body))!==null) items.push(Object.assign(new vscode.CompletionItem(mm[1], vscode.CompletionItemKind.Method), {detail:`${cn} method`})); }
                return items;
            }
        }

        // Keywords
        for (const kw of KEYWORDS) { const i = new vscode.CompletionItem(kw.label, vscode.CompletionItemKind.Keyword); i.detail = kw.detail; i.insertText = new vscode.SnippetString(kw.snippet); items.push(i); }
        for (const ok of OPERATOR_KEYWORDS) { const i = new vscode.CompletionItem(ok.label, vscode.CompletionItemKind.Operator); i.detail = ok.detail; if (ok.doc) i.documentation = new vscode.MarkdownString(ok.doc); items.push(i); }
        for (const c of ['true','false','null','this']) items.push(Object.assign(new vscode.CompletionItem(c, vscode.CompletionItemKind.Constant), {detail: c==='this'?'current instance':`literal ${c}`}));

        // Native functions
        for (const fn of definitions.functions) {
            const i = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
            const al = (fn.args||[]).map(argLabel);
            i.detail = `${fn.name} [${al.join(', ')}]`; if (fn.module) i.detail += ` (${fn.module})`;
            const dp = []; if (fn.doc) dp.push(fn.doc); if (fn.returns && fn.returns!=='null') dp.push(`**Returns:** \`${fn.returns}\``);
            if (dp.length) i.documentation = new vscode.MarkdownString(dp.join('\n\n'));
            const args = fn.args||[];
            i.insertText = args.length > 0
                ? new vscode.SnippetString(`${fn.name} [${args.map((a,idx)=>`\${${idx+1}:${typeof a==='string'?a:a.name}}`).join(', ')}]`)
                : new vscode.SnippetString(`${fn.name} []`);
            items.push(i);
        }

        // Native enums
        for (const e of definitions.enums) {
            const i = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Enum);
            i.detail = `enum ${e.name} (${e.members.length} members)`; if (e.module) i.detail += ` — ${e.module}`;
            i.documentation = new vscode.MarkdownString(`**Members:** ${e.members.map(m=>`\`${m.name}\`=${m.value}`).join(', ')}\n\nAccess: \`${e.name} :: MEMBER\``);
            items.push(i);
        }

        // Native constants
        for (const c of definitions.constants) {
            const i = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant);
            i.detail = `const ${c.name} = ${c.value}`; if (c.module) i.detail += ` (${c.module})`;
            items.push(i);
        }

        // Local definitions
        const text = document.getText();
        const seen = new Set([...definitions.functions.map(f=>f.name), ...definitions.enums.map(e=>e.name), ...definitions.constants.map(c=>c.name)]);
        let match;
        const funcR = /\bfun\s+([a-zA-Z_]\w*)/g;
        while ((match=funcR.exec(text))!==null) if (!seen.has(match[1])) { seen.add(match[1]); items.push(Object.assign(new vscode.CompletionItem(match[1], vscode.CompletionItemKind.Function), {detail:'local function'})); }
        const classR = /\bclass\s+([a-zA-Z_]\w*)/g;
        while ((match=classR.exec(text))!==null) if (!seen.has(match[1])) { seen.add(match[1]); items.push(Object.assign(new vscode.CompletionItem(match[1], vscode.CompletionItemKind.Class), {detail:'local class'})); }
        const enumR = /\benum\s+([a-zA-Z_]\w*)/g;
        while ((match=enumR.exec(text))!==null) if (!seen.has(match[1])) { seen.add(match[1]); items.push(Object.assign(new vscode.CompletionItem(match[1], vscode.CompletionItemKind.Enum), {detail:'local enum'})); }
        const constR = /\bconst\s+([a-zA-Z_]\w*)/g;
        while ((match=constR.exec(text))!==null) if (!seen.has(match[1])) { seen.add(match[1]); items.push(Object.assign(new vscode.CompletionItem(match[1], vscode.CompletionItemKind.Constant), {detail:'local constant'})); }

        return items;
    }
}

// --- Hover ---

class WarScriptHoverProvider {
    provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (!range) return null;
        const word = document.getText(range);

        const kwDocs = {
            'yield': '```warscript\nyield\nyield wait <seconds>\nyield until <condition>\n```\nPauses coroutine execution.',
            'as': 'Cast: `obj as ClassName`', 'is': 'Check: `obj is ClassName`',
            'import': '```warscript\nimport "path/to/file.ws"\n```',
            'const': '```warscript\nconst NAME = value\n```\nDeclares an immutable constant.',
            'enum': '```warscript\nenum Name\n    MEMBER\n    OTHER = 5\nend\n```\nAccess: `Name :: MEMBER`\nReverse: `Name :: name [value]`\nIterate: `loop v in Name :: values`',
        };
        if (kwDocs[word]) return new vscode.Hover(new vscode.MarkdownString(kwDocs[word]));

        // Native function
        const fn = definitions.functions.find(f => f.name === word);
        if (fn) {
            const sig = `fun ${fn.name} [${(fn.args||[]).map(argLabel).join(', ')}]`;
            const p = [`\`\`\`warscript\n${sig}\n\`\`\``]; if (fn.module) p.push(`*${fn.module}*`); if (fn.doc) p.push(fn.doc); if (fn.returns&&fn.returns!=='null') p.push(`**Returns:** \`${fn.returns}\``);
            return new vscode.Hover(new vscode.MarkdownString(p.join('\n\n')));
        }

        // Native enum
        const ed = definitions.enums.find(e => e.name === word);
        if (ed) {
            const ml = ed.members.map(m => `| \`${m.name}\` | ${m.value} |`).join('\n');
            const p = [`\`\`\`warscript\nenum ${ed.name}\n\`\`\``]; if (ed.module) p.push(`*${ed.module}*`);
            p.push(`| Member | Value |\n|--------|-------|\n${ml}`);
            p.push(`Access: \`${ed.name} :: MEMBER\`\nReverse: \`${ed.name} :: name [value]\``);
            return new vscode.Hover(new vscode.MarkdownString(p.join('\n\n')));
        }

        // Native const
        const cd = definitions.constants.find(c => c.name === word);
        if (cd) {
            const p = [`\`\`\`warscript\nconst ${cd.name} = ${cd.value}\n\`\`\``]; if (cd.module) p.push(`*${cd.module}*`); if (cd.type) p.push(`**Type:** \`${cd.type}\``);
            return new vscode.Hover(new vscode.MarkdownString(p.join('\n\n')));
        }

        // Local enum
        const text = document.getText();
        const leMatch = new RegExp(`\\benum\\s+${word}\\b([\\s\\S]*?)\\bend\\b`).exec(text);
        if (leMatch) {
            const members = []; const mr = /^\s*([A-Z_]\w*)(?:\s*=\s*(\d+))?/gm; let m, nv = 0;
            while ((m=mr.exec(leMatch[1]))!==null) { if (m[2]!==undefined) nv=parseInt(m[2]); members.push(`| \`${m[1]}\` | ${nv} |`); nv++; }
            const p = [`\`\`\`warscript\nenum ${word}\n\`\`\``]; if (members.length) p.push(`| Member | Value |\n|--------|-------|\n${members.join('\n')}`);
            return new vscode.Hover(new vscode.MarkdownString(p.join('\n\n')));
        }

        // Local const
        const lcMatch = new RegExp(`\\bconst\\s+${word}\\s*=\\s*(.+?)\\s*(?:\\n|$)`).exec(text);
        if (lcMatch) return new vscode.Hover(new vscode.MarkdownString(`\`\`\`warscript\nconst ${word} = ${lcMatch[1].trim()}\n\`\`\``));

        // Local class
        const lclMatch = new RegExp(`\\bclass\\s+${word}\\s*(?::\\s*(\\w+))?\\s*\\[([^\\]]*)\\]`).exec(text);
        if (lclMatch) {
            const inh = lclMatch[1] ? ` : ${lclMatch[1]}` : '';
            const props = lclMatch[2].split(',').map(s=>s.trim()).filter(Boolean);
            const p = [`\`\`\`warscript\nclass ${word}${inh} [${props.join(', ')}]\n\`\`\``];
            const body = extractClassBody(text, word);
            if (body) { const mns = []; const mr = /\bfun\s+([a-zA-Z_]\w*)\s*\[([^\]]*)\]/g; let mm; while ((mm=mr.exec(body))!==null) mns.push(`- \`${mm[1]} [${mm[2]}]\``); if (mns.length) p.push('**Methods:**\n'+mns.join('\n')); }
            return new vscode.Hover(new vscode.MarkdownString(p.join('\n\n')));
        }

        // Local function
        const lfMatch = new RegExp(`\\bfun\\s+${word}\\s*\\[([^\\]]*)\\]`).exec(text);
        if (lfMatch) return new vscode.Hover(new vscode.MarkdownString(`\`\`\`warscript\nfun ${word} [${lfMatch[1]}]\n\`\`\``));

        return null;
    }
}

// --- Signature help ---

class WarScriptSignatureHelpProvider {
    provideSignatureHelp(document, position) {
        const line = document.lineAt(position.line).text.substring(0, position.character);
        let bd = 0, bp = -1;
        for (let i = line.length-1; i >= 0; i--) { if (line[i]===']') bd++; else if (line[i]==='[') { if (bd===0){bp=i;break;} bd--; } }
        if (bp < 0) return null;
        const nm = line.substring(0, bp).trimEnd().match(/([a-zA-Z_]\w*)$/);
        if (!nm) return null;
        const fn = definitions.functions.find(f => f.name === nm[1]);
        let args = fn ? fn.args : null;
        if (!args) { const lm = new RegExp(`\\bfun\\s+${nm[1]}\\s*\\[([^\\]]*)\\]`).exec(document.getText()); if (lm) args = lm[1].split(',').map(s=>s.trim()).filter(Boolean); }
        if (!args || !args.length) return null;
        let ap = 0, d = 0;
        for (const ch of line.substring(bp+1)) { if ('[{('.includes(ch)) d++; else if (']})'.includes(ch)) d--; else if (ch===','&&d===0) ap++; }
        const al = args.map(argLabel);
        const si = new vscode.SignatureInformation(`${nm[1]} [${al.join(', ')}]`, fn?.doc||'');
        for (const l of al) si.parameters.push(new vscode.ParameterInformation(l));
        const sh = new vscode.SignatureHelp(); sh.signatures=[si]; sh.activeSignature=0; sh.activeParameter=Math.min(ap,al.length-1);
        return sh;
    }
}

// --- Semantic tokens ---

const semanticTokenEmitter = new vscode.EventEmitter();

class WarScriptSemanticTokensProvider {
    constructor() { this.onDidChangeSemanticTokens = semanticTokenEmitter.event; }
    provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(tokenLegend);
        const text = document.getText();
        const nf = new Set(definitions.functions.map(f=>f.name));
        const en = new Set(definitions.enums.map(e=>e.name));
        const cn = new Set(definitions.constants.map(c=>c.name));
        let m;
        const ler = /\benum\s+([a-zA-Z_]\w*)/g; while ((m=ler.exec(text))!==null) en.add(m[1]);
        const lcr = /\bconst\s+([a-zA-Z_]\w*)/g; while ((m=lcr.exec(text))!==null) cn.add(m[1]);
        const lf = new Set(); const dfr = /\bfun\s+([a-zA-Z_]\w*)/g; while ((m=dfr.exec(text))!==null) if (!nf.has(m[1])) lf.add(m[1]);
        const ir = /\b([a-zA-Z_]\w*)\b/g;
        while ((m=ir.exec(text))!==null) {
            const n=m[1], p=document.positionAt(m.index);
            let t=null;
            if (nf.has(n)) t='nativeFunction'; else if (en.has(n)) t='enumType'; else if (cn.has(n)) t='constName'; else if (lf.has(n)) t='function';
            if (t!==null) builder.push(p.line, p.character, n.length, TOKEN_TYPES.indexOf(t), 0);
        }
        return builder.build();
    }
}

// --- Document symbols ---

class WarScriptDocumentSymbolProvider {
    provideDocumentSymbols(document) {
        const symbols = [], lines = document.getText().split('\n');
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i], r = new vscode.Range(i,0,i,l.length);
            let m;
            if ((m=l.match(/\bclass\s+([a-zA-Z_]\w*)/))) symbols.push(new vscode.DocumentSymbol(m[1],'class',vscode.SymbolKind.Class,r,r));
            else if ((m=l.match(/\bfun\s+([a-zA-Z_]\w*)/))) symbols.push(new vscode.DocumentSymbol(m[1],'function',vscode.SymbolKind.Function,r,r));
            else if ((m=l.match(/\benum\s+([a-zA-Z_]\w*)/))) symbols.push(new vscode.DocumentSymbol(m[1],'enum',vscode.SymbolKind.Enum,r,r));
            else if ((m=l.match(/\bconst\s+([a-zA-Z_]\w*)/))) symbols.push(new vscode.DocumentSymbol(m[1],'constant',vscode.SymbolKind.Constant,r,r));
        }
        return symbols;
    }
}

// --- Go to definition ---

function getWorkspaceRoot() { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||null; }
function parseImports(text) { const r=[],rx=/\bimport\s+"([^"]+)"/g; let m; while ((m=rx.exec(text))!==null) r.push(m[1]); return r; }

function findDefInFile(fp, name) {
    try {
        const lines = fs.readFileSync(fp,'utf-8').split('\n');
        const pats = [/\bfun\s+/,/\bclass\s+/,/\benum\s+/,/\bconst\s+/].map(p=>new RegExp(p.source+name+'\\b'));
        for (let i=0;i<lines.length;i++) for (const p of pats) if (p.test(lines[i])) return {line:i,col:lines[i].indexOf(name)};
    } catch(e){}
    return null;
}

class WarScriptDefinitionProvider {
    provideDefinition(document, position) {
        const line = document.lineAt(position.line).text;
        const im = line.match(/\bimport\s+"([^"]+)"/);
        if (im) { const ps=line.indexOf('"')+1,pe=line.indexOf('"',ps); if (position.character>=ps&&position.character<=pe) { const r=getWorkspaceRoot(); if(r){const t=path.join(r,im[1]); if(fs.existsSync(t)) return new vscode.Location(vscode.Uri.file(t),new vscode.Position(0,0));} } }
        const wr = document.getWordRangeAtPosition(position,/[a-zA-Z_]\w*/); if (!wr) return null;
        const word = document.getText(wr);
        const kws = new Set(['if','elif','else','end','fun','class','return','loop','in','by','break','next','print','import','assert','raise','begin','rescue','ensure','and','or','not','new','as','is','true','false','null','this','yield','wait','until','const','enum']);
        if (kws.has(word)) return null;
        if (definitions.functions.some(f=>f.name===word)||definitions.enums.some(e=>e.name===word)||definitions.constants.some(c=>c.name===word)) return null;
        const root = getWorkspaceRoot(); if (!root) return null;
        const ct = document.getText(), cl = ct.split('\n');
        const pats = [/\bfun\s+/,/\bclass\s+/,/\benum\s+/,/\bconst\s+/].map(p=>new RegExp(p.source+word+'\\b'));
        for (let i=0;i<cl.length;i++) for (const p of pats) if (p.test(cl[i])) return new vscode.Location(document.uri,new vscode.Position(i,cl[i].indexOf(word)));
        for (const imp of parseImports(ct)) { const r=findDefInFile(path.join(root,imp),word); if (r) return new vscode.Location(vscode.Uri.file(path.join(root,imp)),new vscode.Position(r.line,Math.max(0,r.col))); }
        return null;
    }
}

function deactivate() { if (fileWatcher) fileWatcher.dispose(); }
module.exports = { activate, deactivate };
