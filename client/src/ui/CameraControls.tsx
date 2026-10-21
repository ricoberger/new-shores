import styles from "./hud.module.css";

interface Props {
  /** Turns the camera by 90° steps (positive: clockwise orbit, like E). */
  onRotate: (steps: number) => void;
}

/** On-screen camera rotation (D-048): one 90° step per press, like Q and E. */
export function CameraControls({ onRotate }: Props) {
  return (
    <div className={styles.cameraControls}>
      <button
        type="button"
        className={styles.hudButton}
        onClick={() => onRotate(-1)}
        aria-label="Turn the camera counter-clockwise (Q)"
        title="Turn the camera counter-clockwise (Q)"
        data-testid="camera-rotate-left"
      >
        ⟲
      </button>
      <button
        type="button"
        className={styles.hudButton}
        onClick={() => onRotate(1)}
        aria-label="Turn the camera clockwise (E)"
        title="Turn the camera clockwise (E)"
        data-testid="camera-rotate-right"
      >
        ⟳
      </button>
    </div>
  );
}
