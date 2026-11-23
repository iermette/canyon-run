const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
]);

// Keyboard state. `held` tracks keys currently down, `pressed` tracks
// keys that went down this frame (edge detection, cleared by endFrame).
export class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.chars = []; // printable characters typed since the last drain (text fields)
    window.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Single printable characters (letters, digits, space...) for text input.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.chars.push(e.key);
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  isDown(code) { return this.held.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  // Characters typed since the last call (empty string when none).
  drainChars() {
    const text = this.chars.join('');
    this.chars.length = 0;
    return text;
  }

  endFrame() {
    this.pressed.clear();
    this.chars.length = 0; // undrained characters are dropped each frame
  }

  // Returns {throttle: -1..1, steer: -1 (left)..1 (right)} for the car.
  readDrive() {
    const up = this.isDown('ArrowUp') || this.isDown('KeyW');
    const down = this.isDown('ArrowDown') || this.isDown('KeyS');
    const left = this.isDown('ArrowLeft') || this.isDown('KeyA');
    const right = this.isDown('ArrowRight') || this.isDown('KeyD');
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (right ? 1 : 0) - (left ? 1 : 0),
    };
  }
}
