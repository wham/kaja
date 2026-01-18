const { chromium } = require("playwright");

const SCREENSHOT_DIR = ".github/screenshots";
const APP_URL = "http://localhost:41520";

async function takeScreenshots() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    // Navigate to the app
    await page.goto(APP_URL);

    // Wait for app to fully load (sidebar with services)
    await page.waitForTimeout(3000);

    // 1. Home screenshot - app once loaded
    console.log("Taking home screenshot...");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/home.png` });

    // 2. New Project screenshot - open the new project form
    // Take this early while configuration is fresh
    console.log("Taking new project screenshot...");

    // Wait for the New Project button to appear (it becomes visible after configuration loads)
    const newProjectButton = page.locator('button[aria-label="New Project"]');
    await newProjectButton.waitFor({ state: "visible", timeout: 10000 });

    await newProjectButton.click();

    // Wait for the dialog to appear
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/newproject.png` });

    // Close the dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

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

    await page.screenshot({ path: `${SCREENSHOT_DIR}/call.png` });

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

    await page.screenshot({ path: `${SCREENSHOT_DIR}/compiler.png` });

    console.log("All screenshots taken successfully!");
  } catch (error) {
    console.error("Error taking screenshots:", error);
    // Take a debug screenshot on error
    await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` });
    throw error;
  } finally {
    await browser.close();
  }
}

takeScreenshots();
