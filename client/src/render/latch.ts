// Input latch of camera jumps (D-048, spec req. 4): pointer input is
// ignored while a jump animates, and a press that begins during a jump
// stays ignored until every pointer of it is up — also when it becomes a
// different gesture meanwhile (a one-finger drag promoted to a pinch emits
// a cancel while both fingers stay down). A press that began before the
// jump is cancelled by the renderer instead. Pure state, no DOM or clock.

export class JumpLatch {
  private ignored = false;

  /**
   * A pointer went down. `first`: no other pointer of the current press is
   * down (a new press); `animating`: a jump runs now.
   */
  down(first: boolean, animating: boolean): void {
    this.ignored = first ? animating : this.ignored || animating;
  }

  /** The last pointer of the press is up (released or cancelled by the browser): the next press starts afresh. */
  released(): void {
    this.ignored = false;
  }

  /** Whether pointer input is ignored now (the wheel only checks `animating`). */
  blocks(animating: boolean): boolean {
    return this.ignored || animating;
  }
}
