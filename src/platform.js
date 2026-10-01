// Связь с платформой репетитора. Если тренажёр открыт внутри страницы платформы
// с параметром ?platform=<адрес платформы>, после каждой проверки он сообщает ей балл.
// При обычном открытии ничего не происходит.
const target = (() => {
  if (window.parent === window) return null;
  const raw = new URLSearchParams(location.search).get('platform');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Только настоящий адрес сайта: data:, javascript:, file: дают origin "null"
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
})();

// Внутри платформы готовое решение не показываем: балл идёт в домашнее задание
export const inPlatform = target !== null;
if (inPlatform) document.documentElement.classList.add('in-platform');

export function reportScore(task, taskId, score, max) {
  if (!target) return;
  try {
    window.parent.postMessage({ type: 'oge-trainer-result', task, taskId, score, max }, target);
  } catch {
    // Сообщить платформе не удалось — проверка и балл в самом тренажёре от этого не страдают
  }
}
