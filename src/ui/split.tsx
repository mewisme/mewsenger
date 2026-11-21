import { Fragment, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";

/** Narrowest a pane may get, in CSS (logical) pixels; the native side enforces it too. */
export const PANE_MIN = 480;

export interface SplitViewProps {
  ids: string[];
  ratio: number;
}

/**
 * Draws the divider between account panes. The panes themselves are native
 * webviews laid over the empty panels; this view reports where the panels
 * are so the native side can place the webviews.
 */
export function SplitView({ ids, ratio }: SplitViewProps) {
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const frame = useRef<number | null>(null);
  const count = ids.length;

  const report = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const rects = panes.current.slice(0, count).flatMap((element) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return [{ x: rect.x, width: rect.width }];
      });
      if (rects.length !== count) return;
      void invoke("set_split_layout", { rects }).catch(() => { /* Native layout stays as is. */ });
    });
  }, [count]);

  useEffect(() => {
    const observer = new ResizeObserver(report);
    for (const element of panes.current.slice(0, count)) {
      if (element) observer.observe(element);
    }
    report();
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [count, report]);

  const first = ratio * 100;
  return (
    <main className="h-screen w-full overflow-hidden bg-background">
      <ResizablePanelGroup orientation="horizontal" aria-label="Account panes">
        {ids.map((id, index) => (
          <Fragment key={id}>
            {index > 0 && <ResizableHandle aria-label="Resize account panes" className="w-[6px]" />}
            <ResizablePanel
              id={id}
              minSize={PANE_MIN}
              defaultSize={`${index === 0 ? first : 100 - first}%`}
            >
              <div
                ref={(element) => { panes.current[index] = element; }}
                data-pane={id}
                className="h-full w-full"
              />
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </main>
  );
}
