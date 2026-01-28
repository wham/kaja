const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = ".github/demo";
const APP_URL = "http://localhost:41520";
const DEFAULT_TIMEOUT = 15000;

// Helper to wait for a selector with clear logging
async function waitFor(page, selector, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    console.error(`  ✗ Timeout waiting for: ${description}`);
    console.error(`    Selector: ${selector}`);
    throw new Error(`Timeout waiting for: ${description} (selector: ${selector})`);
  }
}

// Helper to wait for a locator to be visible
async function waitForLocator(locator, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await locator.waitFor({ timeout, state: "visible" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    console.error(`  ✗ Timeout waiting for: ${description}`);
    throw new Error(`Timeout waiting for: ${description}`);
  }
}

// Helper to wait for text to disappear
async function waitForTextHidden(page, text, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await page.getByText(text).first().waitFor({ timeout, state: "hidden" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    // Text might not exist at all, which is fine
    console.log(`  ✓ ${description} (text not present)`);
  }
}

// Small delay for visual stability before screenshots
async function settleDelay(page, ms = 300) {
  await page.waitForTimeout(ms);
}

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
    console.log("Navigating to app...");
    await page.goto(APP_URL);

    // Wait for app to fully load - sidebar with services tree
    await waitFor(page, 'nav[aria-label="Services and methods"]', "services navigation");

    // Wait for project compilation to complete (loading state disappears)
    // The sidebar shows "Loading..." text while projects compile
    console.log("  Waiting for: projects to compile...");
    try {
      await page.waitForFunction(() => {
        const loadingItem = document.getElementById('loading-tree-view-item');
        const loadingText = document.body.innerText.includes('Loading...');
        return !loadingItem && !loadingText;
      }, { timeout: 30000 });
      console.log("  ✓ Projects compiled");
    } catch {
      console.log("  ⚠ Compilation wait timed out, checking for content anyway");
    }

    // Now wait for actual service/method tree items to appear
    // These are TreeView items that are NOT the loading placeholder
    await waitFor(page, 'li[role="treeitem"]:not(#loading-tree-view-item)', "service tree items", 10000).catch(async () => {
      // Fallback: check for any clickable method text
      console.log("  ⚠ TreeView items not found with role, trying text-based check");
      await waitFor(page, 'nav[aria-label="Services and methods"] ul', "services list", 5000);
    });
    await settleDelay(page);

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

      // Wait for the project form to be ready
      await waitFor(page, 'div.tab-item.active', "new project tab to be active");
      // Wait for form input or JSON editor to be ready
      const formInput = page.locator('input[placeholder="Project name"]');
      const jsonEditor = page.locator('.monaco-editor');
      try {
        await Promise.race([
          formInput.waitFor({ timeout: 5000, state: "visible" }),
          jsonEditor.waitFor({ timeout: 5000, state: "visible" })
        ]);
        console.log("  ✓ Project form content loaded");
      } catch {
        console.log("  ✓ Project form opened (content type unknown)");
      }
      await settleDelay(page);

      await page.screenshot({ path: `${DEMO_DIR}/newproject.png` });

      // Close the tab by pressing Escape or clicking close button
      const closeButton = page.locator('button[aria-label="Close New Project"]');
      if ((await closeButton.count()) > 0) {
        await closeButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
      // Wait for the tab to close
      await page.locator('div.tab-item:has-text("New Project")').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      await settleDelay(page);
    } else {
      console.log("New Project button not found, skipping screenshot");
    }

    // 3. Call screenshot - click Types method, run it, wait for results
    console.log("Taking call screenshot...");

    // Click on the Types method in the sidebar tree
    const methodItem = page.getByText('Types', { exact: true }).first();
    await waitForLocator(methodItem, "Types method in sidebar");
    await methodItem.click();

    // Wait for method tab to become active
    await waitFor(page, 'div.tab-item.active', "method tab to become active");
    await settleDelay(page);

    // Click the Run button - try multiple selectors
    // The button contains text "Run" and has a play icon (octicon-play)
    const runButtonSelectors = [
      'button:has(svg.octicon-play)',           // Button with play icon
      'button:has-text("Run")',                  // Button containing "Run" text
      'button[data-variant="primary"]:has-text("Run")', // Primary button with Run text
    ];

    let runButtonClicked = false;
    for (const selector of runButtonSelectors) {
      const btn = page.locator(selector).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click();
        runButtonClicked = true;
        console.log(`  ✓ Clicked Run button using: ${selector}`);
        break;
      }
    }

    if (!runButtonClicked) {
      // Last resort: use getByRole
      const roleButton = page.getByRole('button', { name: /run/i }).first();
      if ((await roleButton.count()) > 0) {
        await roleButton.click();
        console.log("  ✓ Clicked Run button using role selector");
        runButtonClicked = true;
      }
    }

    if (!runButtonClicked) {
      throw new Error("Could not find Run button with any selector");
    }

    // Wait for console to show results
    // First wait for the call to appear in console
    await waitFor(page, 'div.console-row', "call to appear in console");

    // Wait for response to complete - the pending state shows hollow circle, completed shows filled
    console.log("  Waiting for: response to complete...");
    try {
      // Wait for filled status indicator (● means complete, ○ means pending)
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('.console-row');
        if (rows.length === 0) return false;
        // Check if any row has the filled circle (success or error)
        const text = rows[0].textContent || '';
        return text.includes('●');
      }, { timeout: 15000 });
      console.log("  ✓ Response completed");
    } catch {
      console.log("  ⚠ Response completion check timed out, proceeding anyway");
    }
    await settleDelay(page, 500);

    await page.screenshot({ path: `${DEMO_DIR}/call.png` });

    // 4. Compiler screenshot - click Compiler button and expand first project
    console.log("Taking compiler screenshot...");

    // Click the Compiler button (CPU icon in sidebar header)
    const compilerButton = page.locator('button[aria-label="Open Compiler"]');
    const compilerButtonFallback = page.locator('button:has(svg[class*="octicon-cpu"])');

    if ((await compilerButton.count()) > 0) {
      await compilerButton.click();
    } else if ((await compilerButtonFallback.count()) > 0) {
      await compilerButtonFallback.click();
    } else {
      // Last fallback
      await page.locator('button[aria-label*="ompiler"]').click();
    }

    // Wait for compiler tab to become active
    await waitFor(page, 'div.tab-item.active:has-text("Compiler")', "Compiler tab to become active");

    // Wait for compiler content to load - either project items or loading state to finish
    await waitForTextHidden(page, "Loading configuration", "configuration to load");
    await waitFor(page, 'div.compiler-item-wrapper', "compiler project items", 10000).catch(() => {
      console.log("  ⚠ No compiler items found, continuing anyway");
    });
    await settleDelay(page);

    // Expand the first compiled project by clicking on the ActionList.Item
    // Try multiple selectors since Primer components can render differently
    const compilerSelectors = [
      'div.compiler-item-wrapper li',
      'div.compiler-item-wrapper [role="option"]',
      'div.compiler-item-wrapper button',
    ];

    let clicked = false;
    for (const selector of compilerSelectors) {
      const item = page.locator(selector).first();
      if ((await item.count()) > 0) {
        await item.click();
        clicked = true;
        console.log(`  ✓ Clicked compiler item using: ${selector}`);
        break;
      }
    }

    if (!clicked) {
      // Last resort: click by visible text
      const textItem = page.getByText('grpc-quirks').first();
      if ((await textItem.count()) > 0) {
        await textItem.click();
        console.log("  ✓ Clicked compiler item using text: grpc-quirks");
      } else {
        console.log("  ⚠ Could not find compiler item to expand");
      }
    }

    // Wait for logs to expand - look for expanded state or logs container
    await waitFor(page, 'div.compiler-item-expanded, div.compiler-logs-container, span.chevron-icon.expanded', "logs to expand", 5000).catch(() => {
      console.log("  ✓ Logs expansion state unknown, proceeding");
    });
    await settleDelay(page);

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
