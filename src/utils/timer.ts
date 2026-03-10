export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}
