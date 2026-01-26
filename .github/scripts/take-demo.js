const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = ".github/demo";
const APP_URL = "http://localhost:41520";

async function takeDemo() {
  const browser = await chromium.launch();

  // Create a browser context with video recording enabled
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: DEMO_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await context.newPage();

  try {
    // Navigate to the app
    await page.goto(APP_URL);

    // Wait for app to fully load (sidebar with services)
    await page.waitForTimeout(3000);

    // 1. Home screenshot - app once loaded
    console.log("Taking home screenshot...");
    await page.screenshot({ path: `${DEMO_DIR}/home.png` });

    // 2. New Project screenshot - open the new project form (optional)
    // Only take this screenshot if the New Project button is present
    console.log("Checking for New Project button...");
    const newProjectButton = page.locator('button[aria-label="New Project"], button:has(svg.octicon-plus)').first();

    if ((await newProjectButton.count()) > 0 && (await newProjectButton.isVisible())) {
      console.log("Taking new project screenshot...");
      await newProjectButton.click();

      // Wait for the project form tab to appear and be active
      const newProjectTab = page.locator('.tab-item:has-text("New Project")');
      await newProjectTab.waitFor({ state: 'visible', timeout: 5000 });

      // Click on the tab to ensure it's active
      await newProjectTab.click();
      await page.waitForTimeout(500);

      // Wait for the form content - look for the project selector or Name input
      // The form has a project selector dropdown and form fields
      await page.waitForSelector('input[placeholder="Project name"], select', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);

      await page.screenshot({ path: `${DEMO_DIR}/newproject.png` });

      // Close the tab by clicking the close button
      const closeButton = page.locator('button[aria-label="Close New Project"]');
      if ((await closeButton.count()) > 0) {
        await closeButton.click();
      }
      await page.waitForTimeout(500);
    } else {
      console.log("New Project button not found, skipping screenshot");
    }

    // 3. Call screenshot - click first method, run it, wait for results
    console.log("Taking call screenshot...");

    // Click on the first method in the sidebar tree
    // Methods are in TreeView items, look for clickable items
    const methodItem = page.locator('[role="treeitem"]').first();
    await methodItem.click();
    await page.waitForTimeout(500);

    // Press F5 to run the method
    await page.keyboard.press("F5");

    // Wait for console results to appear
    // The console shows output in pre tags or buttons with "output"
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${DEMO_DIR}/call.png` });

    // 4. Compiler screenshot - click Compiler button and expand first project
    console.log("Taking compiler screenshot...");

    // Click the Compiler button (CPU icon in sidebar header)
    const compilerButton = page.locator('button:has(svg[class*="octicon-cpu"])');
    if ((await compilerButton.count()) > 0) {
      await compilerButton.click();
    } else {
      // Fallback: look for button with aria-label
      await page.locator('button[aria-label*="ompiler"]').click();
    }
    await page.waitForTimeout(1000);

    // Expand the first compiled project by clicking on the ActionList.Item
    // Try multiple selectors since Primer components can render differently
    const selectors = [
      '.compiler-item-wrapper >> li',
      '.compiler-item-wrapper [role="option"]',
      '.compiler-item-wrapper button',
      '[class*="ActionListItem"]',
    ];

    let clicked = false;
    for (const selector of selectors) {
      const item = page.locator(selector).first();
      if ((await item.count()) > 0) {
        await item.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // Last resort: click by visible text
      await page.getByText('grpc-quirks').first().click();
    }

    // Wait for logs to expand
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${DEMO_DIR}/compiler.png` });

    console.log("All screenshots taken successfully!");
  } catch (error) {
    console.error("Error taking demo:", error);
    // Take a debug screenshot on error
    await page.screenshot({ path: `${DEMO_DIR}/error.png` });
    throw error;
  } finally {
    // Close page and context to finalize video recording
    await page.close();
    await context.close();

    // Rename the video file to demo.webm
    // Playwright saves videos with auto-generated names, we need to rename
    const files = fs.readdirSync(DEMO_DIR);
    const videoFile = files.find(f => f.endsWith('.webm') && f !== 'demo.webm');
    if (videoFile) {
      const oldPath = path.join(DEMO_DIR, videoFile);
      const newPath = path.join(DEMO_DIR, 'demo.webm');
      fs.renameSync(oldPath, newPath);
      console.log("Video saved as demo.webm");
    }

    await browser.close();
  }
}

takeDemo();
