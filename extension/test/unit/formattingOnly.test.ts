// Whether two versions of a file have the same syntax tree (ADR 0048), under
// plain Node against the real grammars. Each grammar has to show that a file
// reformatted evenly is formatting only, and that whitespace which carries
// meaning in its language is not: a grammar ships only with these tests.

import * as assert from "assert";
import { FormattingComparer } from "../../src/formattingOnly";
import {
  grammarOfPath,
  grammarWasms,
  runtimeWasm,
  type GrammarName,
} from "../../src/formattingGrammars";
import grammars from "../../src/grammars.json";
import { wasmFromNodeModules } from "./treeSitterFiles";

interface Pair {
  /** What differs between the two versions. */
  what: string;
  base: string;
  head: string;
}

interface Language {
  grammar: GrammarName;
  /** Versions that differ in formatting only, as a formatter's run would leave them. */
  formatted: Pair[];
  /** Versions that differ in something that is not formatting, or in whitespace that carries meaning. */
  real: Pair[];
}

const languages: Language[] = [
  {
    grammar: "typescript",
    formatted: [
      {
        what: "a function wrapped and indented",
        base: "const a = {x:1,y:2};\nfunction f(a:number,b:string){return a+b;}\n",
        head: "const a = { x: 1, y: 2 };\nfunction f(\n    a: number,\n    b: string\n) {\n    return a + b;\n}\n",
      },
    ],
    real: [
      {
        what: "a line break after return",
        base: "function f(x: number) { return x; }\n",
        head: "function f(x: number) {\n  return\n  x;\n}\n",
      },
      {
        what: "whitespace in a template literal",
        base: "const s = `a b`;\n",
        head: "const s = `a  b`;\n",
      },
      {
        what: "a blank line in a template literal",
        base: "const s = `a\nb`;\n",
        head: "const s = `a\n\nb`;\n",
      },
      {
        what: "whitespace in a string",
        base: 'const s = "a b";\n',
        head: 'const s = "ab";\n',
      },
      {
        what: "a comment",
        base: "// one\nconst a = 1;\n",
        head: "// two\nconst a = 1;\n",
      },
      {
        what: "the quote style",
        base: 'const a = "x";\n',
        head: "const a = 'x';\n",
      },
      {
        what: "a trailing comma",
        base: "const a = [1, 2];\n",
        head: "const a = [1, 2,];\n",
      },
      {
        what: "a regular expression",
        base: "const r = /a b/;\n",
        head: "const r = /a  b/;\n",
      },
    ],
  },
  {
    grammar: "tsx",
    formatted: [
      {
        what: "the attributes of an element wrapped",
        base: 'const a = <Foo a="1" b={2} c={() => 3} />;\n',
        head: 'const a = <Foo\n  a="1"\n  b={2}\n  c={() => 3}\n/>;\n',
      },
    ],
    real: [
      {
        what: "text in markup",
        base: "const a = <p>a b</p>;\n",
        head: "const a = <p>a  b</p>;\n",
      },
      {
        what: "a space between two elements",
        base: "const a = <p><b>a</b> <i>b</i></p>;\n",
        head: "const a = <p><b>a</b><i>b</i></p>;\n",
      },
      {
        what: "a line break between two elements",
        base: "const a = <p><b>a</b> <i>b</i></p>;\n",
        head: "const a = <p><b>a</b>\n<i>b</i></p>;\n",
      },
      {
        what: "a space before an expression in markup",
        base: "const a = <p>{x} {y}</p>;\n",
        head: "const a = <p>{x}{y}</p>;\n",
      },
    ],
  },
  {
    grammar: "javascript",
    formatted: [
      {
        what: "an object and a call wrapped",
        base: "const o = {a:1,b:[1,2,3]};\nfoo(o.a,o.b,function(){return 1;});\n",
        head: "const o = {\n  a: 1,\n  b: [1, 2, 3]\n};\nfoo(\n  o.a,\n  o.b,\n  function () {\n    return 1;\n  }\n);\n",
      },
    ],
    real: [
      {
        what: "a line break after return",
        base: "function f(x) { return x }\n",
        head: "function f(x) {\n  return\n  x\n}\n",
      },
      {
        what: "a line break before a postfix operator",
        base: "let a = 1, b = 2;\na\n++b\n",
        head: "let a = 1, b = 2;\na ++\nb\n",
      },
      {
        what: "whitespace in a template literal",
        base: "const s = `x  y`;\n",
        head: "const s = `x y`;\n",
      },
      {
        what: "an added blank line in a template literal",
        base: "const s = `a\n  b`;\n",
        head: "const s = `a\n\n  b`;\n",
      },
      {
        what: "line endings in a multi-line template literal only",
        base: "const s = `a\r\nb`;\nconst t = 1;\n",
        head: "const s = `a\nb`;\nconst t = 1;\n",
      },
    ],
  },
  {
    grammar: "python",
    formatted: [
      {
        what: "the whole file indented with 4 spaces instead of 2",
        base: "def f(x):\n  if x:\n    return [1,\n            2]\n  return 2\n\nclass A:\n  def g(self):\n    pass\n",
        head: "def f(x):\n    if x:\n        return [1,\n                2]\n    return 2\n\nclass A:\n    def g(self):\n        pass\n",
      },
      {
        what: "a call wrapped in parentheses",
        base: "x = foo(1, 2, 3)\n",
        head: "x = foo(\n    1,\n    2,\n    3\n)\n",
      },
    ],
    real: [
      {
        what: "a statement moved out of a block",
        base: "def f(x):\n    if x:\n        a = 1\n        b = 2\n",
        head: "def f(x):\n    if x:\n        a = 1\n    b = 2\n",
      },
      {
        what: "a statement moved into a block",
        base: "if x:\n    a = 1\nb = 2\n",
        head: "if x:\n    a = 1\n    b = 2\n",
      },
      {
        what: "the indentation of an else",
        base: "if x:\n    if y:\n        a = 1\n    else:\n        a = 2\n",
        head: "if x:\n    if y:\n        a = 1\nelse:\n    a = 2\n",
      },
      {
        what: "whitespace in a string",
        base: 's = "a b"\n',
        head: 's = "ab"\n',
      },
      {
        what: "whitespace in a docstring",
        base: 'def f():\n    """Say  hi.\n\n    Bye.\n    """\n',
        head: 'def f():\n    """Say hi.\n    Bye.\n    """\n',
      },
      {
        what: "a string of only spaces",
        base: 's = """   """\n',
        head: 's = """    """\n',
      },
      {
        what: "a multi-line string of only whitespace",
        base: 's = """\n   \n"""\n',
        head: 's = """\n\n"""\n',
      },
      {
        what: "a backslash continuation",
        base: "x = 1 + \\\n    2\n",
        head: "x = 1 + 2\n",
      },
    ],
  },
  {
    grammar: "go",
    formatted: [
      {
        what: "tabs for spaces and a call wrapped",
        base: "package main\n\nfunc main() {\n  foo(1, 2)\n  if x {\n    bar()\n  }\n}\n",
        head: "package main\n\nfunc main() {\n\tfoo(1,\n\t\t2)\n\tif x {\n\t\tbar()\n\t}\n}\n",
      },
    ],
    real: [
      {
        what: "a line break after return",
        base: "package main\n\nfunc f() int {\n\treturn 1\n}\n",
        head: "package main\n\nfunc f() int {\n\treturn\n\t1\n}\n",
      },
      {
        what: "whitespace in a raw string",
        base: "package main\n\nvar s = `a b`\n",
        head: "package main\n\nvar s = `a  b`\n",
      },
      {
        what: "a blank line in a raw string",
        base: "package main\n\nvar s = `a\nb`\n",
        head: "package main\n\nvar s = `a\n\nb`\n",
      },
      {
        what: "a comment",
        base: "package main\n\n// one\nvar a = 1\n",
        head: "package main\n\n// two\nvar a = 1\n",
      },
      {
        what: "whitespace in a string",
        base: 'package main\n\nvar s = "a b"\n',
        head: 'package main\n\nvar s = "ab"\n',
      },
    ],
  },
  {
    grammar: "rust",
    formatted: [
      {
        what: "a function wrapped and indented",
        base: "fn f(a:i32,b:i32)->i32{let c=a+b;c*2}\n",
        head: "fn f(a: i32, b: i32) -> i32 {\n    let c = a + b;\n    c * 2\n}\n",
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: 'fn f() { let s = "a b"; }\n',
        head: 'fn f() { let s = "a  b"; }\n',
      },
      {
        what: "a blank line in a multi-line string",
        base: 'fn f() { let s = "a\nb"; }\n',
        head: 'fn f() { let s = "a\n\nb"; }\n',
      },
      {
        what: "whitespace in a raw string",
        base: 'fn f() { let s = r#"a b"#; }\n',
        head: 'fn f() { let s = r#"a  b"#; }\n',
      },
      {
        what: "a string of only whitespace",
        base: 'fn f() { let s = " "; }\n',
        head: 'fn f() { let s = "  "; }\n',
      },
      {
        what: "a doc comment",
        base: "/// one\nfn f() {}\n",
        head: "/// two\nfn f() {}\n",
      },
      {
        what: "a trailing comma",
        base: "fn f() { g(1, 2); }\n",
        head: "fn f() { g(1, 2,); }\n",
      },
    ],
  },
  {
    grammar: "java",
    formatted: [
      {
        what: "a method wrapped and indented",
        base: "class A{int f(int a,int b){return a+b;}}\n",
        head: "class A {\n    int f(\n        int a,\n        int b\n    ) {\n        return a + b;\n    }\n}\n",
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: 'class A { String s = "a b"; }\n',
        head: 'class A { String s = "ab"; }\n',
      },
      {
        what: "whitespace in a text block",
        base: 'class A { String s = """\n    a b\n    """; }\n',
        head: 'class A { String s = """\n    a  b\n    """; }\n',
      },
      {
        what: "indentation in a text block",
        base: 'class A { String s = """\n    a\n      b\n    """; }\n',
        head: 'class A { String s = """\n    a\n    b\n    """; }\n',
      },
      {
        what: "a comment",
        base: "// one\nclass A {}\n",
        head: "// two\nclass A {}\n",
      },
    ],
  },
  {
    grammar: "c",
    formatted: [
      {
        what: "a function wrapped and indented",
        base: "int f(int a,int b){if(a){return a;}return b;}\n",
        head: "int f(int a, int b)\n{\n\tif (a) {\n\t\treturn a;\n\t}\n\treturn b;\n}\n",
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: 'const char *s = "a b";\n',
        head: 'const char *s = "a  b";\n',
      },
      {
        what: "whitespace in a macro's body",
        base: "#define A 1 + 2\n",
        head: "#define A 1  +  2\n",
      },
      {
        what: "a comment",
        base: "/* one */\nint a;\n",
        head: "/* two */\nint a;\n",
      },
      {
        what: "a line continuation in a macro",
        base: "#define A \\\n  1\nint a;\n",
        head: "#define A 1\nint a;\n",
      },
    ],
  },
  {
    grammar: "cpp",
    formatted: [
      {
        what: "a class wrapped and indented",
        base: "class A{public:int f(int a){return a;}};\n",
        head: "class A {\npublic:\n    int f(int a) {\n        return a;\n    }\n};\n",
      },
    ],
    real: [
      {
        what: "whitespace in a raw string",
        base: 'auto s = R"(a b)";\n',
        head: 'auto s = R"(a  b)";\n',
      },
      {
        what: "whitespace in a string",
        base: 'auto s = "a b";\n',
        head: 'auto s = "ab";\n',
      },
      {
        what: "a comment",
        base: "// one\nint a;\n",
        head: "// two\nint a;\n",
      },
    ],
  },
  {
    grammar: "csharp",
    formatted: [
      {
        what: "a method wrapped and indented",
        base: "class A{int F(int a,int b){return a+b;}}\n",
        head: "class A\n{\n    int F(\n        int a,\n        int b)\n    {\n        return a + b;\n    }\n}\n",
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: 'class A { string s = "a b"; }\n',
        head: 'class A { string s = "ab"; }\n',
      },
      {
        what: "whitespace in a verbatim string",
        base: 'class A { string s = @"a\nb"; }\n',
        head: 'class A { string s = @"a\n\nb"; }\n',
      },
      {
        what: "whitespace in an interpolated string",
        base: 'class A { string s = $"{x} y"; }\n',
        head: 'class A { string s = $"{x}  y"; }\n',
      },
      {
        what: "whitespace in a raw string literal",
        base: 'class A { string s = """\n  a b\n  """; }\n',
        head: 'class A { string s = """\n  a  b\n  """; }\n',
      },
      {
        what: "a comment",
        base: "// one\nclass A {}\n",
        head: "// two\nclass A {}\n",
      },
    ],
  },
  {
    grammar: "ruby",
    formatted: [
      {
        what: "a method wrapped and indented",
        base: "def f(a,b)\nif a\nb\nend\nend\n",
        head: "def f(a, b)\n  if a\n    b\n  end\nend\n",
      },
    ],
    real: [
      {
        what: "whitespace in a heredoc",
        base: "x = <<~EOS\n  a b\nEOS\n",
        head: "x = <<~EOS\n  a  b\nEOS\n",
      },
      {
        what: "a blank line in a heredoc",
        base: "x = <<~EOS\n  a\n  b\nEOS\n",
        head: "x = <<~EOS\n  a\n\n  b\nEOS\n",
      },
      {
        what: "trailing spaces in a heredoc",
        base: "x = <<~EOS\n  a\nEOS\n",
        head: "x = <<~EOS\n  a  \nEOS\n",
      },
      {
        what: "whitespace in a string",
        base: 'x = "a b"\n',
        head: 'x = "ab"\n',
      },
      {
        what: "a line break after return",
        base: "def f\n  return 1\nend\n",
        head: "def f\n  return\n  1\nend\n",
      },
      {
        what: "a line break before a minus",
        base: "x = a -1\n",
        head: "x = a\n-1\n",
      },
      {
        what: "a comment",
        base: "# one\nx = 1\n",
        head: "# two\nx = 1\n",
      },
    ],
  },
  {
    grammar: "bash",
    formatted: [
      {
        what: "a function and a loop indented",
        base: 'f() {\nif [ -n "$1" ]; then\necho "$1"\nfi\nfor i in 1 2; do\necho $i\ndone\n}\n',
        head: 'f() {\n    if [ -n "$1" ]; then\n        echo "$1"\n    fi\n    for i in 1 2; do\n        echo $i\n    done\n}\n',
      },
    ],
    real: [
      {
        what: "whitespace in a heredoc",
        base: "cat <<EOF\na b\nEOF\n",
        head: "cat <<EOF\na  b\nEOF\n",
      },
      {
        what: "trailing spaces in a heredoc",
        base: "cat <<EOF\na\nEOF\n",
        head: "cat <<EOF\na  \nEOF\n",
      },
      {
        what: "a blank line in a heredoc",
        base: "cat <<EOF\na\nb\nEOF\n",
        head: "cat <<EOF\na\n\nb\nEOF\n",
      },
      {
        what: "line endings in a heredoc only",
        base: "cat <<EOF\r\na\r\nb\r\nEOF\r\necho x\r\n",
        head: "cat <<EOF\na\nb\nEOF\necho x\r\n",
      },
      {
        what: "whitespace in a string",
        base: 'echo "a b"\n',
        head: 'echo "a  b"\n',
      },
      {
        what: "whitespace in a single-quoted string",
        base: "echo 'a b'\n",
        head: "echo 'ab'\n",
      },
      {
        what: "a line continuation",
        base: "echo a \\\n  b\n",
        head: "echo a b\n",
      },
      {
        what: "a comment",
        base: "# one\necho a\n",
        head: "# two\necho a\n",
      },
    ],
  },
  {
    grammar: "json",
    formatted: [
      {
        what: "compact text pretty-printed",
        base: '{"a":1,"b":[1,2,{"c":null}],"d":"x y"}\n',
        head: '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "d": "x y"\n}\n',
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: '{"a": "a b"}\n',
        head: '{"a": "ab"}\n',
      },
      {
        what: "whitespace in a key",
        base: '{"a b": 1}\n',
        head: '{"a  b": 1}\n',
      },
      {
        what: "a value",
        base: '{"a": 1}\n',
        head: '{"a": 2}\n',
      },
      {
        what: "a comment",
        base: '{"a": 1}\n',
        head: '{"a": 1} // x\n',
      },
    ],
  },
  {
    grammar: "yaml",
    formatted: [
      {
        what: "the whole file indented with 4 spaces instead of 2",
        base: "a:\n  b: 1\n  c:\n    - x\n    - y\nd: 2\n",
        head: "a:\n    b: 1\n    c:\n        - x\n        - y\nd: 2\n",
      },
    ],
    real: [
      {
        what: "a block scalar indented further",
        base: "a: |\n  one\n  two\nb: 1\n",
        head: "a: |\n    one\n    two\nb: 1\n",
      },
      {
        what: "a blank line in a block scalar",
        base: "a: |\n  one\n  two\n",
        head: "a: |\n  one\n\n  two\n",
      },
      {
        what: "a key moved out of a mapping",
        base: "a:\n  b: 1\n  c: 2\n",
        head: "a:\n  b: 1\nc: 2\n",
      },
      {
        what: "a key moved into a mapping",
        base: "a:\n  b: 1\nc: 2\n",
        head: "a:\n  b: 1\n  c: 2\n",
      },
      {
        what: "whitespace in a quoted string",
        base: 'a: "x y"\n',
        head: 'a: "x  y"\n',
      },
      {
        what: "a plain scalar folded over lines",
        base: "a: x y\n",
        head: "a: x\n  y\n",
      },
      {
        what: "a comment",
        base: "# one\na: 1\n",
        head: "# two\na: 1\n",
      },
    ],
  },
  {
    grammar: "css",
    formatted: [
      {
        what: "a rule expanded",
        base: "a{color:red;margin:0 auto}b>c{x:y}\n",
        head: "a {\n  color: red;\n  margin: 0 auto\n}\nb > c {\n  x: y\n}\n",
      },
    ],
    real: [
      {
        what: "whitespace in a string",
        base: 'a { content: "a b"; }\n',
        head: 'a { content: "a  b"; }\n',
      },
      {
        what: "a descendant selector joined to a pseudo-class",
        base: "a :hover { color: red; }\n",
        head: "a:hover { color: red; }\n",
      },
      {
        what: "a space in a value",
        base: "a { margin: 0 -1px; }\n",
        head: "a { margin: 0 - 1px; }\n",
      },
      {
        what: "a comment",
        base: "/* one */\na { color: red; }\n",
        head: "/* two */\na { color: red; }\n",
      },
    ],
  },
  {
    grammar: "kotlin",
    formatted: [
      {
        what: "a function indented, its line breaks kept",
        base: "fun f(a: Int, b: Int): Int {\nval c = a + b\nreturn c\n}\n",
        head: "fun f(a: Int, b: Int): Int {\n    val c = a + b\n    return c\n}\n",
      },
    ],
    real: [
      {
        what: "a line break before a plus",
        base: "val x = 1 + 2\n",
        head: "val x = 1\n+ 2\n",
      },
      {
        what: "whitespace in a string",
        base: 'val s = "a b"\n',
        head: 'val s = "ab"\n',
      },
      {
        what: "whitespace in a raw string",
        base: 'val s = """a b"""\n',
        head: 'val s = """a  b"""\n',
      },
      {
        what: "a blank line in a raw string",
        base: 'val s = """a\nb"""\n',
        head: 'val s = """a\n\nb"""\n',
      },
      {
        what: "a comment",
        base: "// one\nval a = 1\n",
        head: "// two\nval a = 1\n",
      },
    ],
  },
];

