/** Isolated visual/interaction check. Requires Playwright; never connects to the real database.
 * pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4178
 * node scripts/check-ui-readability.cjs [output-directory]
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const output = process.argv[2] || await fs.mkdtemp(path.join(os.tmpdir(), 'fyj-readability-'));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        const stages = ['SAVED', 'APPLIED', 'ASSESSMENT', 'WRITTEN', 'INTERVIEWING', 'OC', 'INTENT', 'OFFER', 'SIGNED', 'REJECTED', 'WITHDRAWN'];
        const date = new Date().toISOString();
        const jobs = Array.from({ length: 24 }, (_, i) => ({
          id: `sample-${i}`, companyId: `company-${i}`, companyName: i % 3 === 0 ? '示例先进技术研究院南京软件研发中心' : `示例科技 ${i + 1}`,
          department: i % 4 === 0 ? '人工智能基础设施与平台技术部' : null,
          positionTitle: i % 2 === 0 ? '2027 届人工智能平台软件研发工程师' : '软件工程师',
          status: i < 16 ? 'SAVED' : ['APPLIED', 'INTERVIEWING', 'OC', 'OFFER', 'REJECTED', 'SIGNED', 'APPLIED', 'INTERVIEWING'][i - 16],
          channel: 'COMPANY_SITE', batch: 'FORMAL', priority: 'MEDIUM', tags: [], workLocation: '南京市',
          appliedDate: i < 16 ? null : date, resumeVersionId: i < 16 ? null : 'resume-1', resumeVersionName: i < 16 ? null : '研发岗版',
          isArchived: false, createdAt: date, updatedAt: date, interviewCount: i > 16 ? 2 : 0,
          maxInterviewRound: i > 16 ? 2 : 0, hasScheduledInterview: false, hasOverdueInterview: false,
        }));
        const questions = Array.from({ length: 6 }, (_, i) => ({
          questionId: `q-${i}`, interviewId: 'interview', question: i % 2 ? '如何设计可靠的缓存淘汰策略？' : '为什么注意力分数要除以 $\\sqrt{d_k}$？',
          myAnswer: '先说明设计目标，再分析内存开销、访问局部性和边界情况。'.repeat(3),
          reflection: '结合具体的工作负载评估，确保回答包含取舍和验证方法。\n\n$$Attention(Q,K,V)=softmax(QK^T/\\sqrt{d_k})V$$',
          quality: ['GOOD', 'BAD', 'OK'][i % 3], tags: ['系统设计'], round: i < 3 ? 2 : 1, roundLabel: '技术面',
          applicationId: 'sample-17', companyName: '示例先进技术研究院', positionTitle: '软件工程师',
        }));
        if (localStorage.getItem('qa-compact') === '1') jobs.splice(2, 14);
        window.__qaCalls = [];
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback: () => 1,
          invoke: async (cmd, args = {}) => {
            window.__qaCalls.push({ cmd, args });
            if (cmd === 'get_setting') return args.key === 'onboarded' ? 'true' : args.key === 'board_columns' ? JSON.stringify(stages) : null;
            if (cmd === 'db_ready') return { ok: true, applications: jobs.length, companies: jobs.length, events: 14, recoveryMode: false };
            if (cmd === 'list_applications') return jobs.filter(job => (!args.filter?.statuses?.length || args.filter.statuses.includes(job.status)) && (!args.filter?.search || job.companyName.includes(args.filter.search)));
            if (cmd === 'list_all_questions') return questions;
            if (cmd === 'list_companies') return jobs.slice(0, 18).map(job => ({ id: job.companyId, name: job.companyName, aliases: ['研发中心'], nature: '研究所', industry: '互联网/软件', careersUrl: 'https://example.com/jobs', applicationCount: 1 }));
            if (cmd === 'list_resumes') return ['研发岗版', '算法岗版', '基础架构版'].map((name, i) => ({ id: `resume-${i}`, name, isDefault: i === 0, targetRole: '软件研发', fileName: '示例简历.pdf', fileSize: 256000, usageCount: i + 2, notes: '突出工程实践与系统设计能力。' }));
            if (cmd === 'get_stats') return { wishlistCount: 16, statusCounts: stages.map(key => ({ key, count: jobs.filter(j => j.status === key).length })), stageReachedCounts: stages.slice(1, 9).map((key, i) => ({ key, count: 8 - i })), channelCounts: [{ key: 'COMPANY_SITE', count: 8 }], batchCounts: [{ key: 'FORMAL', count: 8 }], dailyApplied: [{ key: date.slice(0, 10), count: 3 }], silent: [], resumeFunnel: [] };
            if (cmd === 'get_upcoming' || cmd === 'get_calendar_items') return jobs.slice(16, 20).map(j => ({ kind: 'interview', applicationId: j.id, companyName: j.companyName, positionTitle: j.positionTitle, detail: '2', at: date }));
            if (cmd === 'local_api_status') return { enabled: false, running: false, port: 17865, token: 'synthetic-token' };
            if (cmd === 'llm_get_settings') return { baseUrl: '', model: '', apiKeyConfigured: false };
            if (cmd.startsWith('plugin:')) return 1;
            if (['list_dictionary', 'list_custom_event_types', 'search_companies'].includes(cmd)) return [];
            if (cmd === 'reorder_applications') return null;
            throw new Error(`Unexpected IPC during isolated QA: ${cmd}`);
          },
        };
      });
      await page.goto('http://127.0.0.1:4178/applications');
      await page.locator('.job-card').first().waitFor();
      assert.equal(await page.locator('.job-card').count(), 24);
      assert.equal(await page.locator('.dark').count(), colorScheme === 'dark' ? 1 : 0);
      const colors = await page.locator('.kanban-lane').first().evaluate(lane => ({
        lane: getComputedStyle(lane).backgroundColor,
        card: getComputedStyle(lane.querySelector('.job-card')).backgroundColor,
      }));
      assert.notEqual(colors.lane, colors.card);
      await page.screenshot({ path: path.join(output, `${colorScheme}-board.png`) });

      // Header-only feedback must remain consistent for an occupied and an empty lane.
      await page.evaluate(() => localStorage.setItem('qa-compact', '1'));
      await page.reload();
      await page.locator('.job-card').first().waitFor();
      await page.getByRole('button', { name: /显示全部状态/ }).click();
      for (const [from, target, drop] of [['SAVED', 'APPLIED', 'allowed'], ['APPLIED', 'WRITTEN', 'allowed'], ['SAVED', 'ASSESSMENT', 'blocked']]) {
        const card = page.locator(`.kanban-lane[data-status="${from}"] .job-card`).first();
        await card.scrollIntoViewIfNeeded();
        const source = await card.boundingBox();
        await page.mouse.move(source.x + 70, source.y + 35);
        await page.mouse.down();
        await page.mouse.move(source.x + 85, source.y + 45, { steps: 5 });
        const lane = page.locator(`.kanban-lane[data-status="${target}"]`);
        await lane.scrollIntoViewIfNeeded();
        const destination = await lane.boundingBox();
        await page.mouse.move(destination.x + destination.width - 35, destination.y + 35, { steps: 12 });
        await page.screenshot({ path: path.join(output, `${colorScheme}-drag-${target}.png`) });
        await page.waitForFunction(({ status, drop }) => document.querySelector(`.kanban-lane[data-status="${status}"]`)?.dataset.drop === drop,
          { status: target, drop });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal(await page.locator('.kanban-lane[data-drop]').count(), 0);
      }
      assert.equal(await page.evaluate(() => window.__qaCalls.filter(c => c.cmd === 'reorder_applications').length), 0);
      await page.evaluate(() => localStorage.removeItem('qa-compact'));
      await page.reload();
      await page.getByRole('button', { name: '表格', exact: true }).click();
      const table = page.locator('.application-table');
      await table.waitFor();
      assert.equal(await table.locator('thead th').count(), 9);
      const rows = table.locator('tbody tr');
      const rowColors = await rows.evaluateAll(rows => rows.slice(0, 2).map(row => getComputedStyle(row).backgroundColor));
      assert.notEqual(rowColors[0], rowColors[1]);
      assert.equal(await rows.first().locator('td').nth(6).evaluate(td => getComputedStyle(td).whiteSpace), 'nowrap');
      await page.screenshot({ path: path.join(output, `${colorScheme}-table.png`) });

      for (const route of ['companies', 'review', 'resumes', 'stats', 'calendar', 'offers', 'settings', '']) {
        await page.goto(`http://127.0.0.1:4178/${route}`);
        await page.locator('.page-header').waitFor();
        await page.waitForTimeout(350);
        assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, `Overflow on ${route}`);
        await page.screenshot({ path: path.join(output, `${colorScheme}-${route || 'dashboard'}.png`) });
        if (route === 'review') {
          assert.equal(await page.locator('.review-question').count(), 6);
          const top = await page.locator('.page-header').evaluate(el => el.getBoundingClientRect().top);
          await page.locator('main').evaluate(el => { el.scrollTop = 500; });
          assert.equal(await page.locator('.page-header').evaluate(el => el.getBoundingClientRect().top), top);
        }
      }
      await page.setViewportSize({ width: 960, height: 640 });
      await page.goto('http://127.0.0.1:4178/applications');
      await page.getByRole('button', { name: '看板', exact: true }).click();
      await page.locator('.job-card').first().waitFor();
      assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `${colorScheme}-narrow-board.png`) });
      assert.deepEqual(errors, []);
      console.log(`${colorScheme}: layout, striped rows, drop cancellation, all pages, fixed header and 960px window passed`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`Synthetic screenshots: ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
