import { useEffect, useMemo, useRef, useState } from 'react';

import Stats from 'stats.js';
import type { GUI } from 'dat.gui';

import styles from './SampleLayout.module.css';


export type SampleInit = (params: {
  canvas: HTMLCanvasElement;
  pageState: { active: boolean };
  gui?: GUI;
  stats?: Stats;
  videoURL?: string;
  imageURL?: string;
}) => Promise<() => void>;

const SampleLayout: React.FunctionComponent<
  React.PropsWithChildren<{
    name: string;
    description: string;
    originTrial?: string;
    filename: string;
    gui?: boolean;
    stats?: boolean;
    init: SampleInit;
  }>
> = (props) => {
  const guiParentRef = useRef<HTMLDivElement | null>(null);
  const gui: GUI | undefined = useMemo(() => {
    const dat = require('dat.gui');
    return new dat.GUI({ autoPlace: false });
  }, []);

  const statsParentRef = useRef<HTMLDivElement | null>(null);
  const stats: Stats | undefined = useMemo(() => {
    if (typeof window !== 'undefined') {
      const Stats = require('stats-js');
      return new Stats();
    }
    return undefined;
  }, []);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const videoURL = 'https://ik.imagekit.io/e8tditfh8c/idol.mp4?tr=orig';

  const [error, setError] = useState<unknown | null>(null);

  const canvasParentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stats && statsParentRef.current) {
      stats.dom.style.position = 'absolute';
      stats.dom.style.right = 'auto';
      stats.dom.style.top = '0px';
      stats.dom.style.left = '0px';
      statsParentRef.current.appendChild(stats.dom);
      stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    }
    if (gui && guiParentRef.current) {
      guiParentRef.current.appendChild(gui.domElement);
    }
    let canvas: HTMLCanvasElement;
    if (canvasParentRef.current) {
      canvasParentRef.current.innerHTML = '';
      canvas = document.createElement('canvas');
      canvasParentRef.current.appendChild(canvas);
    } else {
      canvas = document.createElement('canvas');
    }

    const pageState = {
      active: true,
    };
    const p = props.init({
      canvas,
      pageState,
      gui,
      stats,
      videoURL,
    });
    const cleanup = () => {
      p.then(destroy => destroy());
    };
    return cleanup;
  }, [videoURL]);

  return (
    <main>
      <div>
        <h1>{props.name}</h1>
        {error ? (
          <>
            <p>
              Something went wrong. Do your browser and device support WebGPU?
            </p>
            <p>{`${error}`}</p>
          </>
        ) : null}
      </div>
      <div className={styles.canvasContainer}>
        <div
          style={{
            position: 'absolute',
            left: 10,
          }}
          id="statsParent"
          ref={statsParentRef}
        />
        <div
          style={{
            position: 'absolute',
            right: 10,
          }}
          id="guiParent"
          ref={guiParentRef}
        />
        <div id="canvasParent" ref={canvasParentRef} />
      </div>
    </main>
  );
};

export default SampleLayout;

export const makeSample: (
  ...props: Parameters<typeof SampleLayout>
) => JSX.Element = (props) => {
  return <SampleLayout {...props} />;
};

export function assert(condition: unknown, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}