/**
 * Whitespace that a grammar doesn't keep in a leaf, or a line break it reads
 * as a space: each of these changes what the file means, and the first
 * grammars in this list parsed them to the same tree.
 */
const lenientGrammars: [GrammarName, string, string, string][] = [
  [
    "javascript",
    "a line break after throw",
    "function f() { throw x; }\n",
    "function f() { throw\nx; }\n",
  ],
  [
    "javascript",
    "a line break after async",
    "async function f() {}\n",
    "async\nfunction f() {}\n",
  ],
  [
    "javascript",
    "a line break after break",
    "a: for (;;) { break a; }\n",
    "a: for (;;) { break\na; }\n",
  ],
  [
    "javascript",
    "a line break after yield",
    "function* f() { yield 1; }\n",
    "function* f() { yield\n1; }\n",
  ],
  [
    "javascript",
    "a space between template substitutions",
    "x = `${a} ${b}`;\n",
    "x = `${a}${b}`;\n",
  ],
  [
    "javascript",
    "a template literal of one space",
    "x = ` `;\n",
    "x = `  `;\n",
  ],
  ["javascript", "a string of one space", 'x = " ";\n', 'x = "  ";\n'],
  [
    "javascript",
    "a regular expression of one space",
    "x = / /;\n",
    "x = /  /;\n",
  ],
  [
    "javascript",
    "a space in a character class",
    "x = /[ ]/;\n",
    "x = /[  ]/;\n",
  ],
  [
    "typescript",
    "a line break after abstract",
    "abstract class A {}\n",
    "abstract\nclass A {}\n",
  ],
  [
    "typescript",
    "a line break after type",
    "type A = number;\n",
    "type\nA = number;\n",
  ],
  [
    "typescript",
    "a line break after declare",
    "declare const a: number;\n",
    "declare\nconst a: number;\n",
  ],
  [
    "typescript",
    "a space between template type substitutions",
    "type A = `${B} ${C}`;\n",
    "type A = `${B}${C}`;\n",
  ],
  [
    "go",
    "a line break before a minus",
    "package p\n\nfunc f() {\n\tx := 1 - 2\n\t_ = x\n}\n",
    "package p\n\nfunc f() {\n\tx := 1\n\t- 2\n\t_ = x\n}\n",
  ],
  [
    "go",
    "a string of one space",
    'package p\n\nvar s = " "\n',
    'package p\n\nvar s = "  "\n',
  ],
  [
    "go",
    "a raw string of one space",
    "package p\n\nvar s = ` `\n",
    "package p\n\nvar s = `  `\n",
  ],
  [
    "go",
    "a rune of a space for a tab",
    "package p\n\nvar r = ' '\n",
    "package p\n\nvar r = '\t'\n",
  ],
  [
    "python",
    "a space between f-string substitutions",
    'x = f"{a} {b}"\n',
    'x = f"{a}{b}"\n',
  ],
  ["python", "a string of one space", 's = " "\n', 's = "  "\n'],
  ["ruby", "a string of one space", 'x = " "\n', 'x = "  "\n'],
  [
    "ruby",
    "a space between interpolations",
    'x = "#{a} #{b}"\n',
    'x = "#{a}#{b}"\n',
  ],
  [
    "ruby",
    "a heredoc of one space",
    "x = <<~EOS\n  \nEOS\n",
    "x = <<~EOS\n\nEOS\n",
  ],
  ["ruby", "a space in a word list", "x = %w(a b)\n", "x = %w(ab)\n"],
  ["ruby", "a space in a %q string", "x = %q( )\n", "x = %q(  )\n"],
  ["ruby", "a regular expression of one space", "x = / /\n", "x = /  /\n"],
  [
    "ruby",
    "a space after a command's name and a minus",
    "puts -1\n",
    "puts - 1\n",
  ],
  [
    "ruby",
    "a space after a command's name and a bracket",
    "foo [1]\n",
    "foo[1]\n",
  ],
  [
    "ruby",
    "a space after a command's name and a parenthesis",
    "puts (1)+2\n",
    "puts(1)+2\n",
  ],
  ["ruby", "a character literal", "x = c ?b : d\n", "x = c ? b : d\n"],
  ["ruby", "a splat", "foo *a\n", "foo * a\n"],
  ["ruby", "a block argument", "foo &a\n", "foo & a\n"],
  ["bash", "a string of one space", 'echo " "\n', 'echo "  "\n'],
  ["bash", "a single-quoted string of one space", "echo ' '\n", "echo '  '\n"],
  [
    "bash",
    "a heredoc of one space",
    "cat <<EOF\n \nEOF\n",
    "cat <<EOF\n\nEOF\n",
  ],
  ["bash", "a space in a default value", "echo ${a:- b}\n", "echo ${a:-b}\n"],
  ["bash", "a space in a substitution", "echo ${a/b/ c}\n", "echo ${a/b/c}\n"],
  [
    "bash",
    "a space after an assignment's equals sign",
    "VAR=1 cmd\n",
    "VAR= 1 cmd\n",
  ],
  [
    "bash",
    "a space between expansions in a string",
    'echo "$a $b"\n',
    'echo "$a$b"\n',
  ],
  ["bash", "a space inside the test brackets", "[ a ]\n", "[a ]\n"],
  ["bash", "a line break for an &&", "a\nb\n", "a && b\n"],
  [
    "java",
    "a string of one space",
    'class A { String s = " "; }\n',
    'class A { String s = "  "; }\n',
  ],
  [
    "java",
    "a char of a space for a tab",
    "class A { char c = ' '; }\n",
    "class A { char c = '\t'; }\n",
  ],
  [
    "c",
    "a string of one space",
    'const char *s = " ";\n',
    'const char *s = "  ";\n',
  ],
  ["c", "a char of a space for a tab", "char c = ' ';\n", "char c = '\t';\n"],
  [
    "cpp",
    "a raw string of one space",
    'auto s = R"( )";\n',
    'auto s = R"(  )";\n',
  ],
  [
    "csharp",
    "a string of one space",
    'class A { string s = " "; }\n',
    'class A { string s = "  "; }\n',
  ],
  [
    "csharp",
    "a space between interpolations",
    'class A { string s = $"{a} {b}"; }\n',
    'class A { string s = $"{a}{b}"; }\n',
  ],
  [
    "csharp",
    "a verbatim string of one space",
    'class A { string s = @" "; }\n',
    'class A { string s = @"  "; }\n',
  ],
  [
    "csharp",
    "a char of a space for a tab",
    "class A { char c = ' '; }\n",
    "class A { char c = '\t'; }\n",
  ],
  ["json", "a string of one space", '{"a": " "}\n', '{"a": "  "}\n'],
  ["json", "a key of one space", '{" ": 1}\n', '{"  ": 1}\n'],
  ["yaml", "spaces in a plain scalar", "a: x  y\n", "a: x y\n"],
  ["yaml", "a single-quoted scalar of one space", "a: ' '\n", "a: '  '\n"],
  ["yaml", "a double-quoted scalar of one space", 'a: " "\n', 'a: "  "\n'],
  [
    "yaml",
    "a blank line in a folded scalar",
    "a: >\n  x\n  y\n",
    "a: >\n  x\n\n  y\n",
  ],
  ["yaml", "spaces in a key", "a b: 1\n", "a  b: 1\n"],
  [
    "yaml",
    "trailing spaces at the end of a kept block scalar",
    "a: |+\n  x\n     \nb: 1\n",
    "a: |+\n  x\n\nb: 1\n",
  ],
  [
    "yaml",
    "a blank line at the end of a kept block scalar",
    "a: |+\n  x\n\n\nb: 1\n",
    "a: |+\n  x\n\nb: 1\n",
  ],
  [
    "css",
    "a string of one space",
    'a { content: " "; }\n',
    'a { content: "  "; }\n',
  ],
  [
    "css",
    "a space after a plus in calc",
    "a { width: calc(1px + 2px); }\n",
    "a { width: calc(1px +2px); }\n",
  ],
  [
    "css",
    "no space around a plus in calc",
    "a { width: calc(1px + 2px); }\n",
    "a { width: calc(1px+2px); }\n",
  ],
  [
    "css",
    "a descendant selector joined to a class",
    "a .b { x: y; }\n",
    "a.b { x: y; }\n",
  ],
  [
    "css",
    "a space in an attribute value",
    'a[b="x y"] { x: y; }\n',
    'a[b="x  y"] { x: y; }\n',
  ],
  ["kotlin", "a string of one space", 'val s = " "\n', 'val s = "  "\n'],
  [
    "kotlin",
    "a raw string of one space",
    'val s = """ """\n',
    'val s = """  """\n',
  ],
  [
    "kotlin",
    "a space between string templates",
    'val s = "$a $b"\n',
    'val s = "$a$b"\n',
  ],
  [
    "kotlin",
    "a call turned into a parenthesis on a new line",
    "fun f() { val a = b (c) }\n",
    "fun f() { val a = b\n(c) }\n",
  ],
  [
    "kotlin",
    "a line break after return",
    "fun f(): Int { return 1 }\n",
    "fun f(): Int { return\n1 }\n",
  ],
  ["kotlin", "a char of a space for a tab", "val c = ' '\n", "val c = '\t'\n"],
  [
    "rust",
    "a char of a space for a tab",
    "fn f() { let c = ' '; }\n",
    "fn f() { let c = '\t'; }\n",
  ],
  [
    "rust",
    "a byte string of one space",
    'fn f() { let s = b" "; }\n',
    'fn f() { let s = b"  "; }\n',
  ],
  [
    "rust",
    "a space between macro tokens",
    "fn f() { m!(a b); }\n",
    "fn f() { m!(ab); }\n",
  ],
];

