import { test, expect } from '@playwright/test';

test('Admin can navigate all ten modules in local sandbox without render crashes', async ({ page }) => {
  const runtimeErrors:string[]=[];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  const aside=page.getByRole('complementary',{name:'Admin modules navigation'});
  await expect(aside).toBeVisible();
  for (const title of [
    'Dashboard','Camps','Instructors','Students & Groups','Schedule',
    'Attendance','Finance','Reports','Operations','Settings',
  ]) {
    const button=aside.getByRole('button',{name:title,exact:true});
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-current','page');
    await expect(page.locator('main').first()).toBeVisible();
  }
  expect(runtimeErrors).toEqual([]);
});

test('local sandbox Instructor can reach Dashboard, Schedule, Check-in, Attendance and Profile',async({page})=>{
  const runtimeErrors:string[]=[];
  page.on('pageerror', error=>runtimeErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('complementary',{name:'Admin modules navigation'})
    .getByRole('button',{name:'Logout'}).click();
  await expect(page.getByRole('region',{name:'Local sandbox account selector'})).toBeVisible();
  await page.getByRole('region',{name:'Local sandbox account selector'})
    .getByRole('button',{name:/Instructor/}).first().click();
  const nav=page.getByRole('navigation',{name:'Instructor navigation'});
  await expect(nav).toBeVisible();
  for(const title of ['Home','Sessions','Check-in','Profile']){
    const button=nav.getByRole('button',{name:title,exact:true});
    await button.click();
    await expect(button).toHaveAttribute('aria-current','page');
    await expect(page.locator('main').first()).toBeVisible();
  }
  await expect(nav.getByRole('button',{name:'Attendance',exact:true})).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('sandbox-only identity chooser is visibly isolated from server production mode',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('LOCAL SANDBOX PREVIEW')).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Admin modules navigation'})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Admin modules navigation'}).locator('[data-cits-brand]')).toContainText('Operations Dashboard');
});

