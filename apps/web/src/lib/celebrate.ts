import confetti from 'canvas-confetti';

const COLORS = ['#6e7af0', '#9aa2ff', '#23a981', '#c7ccff'];

/** Tasteful confetti burst — milestone/kutlama anlari icin (vesting esigi, ilk satis, payout). */
export function celebrate(): void {
  confetti({ particleCount: 90, spread: 75, startVelocity: 38, origin: { y: 0.62 }, colors: COLORS, disableForReducedMotion: true });
  setTimeout(() => confetti({ particleCount: 45, angle: 60, spread: 60, origin: { x: 0, y: 0.65 }, colors: COLORS, disableForReducedMotion: true }), 130);
  setTimeout(() => confetti({ particleCount: 45, angle: 120, spread: 60, origin: { x: 1, y: 0.65 }, colors: COLORS, disableForReducedMotion: true }), 260);
}

/** Daha kucuk, tek seferlik onay parlamasi (kucuk basarilar icin). */
export function sparkle(): void {
  confetti({ particleCount: 36, spread: 50, scalar: 0.8, startVelocity: 28, origin: { y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
}
