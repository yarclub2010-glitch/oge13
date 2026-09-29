// Связь с платформой репетитора. Если тренажёр открыт внутри страницы платформы
// с параметром ?platform=<адрес платформы>, после каждой проверки он сообщает ей балл.
// При обычном открытии ничего не происходит.
const target = (() => {
  if (window.parent === window) return null;
  const origin = new URLSearchParams(location.search).get('platform');
  try {
    return origin ? new URL(origin).origin : null;
  } catch {
    return null;
  }
})();

export function reportScore(task, taskId, score, max) {
  if (!target) return;
  window.parent.postMessage({ type: 'oge-trainer-result', task, taskId, score, max }, target);
}
