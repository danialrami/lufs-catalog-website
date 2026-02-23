import { test, expect } from '@playwright/test';

test.describe('LUFS Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4321');
  });

  test('homepage loads correctly', async ({ page }) => {
    await expect(page).toHaveTitle('LUFS Catalog');
    
    // Check header is present
    await expect(page.locator('.site-title')).toHaveText('LUFS Catalog');
    
    // Check release card is displayed
    await expect(page.locator('.card')).toBeVisible();
    await expect(page.locator('.card-title')).toHaveText('Continuo');
  });

  test('project legend filter works', async ({ page }) => {
    // Click on a legend item
    await page.locator('.legend-item').filter({ hasText: 'Continuo' }).click();
    
    // The active state should be applied
    await expect(page.locator('.legend-item.active')).toHaveText('Continuo');
  });

  test('navigate to release detail page', async ({ page }) => {
    // Click on the release card
    await page.locator('.card').click();
    
    // Should navigate to release page
    await expect(page).toHaveURL(/\/releases\/continuo/);
    await expect(page.locator('h1')).toHaveText('Continuo');
  });

  test('release page shows track listing', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Check tracks are displayed
    await expect(page.locator('.track-row')).toBeVisible();
    await expect(page.locator('.track-title').first()).toHaveText('11-01-22');
  });

  test('play button dispatches play-track event', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Click play button on a track
    const playButton = page.locator('.track-play-btn').first();
    await playButton.click();
    
    // Player bar should show the track
    await expect(page.locator('.player-bar .track-title')).toContainText('11-01-22');
  });

  test('player bar play/pause toggles', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Start playing a track
    await page.locator('.track-play-btn').first().click();
    
    // Wait for player to initialize
    await page.waitForTimeout(500);
    
    // Check play button is now showing pause icon
    const playBtn = page.locator('.player-bar .play-btn');
    await expect(playBtn).toBeVisible();
  });

  test('volume control exists', async ({ page }) => {
    await page.goto('http://localhost:4321');
    
    // Check volume controls exist
    await expect(page.locator('.volume-container')).toBeVisible();
    await expect(page.locator('.volume-bar')).toBeVisible();
  });

  test('report links are present', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Check View Report link exists
    await expect(page.locator('.report-link').filter({ hasText: 'View Report' })).toBeVisible();
  });
});

test.describe('Audio Playback', () => {
  test('audio file is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:4321/audio/a98ff_praise-legend-road/1/21-01-22.2181-03-42.773.mp3');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('audio');
  });
});

test.describe('Assets', () => {
  test('cover art is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:4321/covers/a98ff_praise-legend-road/2025-09-25_artwork.png');
    expect(response.status()).toBe(200);
  });

  test('report HTML is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:4321/reports/a98ff_praise-legend-road/1/final_report.html');
    expect(response.status()).toBe(200);
  });

  test('report images are accessible', async ({ request }) => {
    const response = await request.get('http://localhost:4321/reports/a98ff_praise-legend-road/1/artwork/components/rectangle_spectrogram.png');
    expect(response.status()).toBe(200);
  });
});
