import { ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
const roots = new WeakMap<Element, Root>();
export function renderInto(element: ReactNode, container: Element) {
    let root = roots.get(container);
    if (!root) {
        root = createRoot(container);
        roots.set(container, root);
    }
    root.render(element);
}
export function unmountFrom(container: Element) {
    roots.get(container)?.unmount();
    roots.delete(container);
}
