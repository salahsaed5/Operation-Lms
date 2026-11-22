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
  for(const title of ['Dashboard','Schedule','Check-in','Attendance','Profile']){
    const button=nav.getByRole('button',{name:title,exact:true});
    await button.click();
    await expect(button).toHaveAttribute('aria-current','page');
    await expect(page.locator('main').first()).toBeVisible();
  }
  expect(runtimeErrors).toEqual([]);
});

test('sandbox-only identity chooser is visibly isolated from server production mode',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('LOCAL SANDBOX PREVIEW')).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Admin modules navigation'})).toBeVisible();
});

test('Take Attendance opens the clicked lecture rather than a previously selected lecture', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Admin modules navigation' })
    .getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('region', { name: 'Local sandbox account selector' })
    .getByRole('button', { name: /Instructor/ }).first().click();

  const nav = page.getByRole('navigation', { name: 'Instructor navigation' });
  await nav.getByRole('button', { name: 'Attendance', exact: true }).click();
  const lecturePicker = page.getByRole('combobox', { name: 'Select lecture and group for attendance' });
  // Simulate the actual reported bug: the attendance screen previously had P1 selected.
  await lecturePicker.selectOption('lec-d4-p1-g1');
  await expect(lecturePicker).toHaveValue('lec-d4-p1-g1');

  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Take Attendance', exact: true }).click();

  // Dashboard P2 was clicked, so the attendance screen MUST switch to that
  // lecture and its roster, not use stale P1 state.
  await expect(nav.getByRole('button', { name: 'Attendance', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  await expect(lecturePicker).toHaveValue('lec-d4-p2-g1');
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
    .getByRole('button', { name: 'Attendance', exact: true }).click();

  // The default P1 sheet is already SUBMITTED in the sandbox fixtures.
  // Select editable P2 to test the visitor-add interaction.
  await page.getByRole('combobox', { name: 'Select lecture and group for attendance' })
    .selectOption('lec-d4-p2-g1');
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
    .getByRole('button', { name: 'Attendance', exact: true }).click();

  const lecturePicker = page.getByRole('combobox', { name: 'Select lecture and group for attendance' });
  await lecturePicker.selectOption('lec-d4-p2-g1');
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
  await lecturePicker.selectOption('lec-d4-p1-g1');
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

test('Admin Finance summarizes instructors, edits future rate only and provides audited lecture drill-down', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  const nav = page.getByRole('complementary', { name: 'Admin modules navigation' });
  await nav.getByRole('button', { name: 'Finance', exact: true }).click();
  const statement = page.getByRole('region', { name: 'Instructor financial statements' });
  await expect(statement.getByText('Instructor financial statements')).toBeVisible();
  await expect(statement.getByText('Verified entitlement total')).toBeVisible();
  await expect(statement.getByText('Potential if pending approved')).toBeVisible();
  const instructorTable = statement.getByRole('table');
  const ahmed = instructorTable.getByRole('row').filter({ hasText: 'Dr. Ahmed Khalil' });
  await expect(ahmed).toBeVisible();
  const verifiedBefore = await ahmed.locator('td').nth(6).innerText();
  const scheduledBefore = await ahmed.locator('td').nth(1).innerText();
  await expect(ahmed.locator('td').nth(5)).toContainText('750 EGP');

  // Search filters the grouped ledger by instructor code without altering totals.
  const search = statement.getByRole('searchbox', { name: 'Find instructor statement' });
  await search.fill('a-name-that-does-not-exist-73768');
  await expect(statement.getByText('No instructors match this search.')).toBeVisible();
  await search.fill('Ahmed Khalil');
  await expect(ahmed).toBeVisible();
  await ahmed.getByRole('button', { name: 'Edit rate' }).click();
  const rateInput = page.getByRole('spinbutton', { name: 'New default EGP / lecture' });
  await expect(rateInput).toHaveValue('750');
  await rateInput.fill('900');
  await page.getByRole('button', { name: 'Save future rate' }).click();
  await expect(ahmed.locator('td').nth(5)).toContainText('900 EGP');
  await expect(ahmed.locator('td').nth(6)).toHaveText(verifiedBefore);
  await expect(ahmed.locator('td').nth(1)).toHaveText(scheduledBefore);
  await expect(page.getByText(/Previously scheduled lectures and verified financial amounts remain unchanged/))
    .toBeVisible();

  await ahmed.getByRole('button', { name: 'Lectures' }).click();
  const detail = page.getByRole('region', { name: 'Individual lecture entitlement ledger' });
  await expect(detail.getByText('Individual lecture decisions')).toBeVisible();
  await expect(detail.getByText('Viewing lectures for:')).toBeVisible();
  await detail.getByRole('button', { name: 'Show all instructors' }).click();
  await detail.getByRole('button', { name: 'Hide lecture details' }).click();
  await expect(detail.getByRole('button', { name: 'Show lecture details' })).toBeVisible();

  // Number of lectures is changed in Schedule, never via fake ledger quantities.
  await statement.getByRole('button', { name: 'Open Schedule' }).click();
  await expect(nav.getByRole('button', { name: 'Schedule', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  expect(runtimeErrors).toEqual([]);
});
