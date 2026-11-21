// Records event listeners the way a page would hold them: any number per
// event, all of which run when the event fires.
export class Listeners {
  #byEvent = new Map();

  set(name, listener) {
    const all = this.#byEvent.get(name) ?? [];
    all.push(listener);
    this.#byEvent.set(name, all);
    return this;
  }

  get(name) {
    const all = this.#byEvent.get(name);
    if (!all) return undefined;
    return (...args) => {
      let result;
      for (const listener of [...all]) result = listener(...args);
      return result;
    };
  }

  has(name) { return this.#byEvent.has(name); }

  delete(name) { return this.#byEvent.delete(name); }

  get size() { return this.#byEvent.size; }
}
