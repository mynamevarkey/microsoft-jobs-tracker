const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let jobsCache = [];
let isScraping = false;
let scrapeError = null;
let lastScraped = null;

const LINKEDIN_JOBS_URL = 'https://www.linkedin.com/jobs/search/?currentJobId=4389712784&f_C=1035%2C1418841%2C165397%2C1386954%2C3763403%2C3290211%2C10073178%2C3238203%2C2270931%2C3641570%2C263515%2C1148098%2C5097047%2C589037%2C3178875%2C692068%2C18086638%2C19537%2C19053704%2C1889423%2C30203%2C5607466%2C11206713%2C2446424&geoId=92000000&origin=COMPANY_PAGE_JOBS_CLUSTER_EXPANSION&originToLandingJobPostings=4389712784%2C4365488129%2C4369068627%2C4384167845%2C4400918434%2C4400516806%2C4380331555%2C4361520955%2C4395319100&sortBy=DD';

async function scrapeLinkedInJobs() {
    if (isScraping) return;
    isScraping = true;
    scrapeError = null;

    console.log('Started scraping LinkedIn jobs for Microsoft...');

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

        console.log(`Successfully scraped ${jobs.length} LinkedIn jobs.`);
        jobsCache = jobs;
        lastScraped = new Date().toISOString();

    } catch (err) {
        console.error('Error during scraping:', err.message);
        scrapeError = err.message;
    } finally {
        isScraping = false;
    }
}

// Initial Scrape
scrapeLinkedInJobs();

// Schedule scrape every 30 seconds
cron.schedule('*/30 * * * * *', () => {
    scrapeLinkedInJobs();
});

// Self-ping every 10 minutes to keep Render free tier awake 24/7
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
setInterval(async () => {
    try {
        await axios.get(`${SELF_URL}/api/jobs`);
        console.log(`[Keep-alive] Pinged ${SELF_URL} successfully`);
    } catch (e) {
        console.warn(`[Keep-alive] Ping failed: ${e.message}`);
    }
}, 10 * 60 * 1000); // every 10 minutes

// API Routes
app.get('/api/jobs', (req, res) => {
    res.json({
        success: true,
        jobs: jobsCache,
        lastScraped: lastScraped,
        isScraping: isScraping,
        error: scrapeError
    });
});

app.post('/api/scrape', (req, res) => {
    if (isScraping) {
        return res.status(400).json({ success: false, message: 'Already scraping.' });
    }
    scrapeLinkedInJobs(); // Dont await, let it run in background
    res.json({ success: true, message: 'Scraping started.' });
});

// Serve frontend in production
const path = require('path');
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
