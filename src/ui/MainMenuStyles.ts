/** Scoped title-screen styles; palette follows the illustrated interface study. */
export const MAIN_MENU_STYLES = `
.rail-main-menu {
  --menu-cream: #f7f5ec;
  --menu-ink: #26362f;
  --menu-green: #345c49;
  position: fixed; inset: 0; z-index: 1500; isolation: isolate;
  color: var(--menu-cream); background: #263c30;
  font: 16px/1.45 "Segoe UI", system-ui, sans-serif;
  overflow: auto; overscroll-behavior: contain;
  -webkit-tap-highlight-color: transparent;
}
.rail-main-menu *, .rail-main-menu *::before, .rail-main-menu *::after { box-sizing: border-box; }
.rail-main-menu button { font: inherit; color: inherit; touch-action: manipulation; }
.rail-main-menu button:focus-visible { outline: 3px solid #efd69a; outline-offset: 5px; }
.rail-main-menu button:disabled { cursor: default; }
.rail-main-menu .rmm-art { position: absolute; inset: 0; overflow: hidden; z-index: -2; }
.rail-main-menu .rmm-art img {
  width: 100%; height: 100%; object-fit: cover; object-position: 61% 50%;
  animation: rmm-drift 40s ease-in-out infinite alternate;
}
.rail-main-menu .rmm-veil {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: linear-gradient(90deg, #122a24f5 0%, #142b25ef 22%, #162e27b5 38%, #14281c25 65%, #14281c08 100%),
    linear-gradient(0deg, #12251ce6 0%, transparent 24%, transparent 85%, #15271e35 100%);
}
.rail-main-menu .rmm-layout {
  min-height: 100%; display: flex; flex-direction: column;
  padding: max(30px, env(safe-area-inset-top)) max(44px, env(safe-area-inset-right))
    max(24px, env(safe-area-inset-bottom)) max(56px, env(safe-area-inset-left));
}
.rail-main-menu .rmm-topline { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.rail-main-menu .rmm-brand { display: flex; align-items: center; gap: 12px; font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
.rail-main-menu .rmm-brand-mark { width: 35px; height: 35px; color: #e4d4a4; }
.rail-main-menu .rmm-top-note { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; text-shadow: 0 1px 5px #13281d; }
.rail-main-menu .rmm-main { flex: 1; display: flex; align-items: center; padding: 30px 0 36px; }
.rail-main-menu .rmm-content { width: clamp(290px, 27vw, 370px); }
.rail-main-menu .rmm-eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #d6c99e; margin: 0 0 8px; }
.rail-main-menu h1 { font: normal clamp(70px, 7.2vw, 108px)/1 Georgia, "Times New Roman", serif; letter-spacing: -.065em; margin: 0 0 18px -5px; }
.rail-main-menu .rmm-tagline { margin: 0; color: #e3e5d8; font-size: 17px; line-height: 1.65; }
.rail-main-menu .rmm-rule { width: 40px; height: 2px; background: #c8b982; margin: 26px 0; }
.rail-main-menu nav { display: grid; gap: 6px; }
.rail-main-menu .rmm-error { font-size: 12px; color: #ffe6b6; margin: 12px 0 0; }
.rail-main-menu .rmm-action {
  width: 100%; min-height: 52px; display: flex; align-items: center; gap: 14px;
  text-align: left; border: 1px solid transparent; border-radius: 5px;
  padding: 12px 15px; background: transparent; cursor: pointer;
  transition: background .16s, border-color .16s, transform .16s;
}
.rail-main-menu .rmm-action:hover { background: #f7f5ec12; border-color: #f7f5ec30; }
.rail-main-menu .rmm-action:active { transform: translateY(1px); }
.rail-main-menu .rmm-action svg { width: 21px; height: 21px; flex: 0 0 21px; }
.rail-main-menu .rmm-action-label { flex: 1; min-width: 0; }
.rail-main-menu .rmm-action strong { font-size: 16px; font-weight: 600; display: block; }
.rail-main-menu .rmm-action small { display: block; font-size: 12px; color: #ccd6c7; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 100%; }
.rail-main-menu .rmm-action .rmm-arrow { width: 18px; flex-basis: 18px; opacity: .5; }
.rail-main-menu .rmm-primary { background: var(--menu-cream); color: var(--menu-ink); border-color: #fff8; box-shadow: 0 4px 16px #081b2028; margin-bottom: 6px; min-height: 66px; }
.rail-main-menu .rmm-primary:hover { background: #fffdf4; border-color: #fff; }
.rail-main-menu .rmm-primary small { color: #566357; }
.rail-main-menu .rmm-primary .rmm-arrow { opacity: 1; color: var(--menu-green); }
.rail-main-menu .rmm-disabled { color: #b4c0b6; }
.rail-main-menu .rmm-disabled:hover { background: transparent; border-color: transparent; }
.rail-main-menu .rmm-disabled small { color: #a8b7ad; }
.rail-main-menu .rmm-footer { display: flex; justify-content: space-between; gap: 30px; align-items: flex-end; }
.rail-main-menu .rmm-hint { margin: 0; color: #c6cec2; font-size: 11px; display: flex; align-items: center; gap: 7px; }
.rail-main-menu kbd { font: inherit; border: 1px solid #9baea278; padding: 3px 6px; border-radius: 3px; color: #eef0e4; }
.rail-main-menu .rmm-caption { margin-left: auto; text-align: right; text-shadow: 0 2px 8px #10241f; }
.rail-main-menu .rmm-caption p { margin: 0; }
.rail-main-menu .rmm-caption-title { font: italic 25px/1.35 Georgia, serif; }
.rail-main-menu .rmm-caption-note { font-size: 10px; letter-spacing: .15em; text-transform: uppercase; color: #e5e8d9; padding-top: 5px; }
.rail-main-menu .rmm-motion {
  display: inline-flex; align-items: center; gap: 8px; background: #193529cc;
  border: 1px solid #cbd7c252; border-radius: 50px; padding: 9px 14px;
  min-height: 44px; cursor: pointer; font-size: 11px; white-space: nowrap;
}
.rail-main-menu .rmm-motion:hover { background: #345c49; }
.rail-main-menu .rmm-motion svg { width: 15px; height: 15px; }
.rail-main-menu[data-motion="paused"] .rmm-art img { animation-play-state: paused; }
.rail-main-menu[data-hidden="true"] .rmm-art img { animation-play-state: paused; }
@keyframes rmm-drift { from { transform: scale(1.015); } to { transform: scale(1.065); } }
@media (min-width: 1600px) {
  .rail-main-menu .rmm-layout { padding: 44px 64px 32px 6vw; }
  .rail-main-menu .rmm-main { padding-top: 50px; padding-bottom: 50px; }
  .rail-main-menu .rmm-rule { margin-block: 32px; }
  .rail-main-menu nav { gap: 10px; }
}
@media (max-height: 720px) and (min-width: 701px) {
  .rail-main-menu .rmm-layout { padding: 20px 32px; }
  .rail-main-menu .rmm-main { padding: 18px 0; }
  .rail-main-menu h1 { font-size: 72px; margin-bottom: 12px; }
  .rail-main-menu .rmm-rule { margin: 18px 0; }
  .rail-main-menu .rmm-content { width: 300px; }
}
@media (max-height: 520px) and (min-width: 601px) {
  .rail-main-menu .rmm-layout { padding: 14px max(22px, env(safe-area-inset-right)) 12px max(24px, env(safe-area-inset-left)); }
  .rail-main-menu .rmm-brand { font-size: 9px; }
  .rail-main-menu .rmm-brand-mark { width: 24px; height: 24px; }
  .rail-main-menu .rmm-top-note { font-size: 9px; }
  .rail-main-menu .rmm-main { padding: 6px 0; }
  .rail-main-menu .rmm-content { width: 275px; }
  .rail-main-menu h1 { font-size: 50px; margin-bottom: 7px; }
  .rail-main-menu .rmm-eyebrow, .rail-main-menu .rmm-rule, .rail-main-menu .rmm-tagline br { display: none; }
  .rail-main-menu .rmm-tagline { font-size: 12px; line-height: 1.4; margin-bottom: 12px; }
  .rail-main-menu nav { gap: 2px; }
  .rail-main-menu .rmm-action { min-height: 44px; padding: 7px 11px; }
  .rail-main-menu .rmm-action strong { font-size: 14px; }
  .rail-main-menu .rmm-action small { font-size: 10px; }
  .rail-main-menu .rmm-action:not(.rmm-primary) small { display: none; }
  .rail-main-menu .rmm-primary { margin-bottom: 2px; min-height: 48px; }
  .rail-main-menu .rmm-disabled { display: none; }
  .rail-main-menu .rmm-caption { position: absolute; right: 26px; bottom: 74px; }
  .rail-main-menu .rmm-caption-title { font-size: 19px; }
  .rail-main-menu .rmm-caption-note { font-size: 8px; }
  .rail-main-menu .rmm-veil { background: linear-gradient(90deg,#122a24fa 0%,#122a24ef 26%,#122a2490 44%,#14281c08 80%),linear-gradient(0deg,#12251cbf,transparent 40%); }
}
@media (max-width: 700px) and (min-height: 521px), (max-width: 600px) {
  .rail-main-menu .rmm-art { height: 44%; }
  .rail-main-menu .rmm-art img { object-position: 68% 45%; }
  .rail-main-menu .rmm-veil { background: linear-gradient(0deg,#172e27 57%,#172e27eb 63%,#172e2700 89%); }
  .rail-main-menu .rmm-layout { padding: max(20px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); min-height: max(100%, 620px); }
  .rail-main-menu .rmm-topline { text-shadow: 0 1px 4px #10241f; }
  .rail-main-menu .rmm-top-note { display: none; }
  .rail-main-menu .rmm-main { align-items: flex-end; padding: 145px 0 20px; }
  .rail-main-menu .rmm-content { width: 100%; max-width: 400px; margin-inline: auto; }
  .rail-main-menu h1 { font-size: 66px; margin-bottom: 10px; }
  .rail-main-menu .rmm-eyebrow { font-size: 10px; }
  .rail-main-menu .rmm-tagline { font-size: 14px; }
  .rail-main-menu .rmm-tagline br, .rail-main-menu .rmm-rule, .rail-main-menu .rmm-hint, .rail-main-menu .rmm-disabled { display: none; }
  .rail-main-menu nav { margin-top: 22px; gap: 4px; }
  .rail-main-menu .rmm-action { min-height: 48px; }
  .rail-main-menu .rmm-primary { min-height: 62px; }
  .rail-main-menu .rmm-caption { margin-left: 0; text-align: left; }
  .rail-main-menu .rmm-caption-title { display: none; }
  .rail-main-menu .rmm-caption-note { font-size: 9px; max-width: 140px; }
  .rail-main-menu .rmm-footer { gap: 12px; align-items: center; }
}
@media (hover: none) { .rail-main-menu .rmm-hint { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) {
  .rail-main-menu .rmm-action { transition: none; }
}
@media (forced-colors: active) {
  .rail-main-menu .rmm-action, .rail-main-menu .rmm-motion { border: 1px solid ButtonText; }
}
`;
