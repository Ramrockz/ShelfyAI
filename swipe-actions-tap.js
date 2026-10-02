// Swipe-reveal action buttons (Restock/Duplicate/Delete, Reverse, Replace,
// ...) fire on pointerup instead of waiting for the browser's own click.
//
// Every list page has its own hand-rolled swipe-to-reveal (initSwipe() in
// ingredients.html, initExpSwipe() in expenses.html, initOrderSwipe() in
// orders.html, initProductSwipe() in recipes.html, initRdmItemSwipe() in
// recipe-detail.html, initDeliverySwipe() in operations.html), and each
// already carries its own workaround for "the first tap after a swipe does
// nothing" (noClickUntil exemptions, pointer-events:none during the slide,
// touch-action: manipulation, forced reflows). The first tap still got
// dropped on mobile across all of them -- the touch reaches the button
// (pointerdown/pointerup land on it) but the browser never turns it into a
// click, so only a second tap worked. Triggering the button directly from
// a clean tap's pointerup doesn't depend on the browser deciding to
// synthesize that click at all; the native click that may still follow is
// swallowed so the action never runs twice.
(function () {
  const ACTIONS = '.ing-actions, .exp-actions, .ord-actions, .prod-actions, .rdm-item-actions, .delivery-actions';
  const TARGET = 'button, a, [onclick]';
  const SLOP = 10; // px a finger may wander and still count as a tap

  let down = null;
  let suppressUntil = 0;

  document.addEventListener('pointerdown', e => {
    down = null;
    if (e.pointerType === 'mouse') return; // mouse clicks were never affected
    const btn = e.target.closest(TARGET);
    if (!btn || !btn.closest(ACTIONS)) return;
    down = { btn, x: e.clientX, y: e.clientY, id: e.pointerId };
  }, true);

  document.addEventListener('pointerup', e => {
    if (!down || e.pointerId !== down.id) return;
    const d = down;
    down = null;
    if (Math.abs(e.clientX - d.x) > SLOP || Math.abs(e.clientY - d.y) > SLOP) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit || hit.closest(TARGET) !== d.btn) return;
    suppressUntil = Date.now() + 700;
    d.btn.click();
  }, true);

  document.addEventListener('pointercancel', e => {
    if (down && e.pointerId === down.id) down = null;
  }, true);

  // The browser's own click for that same tap, if it does arrive -- the
  // action already ran from pointerup above.
  document.addEventListener('click', e => {
    if (!e.isTrusted || Date.now() >= suppressUntil) return;
    if (!e.target.closest || !e.target.closest(ACTIONS)) return;
    suppressUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  }, true);
})();
