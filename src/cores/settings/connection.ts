/** 连接测试超时毫秒数：局域网拨号无响应时兜底失败，避免按钮长挂起 */
export const CONNECTION_TEST_TIMEOUT_MS = 5000;

/**
 * 拨号指定 websocket 地址：open 即 resolve 并关闭连接，
 * error/超时即 reject；调用方只关心可达性，不消费消息。
 * @param url 待拨号的 websocket 地址
 */
export function openWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("timeout"));
    }, CONNECTION_TEST_TIMEOUT_MS);
    socket.onopen = () => {
      window.clearTimeout(timer);
      socket.close();
      resolve();
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("unreachable"));
    };
  });
}
