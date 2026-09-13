import { createEffect, createSignal, from, onCleanup, untrack, type Accessor } from 'solid-js';
import { isServer } from 'solid-js/web';
import type { animate } from 'motion';

/** Handle returned by motion's `animate()`; used instead of `any` for stored animations. */
export type AnimationHandle = ReturnType<typeof animate>;

/**
 * Bridge an external subscribe/read store (DialStore et al.) into a Solid accessor.
 * Subscribes at setup on the client so updates between setup and mount are not
 * missed; on the server it reads directly without subscribing, so per-request
 * renders never leak listeners on the module-level store singleton.
 */
export function fromStore<T>(
  read: () => T,
  subscribe: (notify: () => void) => () => void
): Accessor<T> {
  if (isServer) return read;
  const value = from<T>((set) => {
    // Wrap in an updater so values are never mistaken for setter callbacks.
    set(() => read());
    // Notifications run inside whichever computation wrote the store, so reads here must not become its dependencies.
    return subscribe(() => set(() => untrack(read)));
  });
  return value as Accessor<T>;
}

export interface DropdownPresence {
  /** Logical open state (drives trigger styling, outside-click handling). */
  isOpen: Accessor<boolean>;
  /** DOM presence: stays true during the exit animation so it can play out. */
  mounted: Accessor<boolean>;
  open: () => void;
  close: () => void;
  /** Attach to the dropdown element via `ref`. */
  setRef: (el: HTMLElement) => void;
  contains: (target: Node) => boolean;
}

/**
 * Mount/unmount bookkeeping for an animated dropdown: `open()` mounts
 * immediately (the call site's ref callback runs the enter animation),
 * `close()` plays the provided exit animation and unmounts on completion.
 * Interrupted exits are stopped and re-opened cleanly.
 */
export function createDropdownPresence(
  animateExit: (el: HTMLElement, done: () => void) => AnimationHandle
): DropdownPresence {
  const [isOpen, setIsOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  let el: HTMLElement | undefined;
  let exitAnim: AnimationHandle | null = null;

  onCleanup(() => exitAnim?.stop());

  const open = () => {
    exitAnim?.stop();
    exitAnim = null;
    setMounted(true);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    if (!el || !mounted()) {
      setMounted(false);
      return;
    }
    exitAnim?.stop();
    exitAnim = animateExit(el, () => {
      setMounted(false);
      exitAnim = null;
    });
  };

  return {
    isOpen,
    mounted,
    open,
    close,
    setRef: (node: HTMLElement) => {
      el = node;
    },
    contains: (target: Node) => Boolean(el?.contains(target)),
  };
}

/**
 * While `isOpen`, dismiss on mousedown outside of `contains` and invoke
 * `onViewportChange` on window resize/scroll (for repositioning portaled
 * dropdowns). Listeners detach automatically when closed or unmounted.
 */
export function createDropdownDismiss(opts: {
  isOpen: Accessor<boolean>;
  contains: (target: Node) => boolean;
  onDismiss: () => void;
  onViewportChange?: () => void;
}): void {
  createEffect(() => {
    if (!opts.isOpen()) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Node && opts.contains(e.target)) return;
      opts.onDismiss();
    };
    document.addEventListener('mousedown', onMouseDown);
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown));

    const onViewportChange = opts.onViewportChange;
    if (onViewportChange) {
      const handler = () => onViewportChange();
      window.addEventListener('resize', handler);
      window.addEventListener('scroll', handler, true);
      onCleanup(() => {
        window.removeEventListener('resize', handler);
        window.removeEventListener('scroll', handler, true);
      });
    }
  });
}
