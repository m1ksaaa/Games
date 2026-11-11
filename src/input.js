// Input: mouse (absolute follow), touch (relative drag - finger never covers the flake),
// keyboard (A/D or arrows). Also blocks browser scrolling keys inside the CrazyGames iframe.

const BLOCK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mode = 'none'; // mouse | touch | keys | none
    this.mouseX = null;
    this.touch = null; // {id, startX, startFlakeX, x}
    this.onPause = null;
    this.onAnyInput = null;
    this.view = null; // set by main: {s, ox}

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (BLOCK_KEYS.has(e.key)) e.preventDefault();
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') {
        if (this.onPause) this.onPause();
        return;
      }
      if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        this.mode = 'keys';
      }
      if (this.onAnyInput) this.onAnyInput();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  toLogicalX(clientX) {
    const v = this.view;
    if (!v) return 0;
    const rect = this.canvas.getBoundingClientRect();
    return (clientX - rect.left - v.ox) / v.s;
  }

  down(e) {
    if (this.onAnyInput) this.onAnyInput();
    if (e.pointerType === 'mouse') {
      this.mode = 'mouse';
      this.mouseX = this.toLogicalX(e.clientX);
      return;
    }
    this.mode = 'touch';
    this.touch = { id: e.pointerId, startX: e.clientX, x: e.clientX, startFlakeX: null };
  }

  move(e) {
    if (e.pointerType === 'mouse') {
      // ignore tiny jitters so a resting mouse doesn't override keyboard play
      const lx = this.toLogicalX(e.clientX);
      if (this.mode !== 'mouse' && this.mouseX != null && Math.abs(lx - this.mouseX) < 6) return;
      this.mouseX = lx;
      this.mode = 'mouse';
      return;
    }
    if (this.touch && e.pointerId === this.touch.id) this.touch.x = e.clientX;
  }

  up(e) {
    if (this.touch && e.pointerId === this.touch.id) this.touch = null;
  }

  /** Returns steering intent for the flake at logical x = flakeX. */
  steer(flakeX) {
    const k = this.keys;
    const dir = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    if (dir !== 0 || this.mode === 'keys') return { mode: 'dir', dir };
    if (this.mode === 'touch') {
      if (!this.touch) return { mode: 'dir', dir: 0 };
      if (this.touch.startFlakeX == null) this.touch.startFlakeX = flakeX;
      const s = this.view ? this.view.s : 1;
      return { mode: 'target', x: this.touch.startFlakeX + ((this.touch.x - this.touch.startX) / s) * 1.35 };
    }
    if (this.mode === 'mouse' && this.mouseX != null) return { mode: 'target', x: this.mouseX };
    return { mode: 'dir', dir: 0 };
  }

  reset() {
    this.touch = null;
    this.keys.clear();
  }
}
