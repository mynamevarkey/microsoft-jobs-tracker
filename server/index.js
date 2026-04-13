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
        const jobs = [];
        
        try {
            const msCareersUrl = 'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=Technical%20Support&location=India&start=0&sort_by=relevance&filter_include_remote=1';
            const msRes = await axios.get(msCareersUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const positions = msRes.data.data ? msRes.data.data.positions || [] : [];
            for (let pos of positions) {
                jobs.push({
                    title: pos.title,
                    company: 'Microsoft Careers',
                    location: pos.location || 'India',
                    url: `https://apply.careers.microsoft.com/jobs/${pos.position_id}`,
                    timePosted: pos.posted_date || new Date().toISOString().split('T')[0],
                    id: pos.position_id || Math.random().toString(36).substring(7),
                    isNew: true // simple flag to aid debugging
                });
            }
        } catch (e) {
            console.error('Error fetching Microsoft internal Careers API: ', e.message);
        }

        try {
            const response = await axios.get(LINKEDIN_JOBS_URL, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            
            const $ = cheerio.load(response.data);
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
        } catch (e) {
            console.error('Error fetching LinkedIn jobs: ', e.message);
        }

        console.log(`Successfully scraped ${jobs.length} jobs.`);
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

// Schedule scrape every 2 minutes (120 seconds)
cron.schedule('*/2 * * * *', () => {
    scrapeLinkedInJobs();
});

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