test('Take Attendance opens the clicked lecture rather than a previously selected lecture', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Admin modules navigation' })
    .getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('region', { name: 'Local sandbox account selector' })
    .getByRole('button', { name: /Instructor/ }).first().click();

  await expect(page.locator('.instructor-desktop-nav [data-cits-brand]')).toContainText('Instructor Workspace');
  await expect(page.locator('.instructor-desktop-nav [data-cits-brand] svg')).toHaveAttribute('aria-label','CITS LMS');
  const nav = page.getByRole('navigation', { name: 'Instructor navigation' });
  await nav.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator('[data-session-id="lec-d4-p1-g1"]').getByRole('button').click();
  await expect(page.getByRole('button',{name:'Back to Sessions'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Select lecture and group for attendance'})).toHaveCount(0);
  await nav.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.instructor-agenda .instructor-agenda-all')).toBeVisible();
  await expect(page.locator('.instructor-agenda-row').first()).toBeVisible();
  await expect(page.locator('.instructor-agenda-row').first()).toHaveAttribute('data-session-state', /^(upcoming|ready|running|finished|missed)$/);
  await page.getByRole('article').filter({hasText:'Minimum Spanning Trees & Disjoint Set Union'}).getByRole('button',{name:'Open session',exact:true}).click();

  // Dashboard P2 was clicked, so the attendance screen MUST switch to that
  // lecture and its roster, not use stale P1 state.
  await expect(nav.getByRole('button', { name: 'Sessions', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Selected lecture summary' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected lecture summary' })).toContainText('Minimum Spanning Trees & Disjoint Set Union');
  expect(runtimeErrors).toEqual([]);
});

test('one search immediately filters roster and shows other-group student with one-click visitor add', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', e => runtimeErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Admin modules navigation' })
    .getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('region', { name: 'Local sandbox account selector' })
    .getByRole('button', { name: /Instructor/ }).first().click();
  await page.getByRole('navigation', { name: 'Instructor navigation' })
    .getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator('[data-session-id="lec-d4-p2-g1"]').getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Selected lecture summary' })).toContainText('Draft');

  const search = page.getByRole('searchbox', { name: 'Search students by name or code' });
  await expect(search).toHaveCount(1);
  await search.fill('Omar Khaled');
  // The actual matching student card (not just a result count) must appear
  // immediately below the single search, with working attendance buttons.
  const ownResults = page.getByRole('group', { name: 'Matching students in this attendance sheet' });
  const ownStudent = ownResults.getByRole('group', { name: 'Attendance for Omar Khaled El-Sayed' });
  await expect(ownStudent).toBeVisible();
  await expect(ownStudent.locator('mark')).toHaveText('Omar Khaled');
  await expect(ownStudent.getByText('CITS-2601')).toBeVisible();
  await expect(ownStudent.getByText('In this group')).toBeVisible();
  await ownStudent.getByRole('button', { name: 'Late', exact: true }).click();
  await expect(ownStudent.getByRole('button', { name: 'Late', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Full attendance roster' })).toHaveCount(0);

  await search.fill('Youssef Amr');
  await expect(ownResults).toHaveCount(0);
  const visitors = page.getByRole('group', { name: 'Students from other groups' });
  await expect(visitors.getByText('Youssef Amr Nabil')).toBeVisible();
  await expect(visitors.locator('mark')).toHaveText('Youssef Amr');
  await expect(visitors.getByText(/Home group: GRP-BETA/)).toBeVisible();

  // One query and one click — never ask to type into a separate visitor box.
  await visitors.getByRole('button', { name: 'Add Youssef Amr Nabil as visitor' }).click();
  await expect(page.getByText('Youssef Amr Nabil added as visiting cross-group student.')).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(page.getByText('Youssef Amr Nabil', { exact: true })).toBeVisible();
  await expect(page.getByText('Visitor from', { exact: false }).last()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('attendance status chips filter roster, combine with name search and reset on lecture switch', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', e => runtimeErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Admin modules navigation' })
    .getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('region', { name: 'Local sandbox account selector' })
    .getByRole('button', { name: /Instructor/ }).first().click();
  await page.getByRole('navigation', { name: 'Instructor navigation' })
    .getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator('[data-session-id="lec-d4-p2-g1"]').getByRole('button').click();
  const chips = page.getByRole('group', { name: 'Filter attendance by status' });
  const roster = page.getByRole('region', { name: 'Full attendance roster' });
  const present = chips.getByRole('button', { name: /^Present\s+\d+/ });
  const unmarked = chips.getByRole('button', { name: /^Unmarked\s+\d+/ });
  const absent = chips.getByRole('button', { name: /^Absent\s+\d+/ });

  await expect(present).toContainText('2');
  await expect(unmarked).toContainText('3');
  await expect(absent).toContainText('0');

  await present.click();
  await expect(present).toHaveAttribute('aria-pressed', 'true');
  await expect(roster.getByRole('group', { name: /Attendance for / })).toHaveCount(2);
  await expect(roster.getByRole('group', { name: 'Attendance for Omar Khaled El-Sayed' })).toBeVisible();
  await expect(roster.getByRole('group', { name: 'Attendance for Ziad Tarek Abdelrahman' })).toHaveCount(0);

  await absent.click();
  await expect(roster.getByText('No students with this attendance status.')).toBeVisible();
  await roster.getByRole('button', { name: 'Show all students' }).click();
  await expect(chips.getByRole('button', { name: /^All\s+\d+/ })).toHaveAttribute('aria-pressed', 'true');

  await unmarked.click();
  await expect(roster.getByRole('group', { name: /Attendance for / })).toHaveCount(3);
  const ziadsCard = roster.getByRole('group', { name: 'Attendance for Ziad Tarek Abdelrahman' });
  await ziadsCard.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(ziadsCard).toHaveCount(0);
  await expect(unmarked).toContainText('2');
  await expect(present).toContainText('3');

  // Name and status are combined; selected marks are never modified by filtering.
  const search = page.getByRole('searchbox', { name: 'Search students by name or code' });
  await search.fill('Omar Khaled');
  await expect(chips.getByRole('button', { name: /^Unmarked\s+\d+/ })).toContainText('0');
  await present.click();
  const searchResults = page.getByRole('group', { name: 'Matching students in this attendance sheet' });
  await expect(searchResults.getByRole('group', { name: 'Attendance for Omar Khaled El-Sayed' })).toBeVisible();
  await expect(searchResults.getByRole('group', { name: /Attendance for / })).toHaveCount(1);

  // Prevent stale status filters from silently hiding the next group.
  await page.getByRole('button',{name:'Back to Sessions'}).click();
  await page.locator('[data-session-id="lec-d4-p1-g1"]').getByRole('button').click();
  await expect(chips.getByRole('button', { name: /^All\s+\d+/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(search).toHaveValue('');

  // A submitted lecture has one genuinely ABSENT student; the filter must
  // reveal only that student while preserving submitted read-only controls.
  await absent.click();
  await expect(roster.getByRole('group', { name: /Attendance for / })).toHaveCount(1);
  const absentStudent = roster.getByRole('group', { name: 'Attendance for Seif El-Din Hany' });
  await expect(absentStudent).toBeVisible();
  await expect(absentStudent.getByRole('button', { name: 'Absent', exact: true }))
    .toBeDisabled();
  await expect(roster.getByRole('group', { name: 'Attendance for Omar Khaled El-Sayed' }))
    .toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('Admin attendance shows compact server summary and on-demand corrections, filters still work', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', e => runtimeErrors.push(e.message));
  await page.goto('/');
  const nav = page.getByRole('complementary', { name: 'Admin modules navigation' });
  await nav.getByRole('button', { name: 'Attendance', exact: true }).click();

  const overview = page.getByRole('region', { name: 'Attendance overview' });
  await expect(overview).toBeVisible();
  await expect(overview.getByText('Camp attendance overview')).toBeVisible();
  await expect(overview.getByText('Lecture sheets')).toBeVisible();
  await expect(overview.getByText('Server-saved rows')).toBeVisible();

  const cards = page.getByRole('article', { name: /^Attendance sheet:/ });
  await expect(cards.first()).toBeVisible();
  // Avoid repeated yellow banners or risky final-submit buttons on every card.
  await expect(page.getByText('Final submission is disabled until the camp is active and the lecture date has arrived.')).toHaveCount(0);
  await expect(cards.first().getByText('Reason for audited corrections')).toHaveCount(0);
  await cards.first().getByRole('button', { name: 'View details' }).click();
  await expect(cards.first().getByText('Student attendance records')).toBeVisible();
  await expect(cards.first().getByText('Reason for audited corrections')).toBeVisible();
  await cards.first().getByRole('button', { name: 'Close details' }).click();
  await expect(cards.first().getByText('Reason for audited corrections')).toHaveCount(0);

  const statuses = page.getByRole('group', { name: 'Filter attendance sheets by status' });
  await statuses.getByRole('button', { name: /^Drafts/ }).click();
  await expect(statuses.getByRole('button', { name: /^Drafts/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.first()).toBeVisible();
  await statuses.getByRole('button', { name: /^All/ }).click();

  const search = page.getByRole('searchbox', { name: 'Search attendance sheets' });
  await search.fill('a-topic-that-does-not-exist-73893');
  await expect(page.getByText('No lecture sheets match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(search).toHaveValue('');
  await expect(cards.first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('Admin Finance reconciles primary, backup, transportation and immutable payments with Instructor self-view', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  const nav=page.getByRole('complementary',{name:'Admin modules navigation'});
  await nav.getByRole('button',{name:'Finance',exact:true}).click();
  const finance=page.getByRole('region',{name:'Complete instructor finance and settlements'});
  await expect(finance).toBeVisible();
  const table=finance.getByRole('table',{name:'Instructor payment statement'});
  const ahmed=table.getByRole('row').filter({hasText:'Dr. Ahmed Khalil'});
  const karim=table.getByRole('row').filter({hasText:'Eng. Karim Adel'});
  await expect(ahmed).toBeVisible();
  await expect(karim).toBeVisible();
  await expect(ahmed.locator('td').nth(4)).toContainText('750 EGP'); // primary
  await expect(ahmed.locator('td').nth(6)).toContainText('100 EGP'); // transport once
  await expect(ahmed.locator('td').nth(7)).toContainText('850 EGP'); // gross
  await expect(ahmed.locator('td').nth(8)).toContainText('250 EGP'); // paid
  await expect(ahmed.locator('td').nth(9)).toContainText('600 EGP'); // balance
  await expect(karim.locator('td').nth(5)).toContainText('150 EGP'); // backup only
  await expect(karim.locator('td').nth(6)).toContainText('0 EGP'); // no transport

  const search=finance.getByRole('searchbox',{name:'Search instructor accounts'});
  await search.fill('a-name-that-does-not-exist-73831');
  await expect(finance.getByText('No matching instructor')).toBeVisible();
  await search.fill('Ahmed Khalil');
  await expect(ahmed).toBeVisible();
  await finance.getByRole('combobox',{name:'Select instructor for primary rate edit'}).selectOption('inst-1');
  await finance.getByRole('spinbutton',{name:'New primary default rate'}).fill('900');
  await finance.getByRole('button',{name:'Update',exact:true}).click();
  await expect(finance.getByText(/Future primary lecture rate saved/)).toBeVisible();
  await expect(ahmed.locator('td').nth(7)).toContainText('850 EGP'); // frozen past preserved
  await search.clear();

  await ahmed.getByRole('button',{name:'View account'}).click();
  const detail=finance.getByRole('region',{name:'Selected instructor financial detail'});
  await expect(detail.getByText('Payment history — immutable')).toBeVisible();
  await expect(detail.getByText('Demo partial settlement')).toBeVisible();

  const payment=finance.getByRole('region',{name:'Payment and settlement entry'});
  await payment.getByRole('combobox',{name:'Select payment instructor'}).selectOption('inst-1');
  await payment.getByRole('spinbutton',{name:'Payment amount EGP'}).fill('200');
  await payment.getByRole('textbox',{name:'Payment audit note'}).fill('Second partial payment');
  await payment.getByRole('button',{name:'Review & post transaction'}).click();
  await page.getByRole('button',{name:'Post transaction',exact:true}).click();
  await expect(ahmed.locator('td').nth(8)).toContainText('450 EGP');
  await expect(ahmed.locator('td').nth(9)).toContainText('400 EGP');
  await expect(finance.getByText('Second partial payment')).toBeVisible();

  // Record a new unscheduled backup: no Instructor Schedule / Group assignment.
  const rateConfig=finance.getByRole('region',{name:'Finance setup and audit actions'});
  await rateConfig.getByRole('combobox',{name:'Backup lecture'}).selectOption('lec-d4-p2-g1');
  await rateConfig.getByRole('combobox',{name:'Backup instructor'}).selectOption('inst-3');
  await rateConfig.getByRole('textbox',{name:'Attendance evidence / reason'}).fill('Supported after lunch during second period');
  await rateConfig.getByRole('button',{name:'Record backup (pending)'}).click();
  await expect(finance.getByText(/Backup session recorded as Pending Review/)).toBeVisible();
  await expect(karim.locator('td').nth(5)).toContainText('150 EGP'); // still only approved
  await search.fill('Karim Adel');
  await karim.getByRole('button',{name:'View account'}).click();
  await expect(finance.getByRole('region',{name:'Selected instructor financial detail'})).toContainText('Pending review');

  // Main/backup details are private to the signed-in Instructor.
  await nav.getByRole('button',{name:'Logout'}).click();
  await page.getByRole('region',{name:'Local sandbox account selector'})
    .getByRole('button',{name:/Instructor.*Ahmed Khalil/}).first().click();
  await page.getByRole('navigation',{name:'Instructor navigation'})
    .getByRole('button',{name:'Profile',exact:true}).click();
  await expect(page.getByRole('button',{name:'Session History'})).toHaveCount(0);
  const own=page.getByRole('region',{name:'Teaching progress'});
  await expect(own).toBeVisible();
  await expect(own).not.toContainText('EGP');
  await expect(page.locator('main').first()).not.toContainText('EGP');
  await expect(own).not.toContainText('Eng. Karim Adel');
  await page.getByRole('button',{name:'Personal Info',exact:true}).click();
  await expect(page.getByRole('region',{name:'Personal information'})).toBeVisible();
  await page.getByRole('button',{name:'My Groups',exact:true}).click();
  await expect(page.getByRole('region',{name:'Assigned training groups'})).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});


test('Admin sidebar opens on hover, pins on demand, and persists the preference', async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Admin modules navigation' });
  const navigate = sidebar.getByRole('button', { name: 'Students & Groups', exact: true });
  await expect(navigate).toBeVisible();
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  // Collapse to icons; hover expands within the layout without covering content.
  await expect(sidebar).toHaveCSS('width', '72px');
  await page.mouse.move(1000, 600);
  await expect(navigate.getByText('Students & Groups')).toHaveCount(0);
  const main = page.locator('main').first();
  const before = await main.boundingBox();
  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width', '240px');
  await expect(navigate.getByText('Students & Groups')).toBeVisible();
  const sidebarRect = await sidebar.boundingBox();
  const mainRect = await main.boundingBox();
  expect(before && sidebarRect && mainRect).toBeTruthy();
  // No overlay: left-to-right workspace starts after the expanded sidebar.
  expect(sidebarRect!.x + sidebarRect!.width).toBeLessThanOrEqual(mainRect!.x + 2);
  expect(mainRect!.x).toBeGreaterThan(before!.x + 140);
  await sidebar.getByRole('button', { name: 'Pin sidebar open' }).click();
  await page.mouse.move(1000, 600);
  await expect(navigate.getByText('Students & Groups')).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '240px');
});

test('Admin mobile glass tabs navigate and More opens hidden modules', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Schedule' })).toHaveAttribute('aria-current','page');
  await bar.getByRole('button', { name: 'More', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'More sections' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Students & Groups', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current','page');
});

test('Instructor mobile glass tabs reach check-in and attendance without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // Local sandbox account switcher is a dev-only test helper.
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('complementary', { name: 'Admin modules navigation' })
    .getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('region', { name: 'Local sandbox account selector' })
    .getByRole('button', { name: /Instructor/ }).first().click();
  const bar = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Check-in', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Check-in' })).toHaveAttribute('aria-current','page');
  await expect(bar.getByRole('button',{name:'Attendance',exact:true})).toHaveCount(0);
  await bar.getByRole('button',{name:'Sessions',exact:true}).click();
  await page.locator('[data-session-id="lec-d4-p2-g1"]').getByRole('button').click();
  await expect(bar.getByRole('button',{name:'Sessions'})).toHaveAttribute('aria-current','page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});


test('Instructor responsive layout uses four equal bottom tabs and compact profile in LTR and RTL', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Open navigation menu'}).click();
  await page.getByRole('complementary',{name:'Admin modules navigation'}).getByRole('button',{name:'Logout'}).click();
  await page.getByRole('region',{name:'Local sandbox account selector'}).getByRole('button',{name:/Instructor/}).first().click();
  const bar=page.locator('.instructor-bottom-nav');
  for(const width of [320,390,430,820]){
    await page.setViewportSize({width,height:844});
    await expect(bar).toBeVisible();
    await expect(page.locator('.instructor-desktop-nav')).toBeHidden();
    await expect(bar.getByRole('button')).toHaveCount(4);
    for(const route of ['Home','Sessions','Check-in','Profile']){
      await bar.getByRole('button',{name:route,exact:true}).click();
      await expect(page.locator('.instructor-main')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
      const header=page.locator('.instructor-topbar');
      await expect(header).toBeVisible();
      expect(await header.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
      expect(await header.evaluate(el=>getComputedStyle(el).marginTop)).toBe('0px');
      await expect(header.getByRole('combobox',{name:'Select working Camp'})).toBeVisible();
      await expect(header.getByText('Instructor Portal',{exact:true})).toHaveCount(0);
      await expect(header.locator('.instructor-topbar-day')).toHaveText(/Day \d+\/\d+/);
      const campBounds=await header.locator('.instructor-topbar-camp').boundingBox();
      const dayBounds=await header.locator('.instructor-topbar-day').boundingBox();
      expect(Math.abs(campBounds!.y+campBounds!.height/2-dayBounds!.y-dayBounds!.height/2)).toBeLessThan(2);
      await expect(header.getByRole('button',{name:'Toggle theme'})).toBeVisible();
      const headBounds=await header.boundingBox();
      expect(headBounds!.x).toBeGreaterThanOrEqual(0);
      expect(headBounds!.x+headBounds!.width).toBeLessThanOrEqual(width+1);
      const bounds=await bar.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(11);
      expect(Math.abs(bounds!.x - (width-bounds!.x-bounds!.width))).toBeLessThan(2);
      expect(bounds!.width).toBeGreaterThanOrEqual(Math.min(width-24,520)-2);
      expect(bounds!.width).toBeLessThanOrEqual(Math.min(width-24,520)+1);
      expect(844-bounds!.y-bounds!.height).toBeGreaterThanOrEqual(9);
      expect(await bar.evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(25);
      const widths=await bar.getByRole('button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().width));
      expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(2);
    }
    if(width<640){
      expect((await page.locator('.instructor-profile-banner').boundingBox())!.height).toBeLessThan(230);
      await bar.getByRole('button',{name:'Profile',exact:true}).click();
      await page.getByRole('button',{name:'Personal Info',exact:true}).click();
      await expect(page.getByRole('region',{name:'Personal information'})).toBeVisible();
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Switch Language'}).click();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await bar.getByRole('button',{name:'حسابي',exact:true}).click();
  await expect(page.locator('.instructor-profile-banner')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  const rtlBounds=await bar.boundingBox();
  expect(rtlBounds!.x).toBeGreaterThanOrEqual(11);
  expect(Math.abs(rtlBounds!.x-(390-rtlBounds!.x-rtlBounds!.width))).toBeLessThan(2);
  expect(rtlBounds!.width).toBeGreaterThanOrEqual(364);
  expect(rtlBounds!.width).toBeLessThanOrEqual(367);
  await page.setViewportSize({width:1365,height:900});
  await expect(bar).toBeHidden();
  await expect(page.locator('.instructor-desktop-nav')).toBeVisible();
  const rail=page.locator('.instructor-curved-sidebar');
  const verifyAttachedRail=async()=>{
    const geometry=await rail.evaluate(el=>{
      const css=getComputedStyle(el), corner=getComputedStyle(el,'::before'), rect=el.getBoundingClientRect();
      return {top:rect.top,bottom:window.innerHeight-rect.bottom,outer:css.borderEndEndRadius,inner:css.borderStartEndRadius,shadow:css.boxShadow,gradient:css.backgroundImage,curve:corner.content,curveWidth:corner.width,curveBackground:corner.backgroundImage};
    });
    expect(Math.abs(geometry.top)).toBeLessThan(1);
    expect(Math.abs(geometry.bottom)).toBeLessThan(1);
    expect(geometry.outer).toBe('24px');
    expect(geometry.inner).toBe('0px');
    expect(geometry.shadow).toBe('none');
    expect(geometry.gradient).toContain('linear-gradient');
    expect(geometry.curve).not.toBe('none');
    expect(geometry.curveWidth).toBe('24px');
    expect(geometry.curveBackground).toContain('radial-gradient');
  };
  await verifyAttachedRail();
  const nav=rail.getByRole('navigation');
  for(const route of ['الرئيسية','المحاضرات','الوصول','حسابي']){
    await nav.getByRole('button',{name:route,exact:true}).click();
    const active=nav.locator('[aria-current="page"]');
    await expect(active).toHaveCount(1);
    expect(await active.evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
    expect(await active.evaluate(el=>getComputedStyle(el).borderTopLeftRadius)).toBe('13px');
  }
  const header=page.locator('.instructor-topbar');
  await expect(header.getByRole('combobox')).toHaveCount(1);
  await expect(header.getByRole('button',{name:'الإشعارات'})).toBeVisible();
  await header.getByRole('button',{name:'الإشعارات'}).click();
  await expect(header.getByRole('button',{name:'إغلاق',exact:true})).toBeVisible();
  await header.getByRole('button',{name:'إغلاق',exact:true}).click();
});

test('RTL Graphite sidebar unpin, mouse-leave, and persisted collapsed reload never blank the screen', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('pageerror', err => jsErrors.push(err.message));
  await page.setViewportSize({ width: 1790, height: 900 });
  await page.goto('/');
  const main = page.locator('main').first();
  const sidebar = page.getByRole('complementary', { name: /Admin modules navigation|قائمة وحدات الإدارة/ });
  await expect(sidebar).toBeVisible();
  await page.getByRole('button', { name: 'Switch Light or Dark Theme' }).click();
  await page.getByRole('button', { name: 'Switch Language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(main).toBeVisible();

  // Regression: deployed preview used mobileNavOpen in a derived expression
  // before declaration. Collapsing from an unhovered state unmounted React.
  await page.getByRole('button', { name: 'طي أو توسيع القائمة الجانبية' }).click();
  await page.mouse.move(250, 500);
  await expect(main).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '72px');
  expect(jsErrors).toEqual([]);

  // The same collapsed preference must survive a reload (old preview crashed).
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '72px');
  await expect(main).toBeVisible();
  expect(jsErrors).toEqual([]);

  // Returning to RTL after reload also exercises the collapsed persisted state.
  await page.getByRole('button', { name: 'Switch Language' }).click();
  await page.getByRole('button', { name: 'تبديل المظهر الفاتح أو الداكن' }).click();
  // Hover expands within layout; verify no intersection in RTL as well.
  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width','240px');
  const sidebarRect = await sidebar.boundingBox();
  const mainRect = await main.boundingBox();
  expect(sidebarRect && mainRect).toBeTruthy();
  expect(mainRect!.x + mainRect!.width).toBeLessThanOrEqual(sidebarRect!.x + 2);
  await expect(sidebar.getByRole('button', { name: 'تثبيت القائمة مفتوحة' })).toBeVisible();
  await sidebar.getByRole('button', { name: 'تثبيت القائمة مفتوحة' }).click();
  await page.mouse.move(250, 500);
  await expect(sidebar).toHaveCSS('width', '240px');
  await expect(main).toBeVisible();
  expect(jsErrors).toEqual([]);
});


test('desktop Sidebar expanded content never obscures the header in English and RTL', async ({ page }) => {
  const runtimeErrors:string[] = [];
  page.on('pageerror',error=>runtimeErrors.push(error.message));
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/');
  const sidebar=page.getByRole('complementary',{name:/Admin modules navigation|قائمة وحدات الإدارة/});
  const header=page.locator('header').first();
  const checkSeparate=async()=>{
    const s=await sidebar.boundingBox(), h=await header.boundingBox();
    expect(s && h).toBeTruthy();
    const separated=(s!.x+s!.width<=h!.x+2)||(h!.x+h!.width<=s!.x+2);
    expect(separated).toBeTruthy();
    await expect(page.locator('main').first()).toBeVisible();
  };
  await checkSeparate();
  await page.getByRole('button',{name:'Toggle sidebar'}).click();
  await page.mouse.move(900,500);
  await expect(sidebar).toHaveCSS('width','72px');
  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width','240px');
  await checkSeparate();
  await page.mouse.move(900,500);
  await expect(sidebar).toHaveCSS('width','72px');
  await checkSeparate();
  await page.getByRole('button',{name:'Switch Language'}).click();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width','240px');
  await checkSeparate();
  expect(runtimeErrors).toEqual([]);
});
