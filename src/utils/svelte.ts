import { mount, unmount } from "svelte";
import type { Component, MountOptions } from "svelte";

/** 组件挂载到容器后的句柄，统一组件的回收入口 */
export interface MountedComponent<T = unknown> {
  /** Svelte 组件实例，组件导出（如 $export）经此访问 */
  instance: T;
  /** 卸载组件并清空挂载容器 */
  destroy(): void;
}

/**
 * 将 Svelte 组件挂载到目标容器（如视图的 contentEl）。
 * 先清空容器再挂载，保证重复打开时不会累积 DOM。
 * 组件样式经 css: "injected" 注入 <head>，卸载后样式标签残留，
 * 但编译期 class 哈希保证样式隔离，不影响其他 UI。
 * props 透传 mount：分支重载保证无 props 组件可省略、有 props 组件必传，缺列/错型由 svelte-check 兜底。
 * @param target 挂载目标元素
 * @param component Svelte 组件类
 * @param args args
 * @returns 挂载句柄，destroy() 卸载组件并清空容器
 */
export function mountComponent<Props extends Record<string, unknown>>(
  target: HTMLElement,
  component: Component<Props>,
  // 空对象分支判定的就是“无 props 可省”：此处 {} 与 svelte MountOptions 的 {} extends Props 同源，不放宽为 object
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 与 svelte MountOptions 的 {} extends Props 分支判定同源
  ...args: {} extends Props ? [props?: Props] : [props: Props]
): MountedComponent {
  target.empty();
  // MountOptions<Props> 的 props 可选性随 {} extends Props 分支，泛型函数内无法收窄该条件类型；
  // 参数侧仍保留分支重载（无 props 可省、有 props 必传），仅 mount 调用处经 MountOptions 中转
  const [props] = args;
  const options = (props === undefined ? { target } : { target, props }) as MountOptions<Props>;
  const instance = mount(component, options);
  return {
    instance,
    destroy: () => {
      // unmount 类型为 void | Promise<void>，未开 outro 时同步销毁，void 标记显式忽略
      void unmount(instance);
      target.empty();
    },
  };
}
