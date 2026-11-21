// An element made by the page's code; only what scripts do to a fresh one.
export function fakeElement() {
  const attributes = new Map();
  return {
    dataset: {}, style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], append() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
  };
}

