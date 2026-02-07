#!/usr/bin/env node
/**
 * TUWEL Exam Schedule Scraper
 * Logs into TUWEL and extracts exam information
 */

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

const TUWEL_URL = 'https://tuwel.tuwien.ac.at';
const EMAIL = process.env.TUWEL_EMAIL;
const PASSWORD = process.env.TUWEL_PASSWORD;

async function scrapeExams() {
  if (!EMAIL || !PASSWORD) {
    console.error('\n=== ERROR: Missing Credentials ===');
    console.error('Please set TUWEL_EMAIL and TUWEL_PASSWORD environment variables.');
    console.error('Example: TUWEL_EMAIL=my@email.com TUWEL_PASSWORD=secret node tuwel_scraper.mjs\n');
    process.exit(1);
  }

  console.log('Starting TUWEL exam scraper...');
  
  const browser = await chromium.launch({ 
    headless: true
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to TUWEL
    console.log('Navigating to TUWEL...');
    await page.goto(TUWEL_URL);
    await page.waitForLoadState('networkidle');
    
    // Click TU Wien Login button
    console.log('Clicking TU Wien Login...');
    await page.click('a:has-text("TU Wien Login")');
    await page.waitForLoadState('networkidle');
    
    // Wait for Austria ID login form
    console.log('Waiting for login form...');
    await page.waitForTimeout(3000);
    
    // Check if we're on the Austria ID page
    const pageContent = await page.content();
    
    if (pageContent.includes('2FA') || pageContent.includes('Zwei-Faktor') || pageContent.includes('TOTP')) {
      console.log('\n=== 2FA REQUIRED ===');
      console.log('Please approve the 2FA on your device now.');
      console.log('Waiting 30 seconds for approval...\n');
      await page.waitForTimeout(30000);
    }
    
    // Look for username/email field
    const usernameSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id="email"]',
      'input[id="username"]'
    ];
    
    for (const selector of usernameSelectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Found username field: ${selector}`);
        await element.fill(EMAIL);
        break;
      }
    }
    
    // Look for password field
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[id="password"]'
    ];
    
    for (const selector of passwordSelectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Found password field: ${selector}`);
        await element.fill(PASSWORD);
        break;
      }
    }
    
    // Look for login/submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Anmelden")',
      'button:has-text("Sign in")'
    ];
    
    for (const selector of submitSelectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Clicking submit button: ${selector}`);
        await element.click();
        break;
      }
    }
    
    // Wait for login to complete
    console.log('Waiting for login...');
    await page.waitForTimeout(5000);
    
    // Check if 2FA is needed after submit
    const contentAfterLogin = await page.content();
    if (contentAfterLogin.includes('2FA') || contentAfterLogin.includes('Zwei-Faktor') || contentAfterLogin.includes('verification')) {
      console.log('\n=== 2FA CODE REQUIRED ===');
      console.log('Please enter the 2FA code or approve the notification.');
      console.log('Waiting 60 seconds...\n');
      await page.waitForTimeout(60000);
    }
    
    // Wait for dashboard to load
    console.log('Waiting for dashboard...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Check current URL and content
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Look for "My Courses" or similar
    const courseSelectors = [
      'a:has-text("Meine Kurse")',
      'a:has-text("My courses")',
      'a:has-text("Dashboard")',
      '.course'
    ];
    
    for (const selector of courseSelectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Found courses section: ${selector}`);
        await element.click();
        await page.waitForTimeout(3000);
        break;
      }
    }
    
    // Extract all text content for analysis
    console.log('Extracting page content...');
    const pageText = await page.evaluate(() => document.body.innerText);
    
    // Look for exam-related content
    const examKeywords = ['exam', 'prüfung', 'pruefung', 'klausur', 'test', 'assessment', 'final'];
    const lines = pageText.split('\n');
    const examLines = [];
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (examKeywords.some(kw => lowerLine.includes(kw))) {
        examLines.push(line.trim());
      }
    }
    
    // Save results
    const results = {
      url: currentUrl,
      timestamp: new Date().toISOString(),
      examRelatedContent: examLines,
      fullText: pageText.substring(0, 50000) // First 50k chars
    };
    
    writeFileSync('tuwel_exams.json', JSON.stringify(results, null, 2));
    console.log('Results saved to tuwel_exams.json');
    
    // Take screenshot
    await page.screenshot({ path: 'tuwel_dashboard.png', fullPage: true });
    console.log('Screenshot saved to tuwel_dashboard.png');
    
    console.log('\n=== Extraction Complete ===');
    console.log(`Found ${examLines.length} exam-related lines`);
    
  } catch (error) {
    console.error('Error during scraping:', error);
    
    // Save error state
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => 'Could not extract text');
    const currentUrl = page.url();
    
    writeFileSync('tuwel_error.json', JSON.stringify({
      error: error.message,
      url: currentUrl,
      timestamp: new Date().toISOString(),
      pageText: pageText.substring(0, 10000)
    }, null, 2));
    
    await page.screenshot({ path: 'tuwel_error.png', fullPage: true });
    
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

scrapeExams().catch(console.error);
