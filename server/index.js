const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const dotenv = require('dotenv');
const webpush = require('web-push');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Web Push Setup ──────────────────────────────────────────────────────────
webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@microsoft-jobs-tracker.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

let pushSubscriptions = []; // In-memory store (persists while server is alive)

// ── WhatsApp via CallMeBot ───────────────────────────────────────────────────
async function sendWhatsAppNotification(newJobs) {
    const phone = process.env.WHATSAPP_PHONE;
    const apiKey = process.env.WHATSAPP_APIKEY;
    if (!phone || !apiKey) return; // skip if not configured

    const jobLines = newJobs.slice(0, 5).map(j => `• ${j.title} | ${j.location}`).join('\n');
    const message = encodeURIComponent(
        `🔔 *New Microsoft Jobs on LinkedIn!*\n\n${jobLines}\n\n🔗 https://microsoft-jobs-tracker.onrender.com`
    );

    try {
        await axios.get(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${message}&apikey=${apiKey}`);
        console.log(`[WhatsApp] Notification sent for ${newJobs.length} new job(s)`);
    } catch (e) {
        console.warn('[WhatsApp] Failed to send:', e.message);
    }
}


// ── State ───────────────────────────────────────────────────────────────────
let jobsCache = [];
let knownJobIds = new Set();
let isScraping = false;
let scrapeError = null;
let lastScraped = null;

const LINKEDIN_JOBS_URL = 'https://www.linkedin.com/jobs/search/?currentJobId=4401074592&f_C=1035%2C1418841%2C165397%2C1386954%2C3763403%2C3290211%2C10073178%2C3238203%2C2270931%2C3641570%2C263515%2C1148098%2C5097047%2C589037%2C3178875%2C692068%2C18086638%2C19537%2C19053704%2C1889423%2C30203%2C5607466%2C11206713%2C2446424&geoId=102713980&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true';

// ── Send Push to all subscribers ─────────────────────────────────────────────
async function sendPushNotifications(newJobs) {
    if (!pushSubscriptions.length || !newJobs.length) return;

    const payload = JSON.stringify({
        title: `🔔 ${newJobs.length} New Microsoft Job${newJobs.length > 1 ? 's' : ''}!`,
        body: newJobs.slice(0, 3).map(j => `• ${j.title} — ${j.location}`).join('\n'),
        url: 'https://microsoft-jobs-tracker.onrender.com'
    });

    const failed = [];
    await Promise.all(pushSubscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification(sub, payload);
        } catch (e) {
            console.warn('[Push] Subscription expired or invalid:', e.statusCode);
            failed.push(sub);
        }
    }));

    // Clean up dead subscriptions
    pushSubscriptions = pushSubscriptions.filter(s => !failed.includes(s));
}

// ── Scraper ──────────────────────────────────────────────────────────────────
async function scrapeLinkedInJobs() {
    if (isScraping) return;
    isScraping = true;
    scrapeError = null;

    console.log('Scraping LinkedIn...');

    try {
        const response = await axios.get(LINKEDIN_JOBS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        const $ = cheerio.load(response.data);
        const jobs = [];

        $('.base-search-card').each((i, card) => {
            const titleElement = $(card).find('.base-search-card__title').text().trim();
            const subtitleElement = $(card).find('.base-search-card__subtitle').text().trim();
            const locationElement = $(card).find('.job-search-card__location').text().trim();
            const urlElement = $(card).find('.base-card__full-link').attr('href');
            const timeElement = $(card).find('time').text().trim();

            if (titleElement) {
                jobs.push({
                    title: titleElement,
                    company: subtitleElement || 'Microsoft',
                    location: locationElement || 'Worldwide',
                    url: urlElement || '',
                    timePosted: timeElement || '',
                    id: urlElement ? new URL(urlElement).pathname.split('-').pop() : Math.random().toString(36).substring(7)
                });
            }
        });

        // Detect truly NEW jobs (not seen before)
        const newJobs = knownJobIds.size > 0
            ? jobs.filter(j => !knownJobIds.has(j.id))
            : [];

        // Update known IDs
        jobs.forEach(j => knownJobIds.add(j.id));

        if (newJobs.length > 0) {
            console.log(`🔔 ${newJobs.length} NEW job(s) found! Pushing notifications...`);
            sendPushNotifications(newJobs);
        }

        console.log(`Scraped ${jobs.length} jobs. ${newJobs.length} new.`);
        jobsCache = jobs;
        lastScraped = new Date().toISOString();

    } catch (err) {
        console.error('Scraping error:', err.message);
        scrapeError = err.message;
    } finally {
        isScraping = false;
    }
}

// ── Startup & Schedule ───────────────────────────────────────────────────────
scrapeLinkedInJobs();

// Scrape every 30 seconds
cron.schedule('*/30 * * * * *', () => scrapeLinkedInJobs());

// Self-ping every 10 minutes to keep Render awake 24/7
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
setInterval(async () => {
    try {
        await axios.get(`${SELF_URL}/api/jobs`);
        console.log(`[Keep-alive] Pinged OK`);
    } catch (e) {
        console.warn(`[Keep-alive] Ping failed: ${e.message}`);
    }
}, 10 * 60 * 1000);

// ── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
    res.json({ success: true, jobs: jobsCache, lastScraped, isScraping, error: scrapeError });
});

app.post('/api/scrape', (req, res) => {
    if (isScraping) return res.status(400).json({ success: false, message: 'Already scraping.' });
    scrapeLinkedInJobs();
    res.json({ success: true, message: 'Scraping started.' });
});

// Return the VAPID public key to the frontend
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Save a push subscription from the browser
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    const exists = pushSubscriptions.some(s => s.endpoint === subscription.endpoint);
    if (!exists) {
        pushSubscriptions.push(subscription);
        console.log(`[Push] New subscriber. Total: ${pushSubscriptions.length}`);
    }
    res.status(201).json({ success: true });
});

// ── Serve Frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

module.exports = app;
