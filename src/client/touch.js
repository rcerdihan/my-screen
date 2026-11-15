// Dokunmatik -> fare. Yerel mod sayfası kullanır (normal mod client.js içinde kendi kopyasını taşır).
// Tek parmak: dokun = tık, sürükle = sürükle, basılı tut = sağ tık. İki parmak: kaydırma.
// el: dokunulan öğe, contentSize(): görüntünün piksel boyutu, send(msg): girdiyi gönder.
function setupTouch(el, contentSize, send) {
  const MOVE_THRESHOLD = 10;
  const LONG_PRESS_MS = 550;
  let primaryId = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let consumed = false;
  let longPressTimer = null;
  let scrollLast = null;
  let pendingMove = null;

  function normalized(touch) {
    const rect = el.getBoundingClientRect();
    const size = contentSize();
    const vw = size.width || rect.width;
    const vh = size.height || rect.height;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = rect.left + (rect.width - w) / 2;
    const top = rect.top + (rect.height - h) / 2;
    return {
      x: Math.min(1, Math.max(0, (touch.clientX - left) / w)),
      y: Math.min(1, Math.max(0, (touch.clientY - top) / h)),
    };
  }
  function sendMove(touch) {
    const p = normalized(touch);
    send({ type: 'input', k: 'm', x: p.x, y: p.y });
  }
  function queueMove(touch) {
    const first = !pendingMove;
    pendingMove = { clientX: touch.clientX, clientY: touch.clientY };
    if (first) {
      requestAnimationFrame(() => {
        if (pendingMove) sendMove(pendingMove);
        pendingMove = null;
      });
    }
  }
  function flushMove() {
    if (pendingMove) sendMove(pendingMove);
    pendingMove = null;
  }
  function clearLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  function releaseDrag() {
    if (dragging) send({ type: 'input', k: 'u' });
    dragging = false;
  }
  function centroid(touches) {
    let x = 0;
    let y = 0;
    for (const t of touches) {
      x += t.clientX;
      y += t.clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  el.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        primaryId = t.identifier;
        startX = t.clientX;
        startY = t.clientY;
        dragging = false;
        consumed = false;
        sendMove(t);
        clearLongPress();
        longPressTimer = setTimeout(() => {
          if (!dragging && !consumed) {
            consumed = true;
            send({ type: 'input', k: 'r' });
            if (navigator.vibrate) navigator.vibrate(15);
          }
        }, LONG_PRESS_MS);
      } else if (e.touches.length === 2) {
        clearLongPress();
        releaseDrag();
        consumed = true;
        scrollLast = centroid(e.touches);
      }
    },
    { passive: false }
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (e.touches.length >= 2 && scrollLast) {
        const c = centroid(e.touches);
        const dy = c.y - scrollLast.y;
        const dx = c.x - scrollLast.x;
        if (Math.abs(dy) >= 2) send({ type: 'input', k: 'w', v: dy * 4 });
        if (Math.abs(dx) >= 2) send({ type: 'input', k: 'h', v: -dx * 4 });
        scrollLast = c;
        return;
      }
      if (consumed) return;
      const t = [...e.touches].find((x) => x.identifier === primaryId);
      if (!t) return;
      if (!dragging) {
        if (Math.hypot(t.clientX - startX, t.clientY - startY) < MOVE_THRESHOLD) return;
        clearLongPress();
        dragging = true;
        send({ type: 'input', k: 'd' });
      }
      queueMove(t);
    },
    { passive: false }
  );

  function onTouchEnd(e) {
    e.preventDefault();
    if (e.touches.length > 0) {
      if (e.touches.length < 2) scrollLast = null;
      return;
    }
    clearLongPress();
    scrollLast = null;
    flushMove();
    if (dragging) {
      releaseDrag();
    } else if (!consumed && e.type === 'touchend') {
      send({ type: 'input', k: 'd' });
      send({ type: 'input', k: 'u' });
    }
    primaryId = null;
  }
  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('touchcancel', onTouchEnd, { passive: false });
}
