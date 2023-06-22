import * as vscode from 'vscode';
import definitionsImport from './definitions.json';

interface Parameter {
    label: string;
    documentation: string;
}

interface FunctionSignature {
    kind?: number;
    parameters?: Parameter[];
    signature: string;
    documentation: string
}

interface GlobalMembers {
    [key: string]: FunctionSignature
}

interface DefinitionsObject {
    [key: string]: GlobalMembers
}

const definitions = definitionsImport as DefinitionsObject;

class Identifier {
    global?: string;
    identifier: string;
    signature?: FunctionSignature;

    constructor(_identifier: string, _global: string) {
        this.identifier = _identifier;
        this.global = (_global == '' ? undefined : _global);

        if (this.global !== undefined) {
            const luaGlobal = definitions[this.global];

            if (luaGlobal !== undefined) {
                const luaFunction = luaGlobal[this.identifier];

                if (luaFunction !== undefined) {
                    this.signature = luaFunction;
                }
            }
        } else {
            const luaGlobal = definitions['(none)'];
            const luaFunction = luaGlobal[this.identifier];

            if (luaFunction !== undefined) {
                this.signature = luaFunction;
            }
        }
    }
}

const charList = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.';

function isValid(str: string) {
    return charList.includes(str);
}

function buildMarkdownString(namespace: string | undefined, detail: string, docs: string) {
    const content = new vscode.MarkdownString('');

    if (namespace !== undefined) {
        content.appendMarkdown(`<h6>${namespace}</h6>`);
    }

    content.appendMarkdown(`<h4>${detail}</h4>`);
    content.appendMarkdown(`<hr>\n`);
    content.appendMarkdown(`<p>${docs}</p>`);

    content.supportHtml = true;

    return content;
}

function traceCompletionIdentifier(word: string, charLocation: number) {
    if (word.length > charLocation) {
        word = word.substring(0, charLocation);
    }

    let completedWord = "";

    for (let i = charLocation; i > 0; i--) {
        const currentChar = word.charAt(i);

        if (!isValid(currentChar)) {
            return completedWord;
        } else {
            completedWord = currentChar + completedWord;
        }
    }

    return word;
}

function traceHoverIdentifier(word: string, charLocation: number): Identifier | undefined {
    let completedWord = "";

    if (word.length > charLocation) {
        for (let i = charLocation; i < word.length; i++) {
            const currentChar = word.charAt(i);

            if (currentChar === '.' || currentChar === '(') {
                break;
            }

            if (isValid(currentChar)) {
                completedWord = completedWord + currentChar;
            }
        }
    }

    for (let i = charLocation - 1; i >= 0; i--) {
        const currentChar = word.charAt(i);

        if (!isValid(currentChar)) {
            console.log('INVAL', currentChar);

            break;
        }

        completedWord = currentChar + completedWord;
    }

    if (completedWord.length > 0) {
        if (completedWord.includes('.')) {
            const splitted = completedWord.split('.');

            return new Identifier(splitted[1], splitted[0]);
        } else {
            return new Identifier(completedWord, '');
        }
    }

    return undefined;
}

function traceSignatureCommas(line: string, charLocation: number): number {
    let commas = 0;
    let counter = 0;
    let captureCommas = true;

    line = line.substring(0, charLocation);

    for (let i = charLocation; i >= 0; i--) {
        const currentChar = line.charAt(i);

        if (currentChar === ',') {
            if (captureCommas) {
                commas++;
            }
        } else if (currentChar === ')') {
            counter++;

            captureCommas = false;
        } else if (currentChar === '(') {
            if (counter === 0) {
                return commas;
            } else {
                counter--;

                if (counter === 0) {
                    captureCommas = true;
                }
            }
        } else {
            if (currentChar !== ' ' && !isValid(currentChar)) {
                return commas;
            }
        }
    }

    return commas;
}

