const bootScreen = document.querySelector('#boot-screen');
const dashboard = document.querySelector('#dashboard');
const countdown = document.querySelector('#countdown');
let seconds = 6;
let introTimer;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showDashboard() {
  clearInterval(introTimer);
  bootScreen.classList.add('is-leaving');
  setTimeout(() => {
    bootScreen.hidden = true;
    dashboard.hidden = false;
  }, prefersReducedMotion ? 0 : 420);
}

function startIntro() {
  dashboard.hidden = true;
  bootScreen.hidden = false;
  bootScreen.classList.remove('is-leaving');
  seconds = 6;
  countdown.textContent = String(seconds).padStart(2, '0');
  clearInterval(introTimer);
  introTimer = setInterval(() => {
    seconds -= 1;
    countdown.textContent = String(Math.max(seconds, 0)).padStart(2, '0');
    if (seconds <= 0) showDashboard();
  }, 1000);
}

document.querySelector('#skip-intro').addEventListener('click', showDashboard);
document.querySelector('#replay-intro').addEventListener('click', startIntro);

const recommendations = [
  '午前は開業準備を20分。午後にInstagramの投稿を1本仕上げると、今週の計画にきれいに乗れます。',
  '集中力は良好です。最初の90分を事業計画に使えば、今日の重要タスクを前倒しできます。',
  '午後の予定まで余白があります。投稿の下書きを先に作り、夕方は散歩でリセットしましょう。'
];
let recommendationIndex = 0;
document.querySelector('#refresh-brief').addEventListener('click', () => {
  recommendationIndex = (recommendationIndex + 1) % recommendations.length;
  const target = document.querySelector('#recommendation');
  if (!prefersReducedMotion) target.animate([{opacity:.2, transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}], {duration:340});
  target.textContent = recommendations[recommendationIndex];
});

const contexts = [
  ['Home studio', '深い作業に最適な環境です'],
  ['移動中', '次の予定まで、あと42分です'],
  ['お気に入りのカフェ', '軽いタスクとアイデア出しに向いています']
];
let contextIndex = 0;
document.querySelector('#change-context').addEventListener('click', () => {
  contextIndex = (contextIndex + 1) % contexts.length;
  document.querySelector('#location-name').textContent = contexts[contextIndex][0];
  document.querySelector('#location-copy').textContent = contexts[contextIndex][1];
});

document.querySelector('#draft-post').addEventListener('click', (event) => {
  event.currentTarget.innerHTML = 'アイデア：個人事業の準備ログ <span>✓</span>';
});

document.querySelectorAll('#task-list li button').forEach((button) => {
  button.addEventListener('click', () => {
    button.parentElement.classList.toggle('done');
    const done = document.querySelectorAll('#task-list li.done').length;
    document.querySelector('#task-progress').textContent = `${done} / 4`;
  });
});

function updateClock() {
  const now = new Date();
  document.querySelector('#header-clock').textContent = new Intl.DateTimeFormat('ja-JP', {hour:'2-digit', minute:'2-digit', hour12:false}).format(now);
  document.querySelector('#header-date').textContent = new Intl.DateTimeFormat('en-US', {weekday:'short', month:'short', day:'2-digit'}).format(now).toUpperCase();
}
updateClock();
setInterval(updateClock, 30000);

setInterval(() => {
  const steps = document.querySelector('#step-count');
  const current = Number(steps.textContent.replace(',', ''));
  if (Math.random() > .55) steps.textContent = (current + 1).toLocaleString('en-US');
}, 5000);

startIntro();
