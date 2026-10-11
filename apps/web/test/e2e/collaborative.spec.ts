import { test, expect } from '@playwright/test';

test.describe('Milestone 7: Collaborative Whiteboard E2E Suite', () => {
  test('Single-User: Renders canvas, toolbar, tools, and theme toggle', async ({ page }) => {
    // Generate a unique board id
    const boardId = '00000000-0000-0000-0000-000000000001';
    await page.goto(`/b/${boardId}`);

    // Verify canvas renders
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Verify topbar presence
    await expect(page.locator('header')).toBeVisible();

    // Verify toolbar is visible with tool buttons
    const selectBtn = page.locator('button[data-tooltip*="Select"]');
    const rectBtn = page.locator('button[data-tooltip*="Rectangle"]');
    const ellipseBtn = page.locator('button[data-tooltip*="Ellipse"]');
    const penBtn = page.locator('button[data-tooltip*="Pen"]');
    const textBtn = page.locator('button[data-tooltip*="Text"]');

    await expect(selectBtn).toBeVisible();
    await expect(rectBtn).toBeVisible();
    await expect(ellipseBtn).toBeVisible();
    await expect(penBtn).toBeVisible();
    await expect(textBtn).toBeVisible();

    // Test Theme Toggle
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();
    const htmlTheme = await page.locator('html').getAttribute('data-theme');
    expect(htmlTheme).toBe('dark');
  });

  test('Drawing: Select rectangle tool and draw on canvas', async ({ page }) => {
    const boardId = '00000000-0000-0000-0000-000000000002';
    await page.goto(`/b/${boardId}`);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Select Rectangle tool
    const rectBtn = page.locator('button[data-tooltip*="Rectangle"]');
    await rectBtn.click();

    // Drag on canvas to draw a rectangle
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(box.x + 350, box.y + 300, { steps: 5 });
      await page.mouse.up();
    }

    // After drawing, layers panel should show 1 object
    await page.waitForTimeout(300);
    const layerItem = page.locator('text=Rectangle');
    await expect(layerItem).toBeVisible();
  });

  test('Undo / Redo controls work reliably', async ({ page }) => {
    const boardId = '00000000-0000-0000-0000-000000000003';
    await page.goto(`/b/${boardId}`);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Draw an ellipse
    const ellipseBtn = page.locator('button[data-tooltip*="Ellipse"]');
    await ellipseBtn.click();

    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(box.x + 320, box.y + 320, { steps: 5 });
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(page.locator('text=Ellipse')).toBeVisible();

    // Click Undo
    const undoBtn = page.locator('button[aria-label="Undo (Ctrl+Z)"]');
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();

    await page.waitForTimeout(200);
    await expect(page.locator('text=Ellipse')).not.toBeVisible();

    // Click Redo
    const redoBtn = page.locator('button[aria-label="Redo (Ctrl+Shift+Z)"]');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();

    await page.waitForTimeout(200);
    await expect(page.locator('text=Ellipse')).toBeVisible();
  });
});
