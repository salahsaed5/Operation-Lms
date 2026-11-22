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
  await expect(page.getByText('Attendance roster for the selected lecture only')).toBeVisible();
  await expect(page.getByText('Minimum Spanning Trees & Disjoint Set Union').last()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
