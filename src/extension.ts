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
            var luaGlobal = definitions[this.global];

            if (luaGlobal !== undefined) {
                var luaFunction = luaGlobal[this.identifier];

                if (luaFunction !== undefined) {
                    this.signature = luaFunction;
                }
            }
        } else {
            var luaGlobal = definitions['(none)'];
            var luaFunction = luaGlobal[this.identifier];

            if (luaFunction !== undefined) {
                this.signature = luaFunction;
            }
        }
    }
}

const charList: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.';

function isValid(str: string) {
    return charList.includes(str);
}

function buildMarkdownString(namespace: string | undefined, detail: string, docs: string) {
    var content = new vscode.MarkdownString('');

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

    var completedWord = "";

    for (var i = charLocation; i > 0; i--) {
        var currentChar = word.charAt(i);

        if (!isValid(currentChar)) {
            return completedWord;
        } else {
            completedWord = currentChar + completedWord;
        }
    }

    return word;
}

function traceHoverIdentifier(word: string, charLocation: number): Identifier | undefined {
    var completedWord = "";

    console.log(1)

    if (word.length > charLocation) {
        for (var i = charLocation; i < word.length; i++) {
            var currentChar = word.charAt(i);

            if (currentChar === '.' || currentChar === '(') {
                break;
            }

            if (isValid(currentChar)) {
                completedWord = completedWord + currentChar;
            }
        }
    }

    console.log(2)

    for (var i = charLocation - 1; i >= 0; i--) {
        var currentChar = word.charAt(i);

        if (!isValid(currentChar)) {
            console.log('INVAL', currentChar);

            break;
        }

        completedWord = currentChar + completedWord;
    }

    if (completedWord.length > 0) {
        console.log(completedWord)

        if (completedWord.includes('.')) {
            var splitted = completedWord.split('.');

            return new Identifier(splitted[1], splitted[0]);
        } else {
            return new Identifier(completedWord, '');
        }
    }

    return undefined;
}

function traceSignatureCommas(line: string, charLocation: number): number {
    var commas = 0;
    var counter = 0;
    var captureCommas = true;

    line = line.substring(0, charLocation);

    for (var i = charLocation; i >= 0; i--) {
        var currentChar = line.charAt(i);

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
    var counter = 0;
    var captureIdentifier = false;
    var captureGlobal = false;
    var global = '';
    var identifier = '';

    line = line.substring(0, charLocation);

    for (var i = charLocation; i >= 0; i--) {
        var currentChar = line.charAt(i);

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
    console.log('xf-lua-api-extension enabled');

    const completionItemProvider = vscode.languages.registerCompletionItemProvider('lua', {
        provideCompletionItems(document, position, token, context) {
            var items: vscode.CompletionItem[] = [];
            var word = document.getText(document.lineAt(position.line).range);
            var identifier = traceCompletionIdentifier(word, position.character);
            var hasNamespace = false;
            var namespace;

            if (identifier.includes('.')) {
                var splitted = identifier.split('.');

                if (splitted.length > 2) {
                    return items;
                } else {
                    hasNamespace = true;
                    namespace = splitted[0];
                    identifier = splitted[1];
                }
            }

            if (hasNamespace && namespace !== undefined) {
                var namespaceDefinitions: GlobalMembers = definitions[namespace];

                for (var label in namespaceDefinitions) {
                    var definition: FunctionSignature = namespaceDefinitions[label];

                    if (definition.kind !== undefined) {
                        var item: vscode.CompletionItem = new vscode.CompletionItem(label, definition.kind - 1);

                        item.documentation = definition.documentation;
                        item.detail = definition.signature;

                        items.push(item);
                    }
                }
            } else {
                var namespaceDefinitions: GlobalMembers = definitionsImport["(none)"];

                for (var label in namespaceDefinitions) {
                    var definition: FunctionSignature = namespaceDefinitions[label];
                    var item = new vscode.CompletionItem(label, 8);

                    item.documentation = definition.documentation;
                    item.detail = definition.signature;

                    items.push(item);
                }
            }

            return {
                items
            }
        },
    }, '.');

    context.subscriptions.push(completionItemProvider);

    const hoverProvider = vscode.languages.registerHoverProvider('lua', {
        provideHover(document, position, token) {
            var hover;
            var line = document.getText(document.lineAt(position.line).range);
            var identifier = traceHoverIdentifier(line, position.character);

            if (identifier !== undefined) {
                if (identifier.signature !== undefined) {
                    console.log(identifier)

                    hover = new vscode.Hover(buildMarkdownString(identifier.global, identifier.signature.signature, identifier.signature.documentation));
                }
            }

            return hover;
        }
    });

    context.subscriptions.push(hoverProvider);

    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider('lua', {
        provideSignatureHelp(document, position, token, context) {
            var signatureHelp = new vscode.SignatureHelp();
            var line = document.getText(document.lineAt(position.line).range);
            var identifier = traceSignatureIdentifier(line, position.character);

            if (identifier !== undefined) {
                if (identifier.signature !== undefined) {
                    var signature = identifier.signature;
                    var helpInformation = new vscode.SignatureInformation(signature.signature, signature.documentation);

                    if (signature.parameters !== undefined) {
                        for (var param of signature.parameters) {
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