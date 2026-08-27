/* 关闭应用时，main.js 的关闭守卫会先问渲染进程「要不要把这套存成 Look」，并等一个
   明确的回答（不设时限 —— 人可能正在想名字，超时强关等于替他做了「不保存」的决定）。
   测试里没有人去点那个浮层，所以 app.close() 会一直挂着。
   这里统一替它按「不保存退出」——走的是真实流程，不是绕过守卫。

   用法：把每个 spec 里 finally 中的 app.close() 换成 closeApp(app, win)。 */
async function closeApp(app, win) {
  if (!app) return;
  const closing = app.close().catch(() => {});
  if (win) {
    try {
      await win.waitForFunction(() => {
        const el = document.getElementById('exitSavePrompt');
        return !!el && getComputedStyle(el).display !== 'none';
      }, null, { timeout: 5000 });
      await win.evaluate(() => document.getElementById('exitSaveNoBtn').click());
    } catch (e) {
      // 浮层没出现（页面还没跑完、或这个版本还没有这个功能）——直接等它自己关掉
    }
  }
  await closing;
}

module.exports = { closeApp };
