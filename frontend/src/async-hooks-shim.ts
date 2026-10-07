export class AsyncLocalStorage {
  disable() {}
  getStore() {
    return undefined;
  }
  run(store: any, callback: () => any, ...args: any[]) {
    return callback();
  }
  exit(callback: () => any, ...args: any[]) {
    return callback();
  }
  enterWith(store: any) {}
}