/**
 * Changes that sit outside the whitespace between tokens, or that a grammar
 * takes for formatting: a pragma that counts for the line after it, a line a
 * directive has to start, an indentation Python refuses, a shebang that
 * counts only on the first line. Found by review, each of them marked before
 * the checks that now stop them.
 */
const moved: [GrammarName, string, string, string][] = [
  [
    "typescript",
    "a blank line after // @ts-ignore",
    "// @ts-ignore\nconst a: number = 'x';\n",
    "// @ts-ignore\n\nconst a: number = 'x';\n",
  ],
  [
    "typescript",
    "a blank line after // @ts-expect-error",
    "// @ts-expect-error\nconst a: number = 'x';\n",
    "// @ts-expect-error\n\nconst a: number = 'x';\n",
  ],
  [
    "javascript",
    "a blank line after an eslint pragma",
    "// eslint-disable-next-line no-eval\neval(x);\n",
    "// eslint-disable-next-line no-eval\n\neval(x);\n",
  ],
  [
    "javascript",
    "a trailing pragma moved to its own line",
    "eval(x); // eslint-disable-line\n",
    "eval(x);\n// eslint-disable-line\n",
  ],
  [
    "python",
    "a trailing noqa moved to its own line",
    "import os  # noqa\n",
    "import os\n# noqa\n",
  ],
  [
    "python",
    "a trailing type: ignore moved to its own line",
    "x: int = 'a'  # type: ignore\n",
    "x: int = 'a'\n# type: ignore\n",
  ],
  [
    "c",
    "a trailing NOLINT moved to its own line",
    "int a; // NOLINT\n",
    "int a;\n// NOLINT\n",
  ],
  [
    "go",
    "the blank line after a build constraint",
    "//go:build linux\n\npackage p\n",
    "//go:build linux\npackage p\n",
  ],
  [
    "go",
    "a blank line between a cgo preamble and its import",
    'package p\n/*\n#include <a.h>\n*/\nimport "C"\n',
    'package p\n/*\n#include <a.h>\n*/\n\nimport "C"\n',
  ],
  [
    "go",
    "a blank line between a doc comment and its function",
    "package p\n\n// Foo does x.\nfunc Foo() {}\n",
    "package p\n\n// Foo does x.\n\nfunc Foo() {}\n",
  ],
  [
    "java",
    "a blank line between a doc comment and its class",
    "/** Doc. */\nclass A {}\n",
    "/** Doc. */\n\nclass A {}\n",
  ],
  [
    "python",
    "a dedent to a level no block has, for an else",
    "if a:\n    x\nelse:\n    y\n",
    "if a:\n    x\n  else:\n    y\n",
  ],
  [
    "python",
    "a dedent to a level no block has",
    "if a:\n    x\ny\n",
    "if a:\n    x\n  y\n",
  ],
  [
    "python",
    "a dedent that lands between two levels",
    "def f():\n    if a:\n        x\n    y\n",
    "def f():\n    if a:\n        x\n      y\n",
  ],
  [
    "python",
    "a tab for four spaces in a block",
    "if x:\n    a = 1\n    b = 2\n",
    "if x:\n    a = 1\n\tb = 2\n",
  ],
  [
    "python",
    "spaces for a tab in a block",
    "if x:\n\ta = 1\n\tb = 2\n",
    "if x:\n\ta = 1\n        b = 2\n",
  ],
  [
    "python",
    "a space inside an f-string's debug specifier",
    'x = f"{a=}"\n',
    'x = f"{a = }"\n',
  ],
  [
    "python",
    "spaces around an operator in an f-string's debug specifier",
    "x = f'{x+1=}'\n",
    "x = f'{x + 1=}'\n",
  ],
  [
    "python",
    "a space after a debug specifier's conversion",
    "x = f'{x=!r}'\n",
    "x = f'{x=!r }'\n",
  ],
  [
    "python",
    "a shebang pushed down a line",
    "#!/usr/bin/env python\nx = 1\n",
    "\n#!/usr/bin/env python\nx = 1\n",
  ],
  [
    "python",
    "a coding cookie pushed down",
    "# -*- coding: latin-1 -*-\nx = 1\n",
    "\n\n\n# -*- coding: latin-1 -*-\nx = 1\n",
  ],
  [
    "javascript",
    "a hashbang pushed down a line",
    "#!/usr/bin/env node\nlet x = 1;\n",
    "\n#!/usr/bin/env node\nlet x = 1;\n",
  ],
  [
    "ruby",
    "a shebang pushed down a line",
    "#!/usr/bin/env ruby\nx = 1\n",
    "\n#!/usr/bin/env ruby\nx = 1\n",
  ],
  [
    "rust",
    "a shebang pushed down a line",
    "#!/usr/bin/env run\nfn main() {}\n",
    "\n#!/usr/bin/env run\nfn main() {}\n",
  ],
  [
    "css",
    "an @charset pushed down a line",
    '@charset "UTF-8";\na { b: c; }\n',
    '\n@charset "UTF-8";\na { b: c; }\n',
  ],
  [
    "c",
    "an #endif moved onto a line of code",
    "#if X\nint a;\n#endif\n",
    "#if X\nint a; #endif\n",
  ],
  [
    "c",
    "an #else moved onto a line of code",
    "#if X\nint a;\n#else\nint b;\n#endif\n",
    "#if X\nint a; #else\nint b;\n#endif\n",
  ],
  [
    "c",
    "a #define moved onto a line of code",
    "int a;\n#define X 1\n",
    "int a; #define X 1\n",
  ],
  [
    "cpp",
    "an #endif moved onto a line of code",
    "#if X\nint a;\n#endif\n",
    "#if X\nint a; #endif\n",
  ],
  [
    "csharp",
    "an #endif moved onto a line of code",
    "class A {\n#if X\nint a;\n#endif\n}\n",
    "class A {\n#if X\nint a; #endif\n}\n",
  ],
  [
    "csharp",
    "a #region moved onto the line of a class",
    "class A {\n#region foo\nint a;\n#endregion\n}\n",
    "class A { #region foo\nint a;\n#endregion\n}\n",
  ],
  [
    "go",
    "a composite literal wrapped without a trailing comma",
    "package p\n\nvar a = []int{1, 2}\n",
    "package p\n\nvar a = []int{\n1,\n2\n}\n",
  ],
  [
    "go",
    "a comma moved to the next line",
    "package p\n\nfunc f() { g(1, 2) }\n",
    "package p\n\nfunc f() { g(1\n, 2) }\n",
  ],
  [
    "go",
    "a brace moved to the next line after an if",
    "package p\n\nfunc f() { if x {\n} }\n",
    "package p\n\nfunc f() { if x\n{\n} }\n",
  ],
  [
    "go",
    "a closing parenthesis on its own line without a trailing comma",
    "package p\n\nfunc f() { g(1,\n2) }\n",
    "package p\n\nfunc f() { g(1,\n2\n) }\n",
  ],
  [
    "c",
    "spaces in the argument of a macro that may stringize it",
    "#define S(x) #x\nconst char *s = S(a+b);\n",
    "#define S(x) #x\nconst char *s = S(a + b);\n",
  ],
  [
    "cpp",
    "spaces in the argument of a macro that may stringize it",
    "#define S(x) #x\nauto s = S(a+b);\n",
    "#define S(x) #x\nauto s = S(a + b);\n",
  ],
  [
    "python",
    "the body of an if moved onto a line of its own",
    "if x: a\n",
    "if x:\n    a\n",
  ],
  [
    "typescript",
    "a gap inside a template literal type",
    "type A = `${B} ${C}`;\n",
    "type A = `${B}  ${C}`;\n",
  ],
  [
    "typescript",
    "a line break before an arrow",
    "const f = (a) => a;\n",
    "const f = (a)\n=> a;\n",
  ],
  [
    "javascript",
    "a line break before an arrow",
    "const f = (a) => a;\n",
    "const f = (a)\n=> a;\n",
  ],
];