function traceSignatureIdentifier(line: string, charLocation: number): Identifier | undefined {
    let counter = 0;
    let captureIdentifier = false;
    let captureGlobal = false;
    let global = '';
    let identifier = '';

    line = line.substring(0, charLocation);

    for (let i = charLocation; i >= 0; i--) {
        const currentChar = line.charAt(i);

        if (captureIdentifier || captureGlobal) {
            if (currentChar === '.') {
                captureGlobal = true;
                captureIdentifier = false;
            } else {
                if (!isValid(currentChar)) {
                    return new Identifier(identifier, global);
                }

                if (captureIdentifier) {
                    identifier = currentChar + identifier;
                }

                if (captureGlobal) {
                    global = currentChar + global;
                }
            }
        } else {
            if (currentChar === ')') {
                counter++;
            } else if (currentChar === '(') {
                if (counter == 0) {
                    captureIdentifier = true;
                } else {
                    counter--;
                }
            }
        }
    }

    if (identifier.length > 0) {
        return new Identifier(identifier, global);
    }

    return undefined;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('xforce-lua-api-extension enabled');

    const goToDocsCommandHandler = vscode.commands.registerCommand('xforce.openDocs', () => {
        vscode.env.openExternal(vscode.Uri.parse('https://docs.xforce.menu'));
    });

    context.subscriptions.push(goToDocsCommandHandler);

    const completionItemProvider = vscode.languages.registerCompletionItemProvider('lua', {
        provideCompletionItems(document, position, token, context) {
            const items: vscode.CompletionItem[] = [];
            const word = document.getText(document.lineAt(position.line).range);
            let identifier = traceCompletionIdentifier(word, position.character);
            let globalIdentifier;

            if (identifier.includes('.')) {
                const splitted = identifier.split('.');

                if (splitted.length > 2) {
                    return items;
                } else {
                    globalIdentifier = splitted[0];
                    identifier = splitted[1];
                }
            }

            if (globalIdentifier !== undefined) {
                const luaGlobal: GlobalMembers = definitions[globalIdentifier];

                for (const label in luaGlobal) {
                    const luaFunction: FunctionSignature = luaGlobal[label];

                    if (luaFunction.kind !== undefined) {
                        const item: vscode.CompletionItem = new vscode.CompletionItem(label, luaFunction.kind - 1);

                        item.documentation = luaFunction.documentation;
                        item.detail = luaFunction.signature;

                        items.push(item);
                    }
                }
            } else {
                const luaGlobal: GlobalMembers = definitionsImport["(none)"];

                for (const label in luaGlobal) {
                    const luaFunction: FunctionSignature = luaGlobal[label];
                    const item = new vscode.CompletionItem(label, 8);

                    item.documentation = luaFunction.documentation;
                    item.detail = luaFunction.signature;

                    items.push(item);
                }
            }

            return {
                items
            };
        },
    }, '.');

    context.subscriptions.push(completionItemProvider);

    const hoverProvider = vscode.languages.registerHoverProvider('lua', {
        provideHover(document, position, token) {
            let hover;
            const line = document.getText(document.lineAt(position.line).range);
            const identifier = traceHoverIdentifier(line, position.character);

            if (identifier !== undefined) {
                if (identifier.signature !== undefined) {
                    hover = new vscode.Hover(buildMarkdownString(identifier.global, identifier.signature.signature, identifier.signature.documentation));
                }
            }

            return hover;
        }
    });

    context.subscriptions.push(hoverProvider);

    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider('lua', {
        provideSignatureHelp(document, position, token, context) {
            const signatureHelp = new vscode.SignatureHelp();
            const line = document.getText(document.lineAt(position.line).range);
            const identifier = traceSignatureIdentifier(line, position.character);

            if (identifier !== undefined) {
                if (identifier.signature !== undefined) {
                    const signature = identifier.signature;
                    const helpInformation = new vscode.SignatureInformation(signature.signature, signature.documentation);

                    if (signature.parameters !== undefined) {
                        for (const param of signature.parameters) {
                            helpInformation.parameters.push(new vscode.ParameterInformation(param.label, param.documentation));
                        }

                        helpInformation.activeParameter = traceSignatureCommas(line, position.character);
                    }

                    signatureHelp.signatures.push(helpInformation);

                    signatureHelp.activeSignature = 0;
                }
            }

            return signatureHelp;
        }
    }, '(', ',');

    context.subscriptions.push(signatureHelpProvider);
}