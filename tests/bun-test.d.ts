// bun:test 最小类型声明：仅覆盖本仓库测试用到的 API，避免引入外部类型包。
declare module "bun:test" {
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThan(expected: number): void;
    toThrow(expected?: unknown): void;
    not: Matchers;
  }
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
  export const mock: {
    module(path: string, factory: () => unknown): void;
  };
}