/** More time than any of the tests' files need. */
const plenty = 60_000;

describe("Formatting-only files", () => {
  let comparer: FormattingComparer;

  before(async () => {
    comparer = await FormattingComparer.create(wasmFromNodeModules);
  });

  const check = (grammar: GrammarName, base: string, head: string) =>
    comparer.isFormattingOnly(grammar, base, head, plenty);

  it("has a grammar test for every shipped grammar", () => {
    assert.deepStrictEqual(
      languages.map((l) => l.grammar).sort(),
      Object.keys(grammars).sort()
    );
    assert.strictEqual(grammarWasms.length, 16);
    assert.ok(runtimeWasm.endsWith(".wasm"));
  });

  for (const { grammar, formatted, real } of languages) {
    describe(`in ${grammar}`, () => {
      it("loads the grammar in the pinned runtime", async () => {
        const language = await comparer.language(grammar);
        assert.ok(language.abiVersion >= 13, `ABI ${language.abiVersion}`);
      });

      for (const { what, base, head } of formatted) {
        it(`marks ${what}`, async () => {
          assert.strictEqual(await check(grammar, base, head), true);
          assert.strictEqual(await check(grammar, head, base), true);
        });
      }

      it("marks two identical versions", async () => {
        const [first] = formatted;
        assert.strictEqual(await check(grammar, first.base, first.base), true);
      });

      for (const { what, base, head } of real) {
        it(`does not mark ${what}`, async () => {
          assert.strictEqual(await check(grammar, base, head), false);
          assert.strictEqual(await check(grammar, head, base), false);
        });
      }
    });
  }

  describe("with line endings and blank lines", () => {
    it("marks CRLF to LF, trailing whitespace and blank lines outside any string", async () => {
      const base =
        "const a = 1;\r\nconst b = 2;   \r\n\r\n\r\nconst c = 3;\r\n";
      const head = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
      assert.strictEqual(await check("javascript", base, head), true);
      assert.strictEqual(await check("javascript", head, base), true);
    });

    it("marks a Python file whose only change is the blank lines between blocks", async () => {
      const base = "def f():\n    pass\n\n\n\ndef g():\n    pass\n";
      const head = "def f():\n    pass\ndef g():\n    pass\n";
      assert.strictEqual(await check("python", base, head), true);
    });

    it("does not mark the same changes inside a template literal", async () => {
      const base = "const s = `a\nb`;\n";
      for (const head of [
        "const s = `a\n\nb`;\n",
        "const s = `a \nb`;\n",
        "const s = `a\r\nb`;\n",
      ])
        assert.strictEqual(await check("javascript", base, head), false, head);
    });

    it("does not mark a Python file with trailing spaces added inside a triple-quoted string", async () => {
      const base = 's = """a\nb"""\n';
      assert.strictEqual(
        await check("python", base, 's = """a  \nb"""\n'),
        false
      );
    });
  });

  describe("where a grammar is lenient", () => {
    for (const [grammar, what, base, head] of lenientGrammars) {
      it(`does not mark, in ${grammar}, ${what}`, async () => {
        assert.strictEqual(await check(grammar, base, head), false);
        assert.strictEqual(await check(grammar, head, base), false);
      });
    }

    it("still marks a line break before a closing bracket after a type name", async () => {
      assert.strictEqual(
        await check(
          "typescript",
          "function f(a: number, b: string) {}\n",
          "function f(\n  a: number,\n  b: string\n) {}\n"
        ),
        true
      );
    });

    it("still marks a keyword followed by a line break in both versions", async () => {
      assert.strictEqual(
        await check(
          "javascript",
          "function f() { return\n x }\n",
          "function f() { return\n\n      x }\n"
        ),
        true
      );
    });
  });

  describe("where a change sits outside the tokens", () => {
    for (const [grammar, what, base, head] of moved) {
      it(`does not mark, in ${grammar}, ${what}`, async () => {
        assert.strictEqual(await check(grammar, base, head), false);
        assert.strictEqual(await check(grammar, head, base), false);
      });
    }

    it("does not mark a shell script that got carriage returns, though one that lost them is marked", async () => {
      const lf = "set -e\necho hi\n";
      const crlf = "set -e\r\necho hi\r\n";
      assert.strictEqual(await check("bash", lf, crlf), false);
      assert.strictEqual(await check("bash", crlf, lf), true);
    });

    it("still marks the formatting these checks sit beside", async () => {
      const marked: [GrammarName, string, string][] = [
        [
          "python",
          "def f(x):\n  # note\n  if x:\n    return 1  # one\n  else:\n    return 2\n",
          "def f(x):\n    # note\n    if x:\n        return 1  # one\n    else:\n        return 2\n",
        ],
        [
          "python",
          "def f(x):\n  return g(x,\n           1,\n           2)\n",
          "def f(x):\n    return g(x,\n        1,\n        2)\n",
        ],
        [
          "cpp",
          "template<typename T>\nvoid f(T t) {}\n",
          "template <typename T>\nvoid f(T t) {}\n",
        ],
        [
          "cpp",
          "template<typename T, typename U>\nclass A {};\nA<int,char> a;\n",
          "template <typename T, typename U>\nclass A {};\nA<int, char> a;\n",
        ],
        [
          "go",
          "package p\n\nfunc f() {\n  g(1,\n    2)\n  var a = []int{1,\n    2}\n}\n",
          "package p\n\nfunc f() {\n\tg(1,\n\t\t2)\n\tvar a = []int{1,\n\t\t2}\n}\n",
        ],
        [
          "c",
          "#define S(x) #x\nint f(int a, int b);\nint g() { return f(1,\n 2); }\n",
          "#define S(x) #x\nint f(int a, int b);\nint g() { return f(1, 2); }\n",
        ],
        [
          "c",
          "int g() { return f( 1 , 2 ); }\n",
          "int g() { return f(1, 2); }\n",
        ],
        [
          "python",
          "try:\n  x = 1\nexcept E:\n  x = 2\nfinally:\n  x = 3\n",
          "try:\n    x = 1\nexcept E:\n    x = 2\nfinally:\n    x = 3\n",
        ],
        [
          "go",
          "package p\n\n// Foo does x.\nfunc Foo() {\n  // inside\n  bar()\n}\n",
          "package p\n\n// Foo does x.\nfunc Foo() {\n\t// inside\n\tbar()\n}\n",
        ],
        ["c", "#if X\n  int a;\n#endif\n", "#if X\nint a;\n#endif\n"],
        [
          "csharp",
          "class A {\n  #if X\n  int a;\n  #endif\n}\n",
          "class A {\n#if X\n    int a;\n#endif\n}\n",
        ],
        [
          "javascript",
          "/* one */\nfoo( 1 ); // two\n",
          "/* one */\nfoo(1); // two\n",
        ],
        [
          "typescript",
          "const f = (a) =>\n  a;\n",
          "const f = (a) =>\n    a;\n",
        ],
        ["python", 'x = f"{a} {b}"\n', 'x  =  f"{a} {b}"\n'],
      ];
      for (const [grammar, base, head] of marked)
        assert.strictEqual(
          await check(grammar, base, head),
          true,
          `${grammar}: ${JSON.stringify(head)}`
        );
    });
  });

  describe("when a version can't be trusted", () => {
    it("gives no mark when either version has a syntax error", async () => {
      const good = "const a = 1;\n";
      const broken = "const a = ;\n";
      assert.strictEqual(await check("javascript", good, broken), false);
      assert.strictEqual(await check("javascript", broken, good), false);
      assert.strictEqual(await check("javascript", broken, broken), false);
    });

    it("gives no mark when tree-sitter would have to insert a missing token", async () => {
      assert.strictEqual(
        await check("javascript", "foo(1, 2);\n", "foo(1, 2;\n"),
        false
      );
    });

    it("gives no mark for versions that differ in a token, not in formatting", async () => {
      assert.strictEqual(
        await check("javascript", "a = 1;\n", "a = 2;\n"),
        false
      );
    });

    it("gives no mark for text between leaves that isn't whitespace, such as a no-break space", async () => {
      assert.strictEqual(
        await check("javascript", "a = 1;\n", "a =\u00a01;\n"),
        false
      );
    });

    it("gives no answer when the time is up", async () => {
      assert.strictEqual(
        await comparer.isFormattingOnly(
          "javascript",
          "a = 1;\n".repeat(50_000),
          "a  =  1;\n".repeat(50_000),
          -1
        ),
        undefined
      );
    });

    it("gives no answer when the parse can't finish in time, and goes on to the next file", async () => {
      const lines = "a = 1;\n".repeat(200_000);
      assert.strictEqual(
        await comparer.isFormattingOnly(
          "javascript",
          lines,
          lines.replace(/ = /g, "  =  "),
          20
        ),
        undefined
      );
      assert.strictEqual(
        await check("javascript", "a = 1;\n", "a  =  1;\n"),
        true
      );
    });
  });

  describe("choosing the grammar", () => {
    it("is by the file's extension", () => {
      const cases: [string, GrammarName][] = [
        ["src/a.ts", "typescript"],
        ["src/a.mts", "typescript"],
        ["src/a.tsx", "tsx"],
        ["src/a.js", "javascript"],
        ["src/a.jsx", "javascript"],
        ["src/a.mjs", "javascript"],
        ["a.py", "python"],
        ["a.go", "go"],
        ["a.rs", "rust"],
        ["a.java", "java"],
        ["a.c", "c"],
        ["a.h", "c"],
        ["a.cpp", "cpp"],
        ["a.hpp", "cpp"],
        ["a.cs", "csharp"],
        ["a.rb", "ruby"],
        ["a.sh", "bash"],
        ["a.json", "json"],
        ["a.yml", "yaml"],
        ["a.yaml", "yaml"],
        ["a.css", "css"],
        ["a.kt", "kotlin"],
        ["a.kts", "kotlin"],
        ["dir.with.dots/a.PY", "python"],
      ];
      for (const [file, grammar] of cases)
        assert.strictEqual(grammarOfPath(file), grammar, file);
    });

    it("gives none for HTML, PHP, Markdown, Swift, Makefiles and unknown files", () => {
      for (const file of [
        "a.html",
        "a.htm",
        "a.php",
        "README.md",
        "a.markdown",
        "a.swift",
        "Makefile",
        "a.mk",
        "a.txt",
        "a.unknown",
        "noextension",
        "dir.with.dots/noextension",
        ".gitignore",
        "a.ts.orig",
      ])
        assert.strictEqual(grammarOfPath(file), undefined, file);
    });
  });
});
