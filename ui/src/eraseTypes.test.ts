import { describe, expect, it } from "bun:test";
import { blank, typeRanges } from "./eraseTypes";
import { parseScript } from "./scriptSyntax";

function erase(code: string): string {
  return blank(code, typeRanges(parseScript(code)!, code));
}

function run(code: string): unknown {
  return new Function(erase(code))();
}

describe("typeRanges", () => {
  it("erases annotations, generics and the type declarations", () => {
    expect(
      run(
        `interface A {\n  a: number;\n}\ntype B = A & { b?: number };\nfunction first<T,>(items: T[]): T {\n  return items[0];\n}\nconst value: B = { a: first<number>([1]) };\nreturn value.a;`,
      ),
    ).toBe(1);
  });

  it("erases an assertion from its keyword, whatever the parentheses", () => {
    expect(run(`const a = (1 + 2) as number;\nconst b = (a as (number | string));\nreturn b;`)).toBe(3);
    expect(run(`const a = { x: 1 } satisfies { x?: number };\nreturn a.x;`)).toBe(1);
    expect(run(`const v = <{ a: string }>{ a: "x" };\nreturn v.a;`)).toBe("x");
  });

  it("erases a non-null mark, parenthesized or not", () => {
    expect(run(`const xs: number[] | undefined = [1];\nreturn xs!.length + (xs)!.length;`)).toBe(2);
  });

  it("erases an optional parameter's mark and a definite assignment's", () => {
    expect(run(`function f(x?: number) {\n  return x ?? 4;\n}\nlet y!: number;\ny = 1;\nreturn f() + y;`)).toBe(5);
  });

  it("erases what is declared and never defined", () => {
    expect(
      run(
        `declare const tag: string;\ndeclare function z(): void;\nfunction over(a: string): string;\nfunction over(a: any) {\n  return a;\n}\nreturn over("o");`,
      ),
    ).toBe("o");
  });

  it("erases a class's modifiers and keeps what it runs", () => {
    const code = `abstract class Base<T> implements Iterable<T> {
  private readonly items?: T[];
  protected abstract name: string;
  declare tag: string;
  abstract go(): void;
  override toString(): string {
    return "b";
  }
  [Symbol.iterator](): Iterator<T> {
    return [][Symbol.iterator]();
  }
}
class C extends Base<number> {
  name = "c";
  go() {}
  public static of(): C {
    return new C();
  }
}
return C.of().name + String(C.of());`;
    expect(run(code)).toBe("cb");
  });

  it("keeps every line where it was written", () => {
    const code = `interface A {\n  a: string;\n}\nconst a: A = { a: "x" };`;
    expect(
      erase(code)
        .split("\n")
        .map((line) => line.trimEnd()),
    ).toEqual(["", "", "", `const a    = { a: "x" };`]);
  });

  it("refuses what TypeScript would have to emit, naming what to write instead", () => {
    expect(() => erase(`const a = 1;\nenum E {\n  A,\n}`)).toThrow("Line 2: Kaja runs a script by erasing its types, so an enum can't run");
    expect(() => erase(`namespace N {\n  export const a = 1;\n}`)).toThrow("so a namespace can't run");
    expect(() => erase(`class A {\n  constructor(private x: number) {}\n}`)).toThrow("so a parameter property can't run");
  });

  it("leaves an enum that is only declared alone", () => {
    expect(run(`declare enum E {\n  A,\n}\nreturn 1;`)).toBe(1);
  });
});
