// Minimal event emitter.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const s = this.handlers.get(type);
    if (s) s.delete(fn);
  }
  emit(type, data) {
    const s = this.handlers.get(type);
    if (s) for (const fn of [...s]) fn(data);
  }
}
