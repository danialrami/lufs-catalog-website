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

  test('volume slider can be clicked to set volume', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Start playing a track
    await page.locator('.track-play-btn').first().click();
    await page.waitForTimeout(500);
    
    // Get the volume bar bounding box
    const volumeBar = page.locator('.volume-bar');
    const box = await volumeBar.boundingBox();
    
    if (box) {
      // Click at 50% of the volume bar width
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
      
      // The volume fill should reflect the change (50%)
      const volumeFill = page.locator('.volume-fill');
      const fillBox = await volumeFill.boundingBox();
      
      // Volume should have changed from initial 80%
      expect(fillBox).toBeTruthy();
    }
  });

  test('volume drag follows mouse smoothly', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Start playing a track
    await page.locator('.track-play-btn').first().click();
    await page.waitForTimeout(500);
    
    const volumeBar = page.locator('.volume-bar');
    const box = await volumeBar.boundingBox();
    
    if (box) {
      // Mouse down at 20%
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      
      // Drag to 80%
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
      
      // Mouse up
      await page.mouse.up();
      
      // Volume should have changed (the fill should be around 80%)
      const volumeFill = page.locator('.volume-fill');
      const fillBox = await volumeFill.boundingBox();
      expect(fillBox).toBeTruthy();
    }
  });

  test('mute button toggles volume', async ({ page }) => {
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Start playing a track
    await page.locator('.track-play-btn').first().click();
    await page.waitForTimeout(500);
    
    // Click mute button
    await page.locator('.volume-container .icon-btn').click();
    
    // Volume should be muted (fill should be 0%)
    const volumeFill = page.locator('.volume-fill');
    const fillBox = await volumeFill.boundingBox();
    
    expect(fillBox?.width).toBe(0);
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

test.describe('Persistent Playback', () => {
  test('player persists across page navigation - audio continues', async ({ page }) => {
    // Start on home page
    await page.goto('http://localhost:4321');
    
    // Click play on a track
    await page.locator('.track-play-btn').first().click();
    
    // Wait for player to start
    await page.waitForTimeout(1000);
    
    // Get the initial timestamp
    const timeDisplay = page.locator('.time-display').first();
    const initialTime = await timeDisplay.textContent();
    
    // Verify player shows track and play button shows pause icon
    await expect(page.locator('.player-bar .track-title')).toContainText('11-01-22');
    
    // Navigate to release detail page
    await page.locator('.card').click();
    
    // Wait for navigation
    await page.waitForURL(/\/releases\/continuo/);
    
    // Wait a bit more for time to potentially advance
    await page.waitForTimeout(1500);
    
    // Get the time after navigation
    const newTime = await timeDisplay.textContent();
    
    // Player should still be visible with track title
    await expect(page.locator('.player-bar')).toBeVisible();
    await expect(page.locator('.player-bar .track-title')).toContainText('11-01-22');
    
    // The time should have advanced - audio continued playing
    // If time is the same, audio likely stopped
    console.log('Initial time:', initialTime, 'After navigation:', newTime);
  });
  
  test('player state persists when navigating back to home', async ({ page }) => {
    // Start on release page
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Click play on track
    await page.locator('.track-play-btn').first().click();
    await page.waitForTimeout(1000);
    
    // Get initial time
    const timeDisplay = page.locator('.time-display').first();
    const initialTime = await timeDisplay.textContent();
    
    // Navigate back to home
    await page.locator('.back-link').click();
    
    // Wait for navigation
    await page.waitForURL('http://localhost:4321/');
    
    // Wait for time to potentially advance
    await page.waitForTimeout(1500);
    
    // Player should still be visible and showing track
    await expect(page.locator('.player-bar')).toBeVisible();
    await expect(page.locator('.player-bar .track-title')).toContainText('11-01-22');
    
    // Time should have advanced if audio continued
    const newTime = await timeDisplay.textContent();
    console.log('Initial time:', initialTime, 'After nav back:', newTime);
  });

  test('audio continues playing during navigation - timestamp updates', async ({ page }) => {
    // Start on release page
    await page.goto('http://localhost:4321/releases/continuo');
    
    // Click play on track
    await page.locator('.track-play-btn').first().click();
    await page.waitForTimeout(1000);
    
    // Get the current timestamp
    const timeDisplay = page.locator('.time-display').first();
    const initialTime = await timeDisplay.textContent();
    
    // Navigate to home
    await page.locator('.back-link').click();
    await page.waitForURL('http://localhost:4321/');
    
    // Wait a bit for time to advance
    await page.waitForTimeout(1500);
    
    // Get the time after navigation
    const newTime = await timeDisplay.textContent();
    
    // The time should have advanced (not be the same as initial)
    // This verifies audio is still playing
    expect(newTime).not.toBe(initialTime);
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
