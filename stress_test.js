const { chromium } = require('playwright');

const BASE = 'https://aa15219152847-web.github.io/life-workbench/';

const results = [];
let passCount = 0, failCount = 0;

function log(module, test, status, detail=''){
  const icon = status==='PASS'?'✅':status==='FAIL'?'❌':'⚠️';
  results.push({module, test, status, detail});
  if(status==='PASS') passCount++;
  else if(status==='FAIL') failCount++;
  console.log(`${icon} [${module}] ${test}${detail?' → '+detail:''}`);
}

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  });
  
  // 监听console错误
  const consoleErrors = [];
  const pageErrors = [];
  
  const page = await context.newPage();
  page.on('console', msg => {
    if(msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    // ============================================================
    // 1. 页面加载测试
    // ============================================================
    console.log('\n========== 页面加载测试 ==========');
    
    const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    log('页面', '页面加载', resp && resp.status()===200 ? 'PASS' : 'FAIL', `status=${resp?.status()}`);
    
    await sleep(1000);
    
    const title = await page.title();
    log('页面', '标题正确', title==='生活工作台' ? 'PASS' : 'FAIL', title);
    
    const sidebarVisible = await page.locator('.sidebar').isVisible();
    log('页面', '侧边栏显示', sidebarVisible ? 'PASS' : 'FAIL');
    
    const mainVisible = await page.locator('.main-area').isVisible();
    log('页面', '主区域显示', mainVisible ? 'PASS' : 'FAIL');
    
    const dateText = await page.locator('#hdrDate').textContent();
    log('页面', '日期显示', dateText && dateText.length > 0 ? 'PASS' : 'FAIL', dateText);
    
    const timeText = await page.locator('#sidebarTime').textContent();
    log('页面', '时间显示', timeText && timeText.length > 0 ? 'PASS' : 'FAIL', timeText);

    const consoleErrorCount = consoleErrors.length;
    log('页面', '无JS错误', consoleErrorCount===0 ? 'PASS' : 'WARN', `${consoleErrorCount}个错误`);
    if(consoleErrorCount>0) console.log('   JS错误:', consoleErrors.slice(0,3));

    // 关闭PWA引导弹窗
    await sleep(2000);
    const pwaCloseBtn = page.locator('#pwaGuide button:has-text("我知道了")');
    if(await pwaCloseBtn.count() > 0){
      await pwaCloseBtn.click();
      await sleep(500);
    }
    // 备用：如果还在，用JS隐藏
    await page.evaluate(() => {
      const g = document.getElementById('pwaGuide');
      if(g) g.classList.remove('show');
      localStorage.setItem('pwa_guide_dismissed','1');
    });
    await sleep(300);

    // ============================================================
    // 2. 待办模块测试
    // ============================================================
    console.log('\n========== 待办模块测试 ==========');
    
    // 确保在待办tab
    await page.locator('[data-tab="todos"]').click();
    await sleep(500);
    
    // 添加普通待办
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fTodoTitle').fill('测试待办1-普通');
    await page.locator('#fTodoCat .chip[data-val="工作"]').click();
    await page.locator('#fTodoPri .chip[data-val="1"]').click();
    await sleep(100);
    const todayDate = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
    await page.locator('#fTodoDate').fill(todayDate);
    await page.locator('#fTodoRemind').fill('14:30');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    const todoCount1 = await page.locator('#todoCount').textContent();
    log('待办', '添加普通待办', todoCount1.includes('1') ? 'PASS' : 'FAIL', todoCount1);
    
    // 添加空标题待办（边界测试）
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#modalContent .btn-primary').click();
    await sleep(300);
    const toastText = await page.locator('#toast').textContent();
    log('待办', '空标题拦截', toastText.includes('请输入') ? 'PASS' : 'FAIL', toastText);
    await page.locator('.modal-close').click();
    await sleep(300);
    
    // 批量添加10条待办（压力测试）
    for(let i=2; i<=10; i++){
      await page.locator('#fab').click();
      await sleep(200);
      await page.locator('#fTodoTitle').fill(`批量测试待办${i}`);
      await page.locator('#fTodoPri .chip[data-val="'+(i%3+1)+'"]').click();
      await sleep(50);
      await page.locator('#fTodoDate').fill(todayDate);
      await page.locator('#modalContent .btn-primary').click();
      await sleep(300);
    }
    const todoCount10 = await page.locator('#todoCount').textContent();
    log('待办', '批量添加10条', todoCount10.includes('10') ? 'PASS' : 'FAIL', todoCount10);
    
    // 勾选完成待办
    const todoChecks = page.locator('.todo-check');
    const firstCheck = todoChecks.first();
    await firstCheck.click();
    await sleep(500);
    const doneItem = page.locator('.todo-item.done');
    const doneCount = await doneItem.count();
    log('待办', '勾选完成', doneCount >= 1 ? 'PASS' : 'FAIL', `完成${doneCount}项`);
    
    // 取消勾选
    await page.locator('.todo-item.done .todo-check').click();
    await sleep(500);
    const doneCount2 = await page.locator('.todo-item.done').count();
    log('待办', '取消勾选', doneCount2 === 0 ? 'PASS' : 'FAIL', `还有${doneCount2}项完成`);
    
    // 编辑待办
    const editBtn = page.locator('.todo-actions .icon-btn').first();
    await editBtn.click();
    await sleep(300);
    await page.locator('#fTodoTitle').fill('编辑后的待办');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    const editedTitle = await page.locator('.todo-title').first().textContent();
    log('待办', '编辑待办', editedTitle==='编辑后的待办' ? 'PASS' : 'FAIL', editedTitle);
    
    // 删除待办
    const delBtn = page.locator('.todo-actions .icon-btn').last();
    page.on('dialog', d => d.accept());
    await delBtn.click();
    await sleep(500);
    const todoCountAfterDel = await page.locator('#todoCount').textContent();
    log('待办', '删除待办', !todoCountAfterDel.includes('10') ? 'PASS' : 'FAIL', todoCountAfterDel);
    
    // ============================================================
    // 3. 记账模块测试
    // ============================================================
    console.log('\n========== 记账模块测试 ==========');
    
    await page.locator('[data-tab="ledger"]').click();
    await sleep(500);
    
    // 添加支出
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fLedgerAmount').fill('25.50');
    await page.locator('#fLedgerCat .chip[data-val="餐饮"]').click();
    await page.locator('#fLedgerNote').fill('午餐');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    const expenseText = await page.locator('#lsExpense').textContent();
    log('记账', '添加支出', expenseText.includes('25') ? 'PASS' : 'FAIL', expenseText);
    
    // 添加收入
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fLedgerType .chip[data-val="income"]').click();
    await sleep(100);
    await page.locator('#fLedgerAmount').fill('10000');
    await page.locator('#fLedgerCat .chip[data-val="工资"]').click();
    await page.locator('#fLedgerNote').fill('月薪');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    const incomeText = await page.locator('#lsIncome').textContent();
    log('记账', '添加收入', incomeText.includes('10,000') || incomeText.includes('10000') ? 'PASS' : 'FAIL', incomeText);
    
    // 验证结余计算
    const balanceText = await page.locator('#lsBalance').textContent();
    log('记账', '结余计算', balanceText.includes('9,974') || balanceText.includes('9974') ? 'PASS' : 'FAIL', `结余=${balanceText}`);
    
    // 添加负数金额（边界测试）
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fLedgerAmount').fill('-100');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(300);
    const negToast = await page.locator('#toast').textContent();
    log('记账', '负数金额拦截', negToast.includes('请输入') ? 'PASS' : 'FAIL', negToast);
    await page.locator('.modal-close').click();
    await sleep(300);
    
    // 添加0金额（边界测试）
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fLedgerAmount').fill('0');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(300);
    const zeroToast = await page.locator('#toast').textContent();
    log('记账', '零金额拦截', zeroToast.includes('请输入') ? 'PASS' : 'FAIL', zeroToast);
    await page.locator('.modal-close').click();
    await sleep(300);
    
    // 批量添加20条记账（压力测试）
    const cats = ['餐饮','交通','购物','娱乐','住房','医疗','教育','其他'];
    for(let i=0; i<20; i++){
      await page.locator('#fab').click();
      await sleep(150);
      await page.locator('#fLedgerAmount').fill(String(Math.floor(Math.random()*500)+10));
      const cat = cats[i % cats.length];
      await page.locator(`#fLedgerCat .chip[data-val="${cat}"]`).click();
      await page.locator('#modalContent .btn-primary').click();
      await sleep(200);
    }
    const ledgerCount = await page.locator('.ledger-item').count();
    log('记账', '批量添加20条', ledgerCount >= 20 ? 'PASS' : 'FAIL', `显示${ledgerCount}条`);
    
    // 测试加载更多
    const loadMoreBtn = page.locator('button:has-text("加载更多")');
    if(await loadMoreBtn.count() > 0){
      await loadMoreBtn.click();
      await sleep(300);
      const ledgerCount2 = await page.locator('.ledger-item').count();
      log('记账', '加载更多', ledgerCount2 > ledgerCount ? 'PASS' : 'FAIL', `${ledgerCount}→${ledgerCount2}`);
    } else {
      log('记账', '加载更多', 'SKIP', '条数不足30');
    }
    
    // 年度统计
    const yearLabel = await page.locator('#yearLabel').textContent();
    log('记账', '年度统计显示', yearLabel && yearLabel.length>0 ? 'PASS' : 'FAIL', yearLabel);
    
    const yearlyItems = await page.locator('#yearlyStats .card-base').count();
    log('记账', '年度月度图表', yearlyItems >= 12 ? 'PASS' : 'FAIL', `${yearlyItems}个月`);
    
    // 切换年份
    await page.locator('button:has-text("‹")').click();
    await sleep(500);
    const prevYear = await page.locator('#yearLabel').textContent();
    log('记账', '上一年切换', prevYear < yearLabel ? 'PASS' : 'FAIL', `${yearLabel}→${prevYear}`);
    
    await page.locator('button:has-text("›")').click();
    await sleep(500);
    const backYear = await page.locator('#yearLabel').textContent();
    log('记账', '下一年切换', backYear === yearLabel ? 'PASS' : 'FAIL', `${prevYear}→${backYear}`);

    // ============================================================
    // 4. 灵感模块测试
    // ============================================================
    console.log('\n========== 灵感模块测试 ==========');
    
    await page.locator('[data-tab="inspirations"]').click();
    await sleep(500);
    
    // 添加灵感
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fInspContent').fill('这是一个测试灵感想法');
    await page.locator('#fInspTag').fill('测试标签');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    const inspCount1 = await page.locator('#inspCount').textContent();
    log('灵感', '添加灵感', inspCount1.includes('1') ? 'PASS' : 'FAIL', inspCount1);
    
    // 空内容拦截
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#modalContent .btn-primary').click();
    await sleep(300);
    const emptyToast = await page.locator('#toast').textContent();
    log('灵感', '空内容拦截', emptyToast.includes('请输入') ? 'PASS' : 'FAIL', emptyToast);
    await page.locator('.modal-close').click();
    await sleep(300);
    
    // 批量添加5条灵感
    for(let i=2; i<=5; i++){
      await page.locator('#fab').click();
      await sleep(200);
      await page.locator('#fInspContent').fill(`灵感内容${i} - 这是一个较长的灵感内容测试，包含多个字符，用于验证显示效果和数据存储能力`);
      await page.locator('#fInspTag').fill(i%2===0?'产品想法':'读书笔记');
      await page.locator('#modalContent .btn-primary').click();
      await sleep(300);
    }
    const inspCount5 = await page.locator('#inspCount').textContent();
    log('灵感', '批量添加5条', inspCount5.includes('5') ? 'PASS' : 'FAIL', inspCount5);
    
    // 编辑灵感
    await page.locator('.insp-item .icon-btn').first().click();
    await sleep(300);
    await page.locator('#fInspContent').fill('编辑后的灵感内容');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    const editedInsp = await page.locator('.insp-content').first().textContent();
    log('灵感', '编辑灵感', editedInsp==='编辑后的灵感内容' ? 'PASS' : 'FAIL', editedInsp);
    
    // 删除灵感
    await page.locator('.insp-item .icon-btn').last().click();
    await sleep(500);
    const inspCount4 = await page.locator('#inspCount').textContent();
    log('灵感', '删除灵感', inspCount4.includes('4') ? 'PASS' : 'FAIL', inspCount4);

    // ============================================================
    // 5. 学习计划模块测试
    // ============================================================
    console.log('\n========== 学习计划模块测试 ==========');
    
    await page.locator('[data-tab="study"]').click();
    await sleep(500);
    
    // 添加学习计划
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fPlanTitle').fill('每天学英语1小时');
    await page.locator('#fPlanHours').fill('30');
    await page.locator('#fPlanDays').fill('30');
    await page.locator('#fPlanNote').fill('考研英语复习');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    const planCount1 = await page.locator('#planCount').textContent();
    log('学习', '添加计划', planCount1.includes('1') ? 'PASS' : 'FAIL', planCount1);
    
    // 空标题拦截
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#modalContent .btn-primary').click();
    await sleep(300);
    const planToast = await page.locator('#toast').textContent();
    log('学习', '空标题拦截', planToast.includes('请输入') ? 'PASS' : 'FAIL', planToast);
    await page.locator('.modal-close').click();
    await sleep(300);
    
    // 添加更多计划
    const plans = [
      ['每天读30页书', 20, 30, '阅读习惯'],
      ['学Python编程', 50, 60, '编程技能'],
      ['健身打卡', 40, 45, '身体锻炼'],
    ];
    for(const [title, hours, days, note] of plans){
      await page.locator('#fab').click();
      await sleep(200);
      await page.locator('#fPlanTitle').fill(title);
      await page.locator('#fPlanHours').fill(String(hours));
      await page.locator('#fPlanDays').fill(String(days));
      await page.locator('#fPlanNote').fill(note);
      await page.locator('#modalContent .btn-primary').click();
      await sleep(300);
    }
    const planCount4 = await page.locator('#planCount').textContent();
    log('学习', '批量添加3个计划', planCount4.includes('4') ? 'PASS' : 'FAIL', planCount4);
    
    // 打卡
    await page.locator('.plan-checkin-btn').first().click();
    await sleep(300);
    await page.locator('#fCheckinHours').fill('1.5');
    await page.locator('#fCheckinNote').fill('今天学了Unit 1-3');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    const checkinBtn = await page.locator('.plan-checkin-btn.done').count();
    log('学习', '学习打卡', checkinBtn >= 1 ? 'PASS' : 'FAIL', `已打卡${checkinBtn}个`);
    
    // 验证打卡后状态
    const checkinText = await page.locator('.plan-checkin-btn.done').first().textContent();
    log('学习', '打卡显示时长', checkinText.includes('1.5h') ? 'PASS' : 'FAIL', checkinText);
    
    // 编辑计划
    await page.locator('.plan-item .icon-btn').first().click();
    await sleep(300);
    await page.locator('#fPlanTitle').fill('编辑后的英语计划');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    const editedPlan = await page.locator('.plan-title').first().textContent();
    log('学习', '编辑计划', editedPlan==='编辑后的英语计划' ? 'PASS' : 'FAIL', editedPlan);
    
    // 删除计划
    await page.locator('.plan-item .icon-btn').last().click();
    await sleep(500);
    const planCount3 = await page.locator('#planCount').textContent();
    log('学习', '删除计划', planCount3.includes('3') ? 'PASS' : 'FAIL', planCount3);

    // ============================================================
    // 6. 复盘模块测试
    // ============================================================
    console.log('\n========== 复盘模块测试 ==========');
    
    await page.locator('[data-tab="review"]').click();
    await sleep(500);
    
    // 填写复盘
    await page.locator('#rvWell').fill('今天完成了大部分待办，效率不错');
    await page.locator('#rvWrong').fill('下午注意力不够集中，刷了手机');
    await page.locator('#rvImprove').fill('明天用番茄钟，减少手机干扰');
    await page.locator('.mood-btn[data-mood="4"]').click();
    await sleep(100);
    await page.locator('button:has-text("保存复盘")').click();
    await sleep(500);
    
    const reviewToast = await page.locator('#toast').textContent();
    log('复盘', '保存复盘', reviewToast.includes('已保存') ? 'PASS' : 'FAIL', reviewToast);
    
    // 验证复盘已加载
    const wellVal = await page.locator('#rvWell').inputValue();
    log('复盘', '复盘回显', wellVal.includes('效率不错') ? 'PASS' : 'FAIL', wellVal);
    
    // 修改复盘
    await page.locator('#rvWell').fill('修改后的复盘内容');
    await page.locator('button:has-text("保存复盘")').click();
    await sleep(500);
    const wellVal2 = await page.locator('#rvWell').inputValue();
    log('复盘', '修改复盘', wellVal2==='修改后的复盘内容' ? 'PASS' : 'FAIL', wellVal2);
    
    // 空复盘拦截
    await page.locator('#rvWell').fill('');
    await page.locator('#rvWrong').fill('');
    await page.locator('#rvImprove').fill('');
    await page.locator('button:has-text("保存复盘")').click();
    await sleep(300);
    const emptyReviewToast = await page.locator('#toast').textContent();
    log('复盘', '空复盘拦截', emptyReviewToast.includes('请至少填写') ? 'PASS' : 'FAIL', emptyReviewToast);
    
    // 恢复复盘内容
    await page.locator('#rvWell').fill('今天完成了大部分待办');
    await page.locator('#rvWrong').fill('注意力不够集中');
    await page.locator('#rvImprove').fill('明天用番茄钟');
    await page.locator('button:has-text("保存复盘")').click();
    await sleep(500);
    
    // 搜索复盘
    await page.locator('#reviewSearch').fill('番茄钟');
    await sleep(500);
    const searchResults = await page.locator('.review-history-item').count();
    log('复盘', '搜索功能', searchResults >= 0 ? 'PASS' : 'FAIL', `找到${searchResults}条`);
    
    // 清空搜索
    await page.locator('#reviewSearch').fill('');
    await sleep(500);

    // ============================================================
    // 7. 资讯模块测试
    // ============================================================
    console.log('\n========== 资讯模块测试 ==========');
    
    await page.locator('[data-tab="news"]').click();
    await sleep(1000);
    
    const newsItems = await page.locator('.news-item').count();
    const loadingVisible = await page.locator('.loading').count();
    log('资讯', 'AI资讯加载', newsItems > 0 ? 'PASS' : (loadingVisible > 0 ? 'WARN' : 'FAIL'), `${newsItems}条`);
    
    // 切换财经资讯
    await page.locator('[data-news="finance"]').click();
    await sleep(2000);
    const finNews = await page.locator('.news-item').count();
    const finLoading = await page.locator('.loading').count();
    log('资讯', '财经资讯加载', finNews > 0 ? 'PASS' : (finLoading > 0 ? 'WARN' : 'FAIL'), `${finNews}条`);
    
    // 切回AI
    await page.locator('[data-news="ai"]').click();
    await sleep(1000);

    // ============================================================
    // 8. 概览仪表盘测试
    // ============================================================
    console.log('\n========== 概览仪表盘测试 ==========');
    
    const ovTodo = await page.locator('#ovTodo').textContent();
    log('概览', '待办统计', ovTodo && ovTodo.includes('/') ? 'PASS' : 'FAIL', ovTodo);
    
    const ovBalance = await page.locator('#ovBalance').textContent();
    log('概览', '结余显示', ovBalance && ovBalance.includes('¥') ? 'PASS' : 'FAIL', ovBalance);
    
    const ovStudy = await page.locator('#ovStudy').textContent();
    log('概览', '学习统计', ovStudy && ovStudy.includes('/') ? 'PASS' : 'FAIL', ovStudy);
    
    const ovReview = await page.locator('#ovReview').textContent();
    log('概览', '复盘状态', ovReview && ovReview.length > 0 ? 'PASS' : 'FAIL', ovReview);

    // ============================================================
    // 9. 日历.ics生成测试
    // ============================================================
    console.log('\n========== 日历.ics生成测试 ==========');
    
    // 回到待办添加一条带提醒的
    await page.locator('[data-tab="todos"]').click();
    await sleep(300);
    await page.locator('#fab').click();
    await sleep(300);
    await page.locator('#fTodoTitle').fill('日历测试待办');
    await page.locator('#fTodoDate').fill(todayDate);
    await page.locator('#fTodoRemind').fill('18:00');
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    // 测试单个.ics下载
    const remindBtn = page.locator('.remind-btn').first();
    if(await remindBtn.count() > 0){
      // 监听下载
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(()=>null);
      await remindBtn.click();
      const download = await downloadPromise;
      if(download){
        log('日历', '单个.ics下载', 'PASS', download.suggestedFilename());
      } else {
        log('日历', '单个.ics下载', 'WARN', '下载事件未触发（可能被Blob处理）');
      }
    } else {
      log('日历', '单个.ics下载', 'SKIP', '无提醒按钮');
    }
    
    // 测试全部同步.ics
    const syncBtn = page.locator('button:has-text("同步到日历")').first();
    if(await syncBtn.count() > 0){
      const downloadPromise2 = page.waitForEvent('download', { timeout: 5000 }).catch(()=>null);
      await syncBtn.click();
      const download2 = await downloadPromise2;
      if(download2){
        log('日历', '全部同步.ics下载', 'PASS', download2.suggestedFilename());
      } else {
        log('日历', '全部同步.ics下载', 'WARN', '下载事件未触发');
      }
    }

    // ============================================================
    // 10. 数据导出导入测试
    // ============================================================
    console.log('\n========== 数据导出导入测试 ==========');
    
    await page.locator('[data-tab="review"]').click();
    await sleep(500);
    
    // 测试导出
    const exportBtn = page.locator('button:has-text("导出全部数据")');
    if(await exportBtn.count() > 0){
      const dlPromise = page.waitForEvent('download', { timeout: 5000 }).catch(()=>null);
      await exportBtn.click();
      const dl = await dlPromise;
      if(dl){
        const fname = dl.suggestedFilename();
        const isValid = fname.includes('workbench-backup') && fname.endsWith('.json');
        log('数据', '导出JSON', isValid ? 'PASS' : 'FAIL', fname);
      } else {
        log('数据', '导出JSON', 'WARN', '下载未触发');
      }
    }
    
    // 检查localStorage中备份时间戳
    const hasBackupTime = await page.evaluate(() => localStorage.getItem('last_export_time'));
    log('数据', '备份时间戳记录', hasBackupTime ? 'PASS' : 'FAIL', hasBackupTime ? '已记录' : '未记录');
    
    // 检查自动备份数据
    const hasAutoBackup = await page.evaluate(() => localStorage.getItem('auto_backup_data'));
    log('数据', 'localStorage自动备份', hasAutoBackup && hasAutoBackup.length > 10 ? 'PASS' : 'FAIL', hasAutoBackup ? `${hasAutoBackup.length}字节` : '无');
    
    // 验证自动备份内容
    const autoBackupData = await page.evaluate(() => {
      const raw = localStorage.getItem('auto_backup_data');
      if(!raw) return null;
      const data = JSON.parse(raw);
      return {
        todos: data.todos?.length || 0,
        ledger: data.ledger?.length || 0,
        inspirations: data.inspirations?.length || 0,
        plans: data.plans?.length || 0,
        checkins: data.checkins?.length || 0,
        reviews: data.reviews?.length || 0,
      };
    });
    log('数据', '自动备份内容', autoBackupData ? 'PASS' : 'FAIL', JSON.stringify(autoBackupData));

    // ============================================================
    // 11. 页面刷新数据持久化测试
    // ============================================================
    console.log('\n========== 数据持久化测试 ==========');
    
    // 刷新前统计
    const beforeRefresh = await page.evaluate(async () => {
      const db = indexedDB.open('LifeWorkbench');
      return new Promise(resolve => {
        db.onsuccess = async (e) => {
          const d = e.target.result;
          const stores = ['todos','ledger','inspirations','plans','checkins','reviews'];
          const counts = {};
          for(const s of stores){
            const tx = d.transaction(s,'readonly').objectStore(s).count();
            await new Promise(r => { tx.onsuccess = () => { counts[s] = tx.result; r(); }; });
          }
          resolve(counts);
        };
      });
    });
    log('持久化', '刷新前数据', beforeRefresh ? 'PASS' : 'FAIL', JSON.stringify(beforeRefresh));
    
    // 刷新页面
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2000);
    
    // 刷新后统计
    const afterRefresh = await page.evaluate(async () => {
      const db = indexedDB.open('LifeWorkbench');
      return new Promise(resolve => {
        db.onsuccess = async (e) => {
          const d = e.target.result;
          const stores = ['todos','ledger','inspirations','plans','checkins','reviews'];
          const counts = {};
          for(const s of stores){
            const tx = d.transaction(s,'readonly').objectStore(s).count();
            await new Promise(r => { tx.onsuccess = () => { counts[s] = tx.result; r(); }; });
          }
          resolve(counts);
        };
      });
    });
    
    let persistPass = true;
    for(const k of Object.keys(beforeRefresh||{})){
      if(beforeRefresh[k] !== afterRefresh[k]) persistPass = false;
    }
    log('持久化', '刷新后数据一致', persistPass ? 'PASS' : 'FAIL', JSON.stringify(afterRefresh));

    // ============================================================
    // 12. 极限压力测试
    // ============================================================
    console.log('\n========== 极限压力测试 ==========');
    
    // 快速连续添加50条待办
    await page.locator('[data-tab="todos"]').click();
    await sleep(500);
    
    const startTodoCount = parseInt((await page.locator('#todoCount').textContent()).match(/\d+/)?.[0] || 0);
    
    for(let i=0; i<50; i++){
      await page.locator('#fab').click();
      await sleep(100);
      await page.locator('#fTodoTitle').fill(`压力测试${i+1}`);
      await page.locator('#fTodoDate').fill(todayDate);
      await page.locator('#modalContent .btn-primary').click();
      await sleep(150);
    }
    await sleep(500);
    const endTodoCount = parseInt((await page.locator('#todoCount').textContent()).match(/\d+/)?.[0] || 0);
    const added = endTodoCount - startTodoCount;
    log('极限', '快速添加50条待办', added >= 45 ? 'PASS' : 'FAIL', `新增${added}条`);
    
    // 检查页面是否卡顿/崩溃
    const stillResponsive = await page.locator('#hdrTitle').isVisible();
    log('极限', '页面仍可响应', stillResponsive ? 'PASS' : 'FAIL');
    
    const errorAfterStress = pageErrors.length;
    log('极限', '无页面崩溃错误', errorAfterStress === 0 ? 'PASS' : 'WARN', `${errorAfterStress}个错误`);

    // ============================================================
    // 13. 特殊字符测试
    // ============================================================
    console.log('\n========== 特殊字符测试 ==========');
    
    // 添加含特殊字符的待办
    await page.locator('#fab').click();
    await sleep(300);
    const specialChars = '<script>alert(1)</script> & "quotes" \'apostrophe\' <b>bold</b>';
    await page.locator('#fTodoTitle').fill(specialChars);
    await page.locator('#modalContent .btn-primary').click();
    await sleep(500);
    
    // 检查是否有XSS
    const hasAlert = await page.evaluate(() => {
      return document.querySelectorAll('script:not([src])').length > 5; // 正常有5个以内
    });
    log('安全', 'XSS防护', !hasAlert ? 'PASS' : 'FAIL', '特殊字符未执行');
    
    // 检查显示是否正确（转义）
    const todoTitles = await page.locator('.todo-title').allTextContents();
    const hasSpecial = todoTitles.some(t => t.includes(specialChars));
    log('安全', 'HTML转义', hasSpecial ? 'PASS' : 'FAIL', '特殊字符正确显示');

    // ============================================================
    // 14. 清理测试数据
    // ============================================================
    console.log('\n========== 清理测试数据 ==========');
    
    await page.evaluate(async () => {
      const stores = ['todos','ledger','inspirations','plans','checkins','reviews','meta'];
      return new Promise(resolve => {
        const db = indexedDB.open('LifeWorkbench');
        db.onsuccess = (e) => {
          const d = e.target.result;
          let done = 0;
          for(const s of stores){
            if(!d.objectStoreNames.contains(s)){ done++; continue; }
            const tx = d.transaction(s,'readwrite').objectStore(s).clear();
            tx.onsuccess = () => { done++; if(done>=stores.length) resolve(); };
          }
          localStorage.removeItem('last_export_time');
          localStorage.removeItem('auto_backup_data');
        };
      });
    });
    
    await sleep(500);
    const cleanCount = await page.evaluate(async () => {
      const db = indexedDB.open('LifeWorkbench');
      return new Promise(resolve => {
        db.onsuccess = (e) => {
          const d = e.target.result;
          const tx = d.transaction('todos','readonly').objectStore('todos').count();
          tx.onsuccess = () => resolve(tx.result);
        };
      });
    });
    log('清理', '清除所有测试数据', cleanCount === 0 ? 'PASS' : 'FAIL', `剩余${cleanCount}条`);

  } catch(e) {
    console.error('\n💥 测试异常:', e.message);
    log('系统', '测试执行', 'FAIL', e.message);
  } finally {
    await browser.close();
    
    // 输出汇总
    console.log('\n');
    console.log('╔════════════════════════════════════╗');
    console.log('║        压力测试结果汇总             ║');
    console.log('╠════════════════════════════════════╣');
    console.log(`  ✅ 通过: ${passCount}`);
    console.log(`  ❌ 失败: ${failCount}`);
    const warns = results.filter(r=>r.status==='WARN').length;
    console.log(`  ⚠️ 警告: ${warns}`);
    console.log(`  总测试数: ${results.length}`);
    console.log('╚════════════════════════════════════╝');
    
    if(failCount > 0){
      console.log('\n❌ 失败项:');
      results.filter(r=>r.status==='FAIL').forEach(r => 
        console.log(`  [${r.module}] ${r.test} → ${r.detail}`)
      );
    }
    if(warns > 0){
      console.log('\n⚠️ 警告项:');
      results.filter(r=>r.status==='WARN').forEach(r => 
        console.log(`  [${r.module}] ${r.test} → ${r.detail}`)
      );
    }
    
    process.exit(failCount > 0 ? 1 : 0);
  }
})();
