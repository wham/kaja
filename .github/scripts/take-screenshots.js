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

    // 2. Call screenshot - click first method, run it, wait for results
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

    // 3. Compiler screenshot - click Compiler button and expand first project
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

    // Expand the first compiled project by clicking on the row
    // Projects are displayed as list items with chevron icons
    const projectRow = page.locator('[role="listitem"]').first();
    if ((await projectRow.count()) > 0) {
      await projectRow.click();
    } else {
      // Fallback: click first item that looks like a project row
      const firstProject = page.locator('text=/grpc-quirks|twirp-quirks/').first();
      if ((await firstProject.count()) > 0) {
        await firstProject.click();
      }
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
